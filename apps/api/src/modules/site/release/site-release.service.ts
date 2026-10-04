import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { SiteRelease } from '@prisma/client'
import { ErrorCode } from '../../../common/constants/error-code'
import { RedisKey } from '../../../common/constants/redis-key'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { copyCloudTree } from '../../../common/utils/cloud-tree-copy.util'
import { purgeSiteReleaseData } from './release-cleanup.util'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import { RedisService } from '../../../infra/redis/redis.service'
import { StorageService } from '../../../infra/storage/storage.service'
import { CloudFacade } from '../../cloud/facade/cloud-facade.service'
import { DisplayFacade } from '../../display/facade/display-facade.service'

/** manifest.json 的条目（`相对路径 → 条目`；物理清单随快照目录落盘，不落库，D145/D146） */
interface ManifestEntry {
  /** 源 cloud_file 行 id（审计追溯用；快照本身不依赖它） */
  fileId: string
  /** 内容 sha256（Phase2 物理去重与长缓存的输入，D150） */
  contentHash: string
  size: number
  mime: string | null
}

/** 发布版本视图（管理侧出域形态；bigint → string） */
export interface ReleaseView {
  id: string
  versionNo: number
  label: string | null
  fileCount: number
  totalBytes: string
  pinned: boolean
  createdBy: string
  createdAt: Date
  /** 是否为站点当前版本 */
  active: boolean
}

/** 发布锁 TTL（秒）：覆盖一次大站点快照，异常退出后自动释放（R157 防死锁） */
const PUBLISH_LOCK_TTL_SEC = 300
/** 快照遍历深度上限（防环；与开放层解析深度同量级） */
const SNAPSHOT_MAX_DEPTH = 20
/** 不参与快照的顶层目录（D150：展示应用托管链独立演进，避免双版本语义纠缠） */
const SNAPSHOT_EXCLUDE_TOP = new Set(['disp'])
/** manifest 文件名（随快照目录落盘，**不进请求热路径**，D148） */
const MANIFEST_NAME = 'manifest.json'
/** 快照内展示应用的挂载目录名（P20 B2：聚合时归位到 `disp/{id}/`，对外 URL 保持不变） */
const DISP_DIR = 'disp'

/**
 * 站点发布与版本管理服务（P19 T160；D143~D147 / R156~R158）。
 *
 * 发布 = **不可变快照 + 指针翻转**：把站点云盘目录（工作区）全量子树复制到
 * `site-releases/{siteId}/{releaseId}/`，生成 `manifest.json`，`rename` 原子落位，
 * **最后一步**才 UPDATE `site_site.active_release_id`——此前线上仍指向旧版本或 legacy 轨。
 *
 * 失败路径：任一步失败 → 清理 `.tmp-` 中转目录并删除刚建的版本行（R157：不留半成品）。
 * 并发：同站以 Redis 锁互斥（`site:publish:{siteId}`），抢锁失败 → 40121。
 *
 * 快照一经生效**永不修改**（R156）：内容修正只能发布新版本；唯一删除方是版本删除、
 * 站点删除与保留策略清理。
 */
@Injectable()
export class SiteReleaseService {
  private readonly logger = new Logger(SiteReleaseService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
    /** 工作区路径解析（展示应用目录不在站点树内，P20 B2；铁律 5：经门面） */
    private readonly cloudFacade: CloudFacade,
    /** 挂靠本站的展示应用清单（经 display 域门面，单向依赖，见模块注释的成环分析） */
    private readonly displayFacade: DisplayFacade,
  ) {}

  // ==================== 对外（管理态） ====================

  /** 发布当前工作副本为新版本并置为当前（发布即上线，FR1） */
  async publish(userId: bigint, siteId: bigint, label?: string): Promise<ReleaseView> {
    const site = await this.requireOwnedSite(userId, siteId)
    const lockKey = RedisKey.sitePublishLock(site.id.toString())
    const acquired = await this.redis.client.set(lockKey, '1', 'EX', PUBLISH_LOCK_TTL_SEC, 'NX')
    if (acquired !== 'OK') {
      throw new BusinessException(ErrorCode.SitePublishInProgress, '发布进行中，请稍后重试')
    }

    let release: SiteRelease | null = null
    let tmpDir: string | null = null
    try {
      // ① 先建版本行（拿到 releaseId 作目录名；version_no = 站内 max+1）
      release = await this.createReleaseRow(site.id, userId, label)
      const releaseId = release.id
      tmpDir = this.storage.releaseDirOf(site.id, releaseId, true)
      const finalDir = this.storage.releaseDirOf(site.id, releaseId, false)
      // 防御性清理：同 releaseId 不可能复用（自增主键），残留只可能来自异常退出
      await this.storage.removeDir(tmpDir)

      // ② 全量子树复制（含 media/，排除 disp 顶层）+ 逐文件 sha256 → manifest
      const manifest: Record<string, ManifestEntry> = {}
      const stats = await this.copyTree(site.userId, site.rootFolderId, '', manifest, tmpDir)

      // ②b 聚合挂靠本站的展示应用工作区（P20 B2）
      const displayStats = await this.appendDisplayContents(site.id, site.userId, manifest, tmpDir)
      stats.fileCount += displayStats.fileCount
      stats.totalBytes += displayStats.totalBytes

      // ③ manifest 随目录落盘（发布侧清点/审计 + 未来去重与长缓存输入）
      await this.storage.writeInto(
        tmpDir,
        MANIFEST_NAME,
        Buffer.from(JSON.stringify(manifest), 'utf-8'),
      )

      // ④ rename 原子落位（同卷保证原子与瞬时）
      await this.storage.renameDir(tmpDir, finalDir)
      tmpDir = null

      // ⑤ 统计回写 + 指针翻转（同一事务；此前线上不受影响）
      const activated = await this.prisma.$transaction(async (tx) => {
        const row = await tx.siteRelease.update({
          where: { id: releaseId },
          data: { fileCount: stats.fileCount, totalBytes: BigInt(stats.totalBytes) },
        })
        await tx.siteSite.update({
          where: { id: site.id },
          data: { activeReleaseId: releaseId },
        })
        return row
      })

      // ⑥ 缓存失效（R159：slug + path 两族）+ 保留策略（R158）
      await this.invalidateSiteCaches(site.id, site.slug)
      await this.enforceRetention(site.id, activated.id)
      return this.toView(activated, true)
    } catch (error) {
      if (tmpDir) await this.storage.removeDir(tmpDir).catch(() => undefined)
      if (release) {
        // 行已建但发布未完成 → 删除行，保持「行 ↔ 快照目录」一一对应
        await this.prisma.siteRelease.delete({ where: { id: release.id } }).catch(() => undefined)
      }
      throw error
    } finally {
      await this.redis.client.del(lockKey).catch(() => undefined)
    }
  }

  /** 版本列表（倒序；量小不分页，FR2） */
  async list(userId: bigint, siteId: bigint): Promise<ReleaseView[]> {
    const site = await this.requireOwnedSite(userId, siteId)
    const rows = await this.prisma.siteRelease.findMany({
      where: { siteId: site.id },
      orderBy: [{ versionNo: 'desc' }],
    })
    return rows.map((row) => this.toView(row, row.id === site.activeReleaseId))
  }

  /** 切换当前版本（回滚 = activate 旧版；秒级、可反复横跳，FR3） */
  async activate(userId: bigint, siteId: bigint, releaseId: bigint): Promise<ReleaseView> {
    const site = await this.requireOwnedSite(userId, siteId)
    const release = await this.requireReleaseInSite(site.id, releaseId)
    const updated = await this.prisma.siteSite.update({
      where: { id: site.id },
      data: { activeReleaseId: release.id },
      select: { id: true },
    })
    void updated
    await this.invalidateSiteCaches(site.id, site.slug)
    return this.toView(release, true)
  }

  /** 锁定 / 解锁（锁定版豁免自动清理与手动删除，FR4/R158） */
  async pin(
    userId: bigint,
    siteId: bigint,
    releaseId: bigint,
    pinned: boolean,
  ): Promise<ReleaseView> {
    const site = await this.requireOwnedSite(userId, siteId)
    const release = await this.requireReleaseInSite(site.id, releaseId)
    const row = await this.prisma.siteRelease.update({
      where: { id: release.id },
      data: { pinned: pinned ? 1 : 0 },
    })
    return this.toView(row, row.id === site.activeReleaseId)
  }

  /** 删除版本（当前版本 / 锁定版拒绝；FR4/R158） */
  async remove(
    userId: bigint,
    siteId: bigint,
    releaseId: bigint,
  ): Promise<{ ok: true; id: string }> {
    const site = await this.requireOwnedSite(userId, siteId)
    const release = await this.requireReleaseInSite(site.id, releaseId)
    if (release.id === site.activeReleaseId) {
      throw new BusinessException(ErrorCode.ParamInvalid, '当前版本不可删除，请先切换到其他版本')
    }
    if (release.pinned === 1) {
      throw new BusinessException(ErrorCode.ParamInvalid, '已锁定的版本不可删除，请先解锁')
    }
    await this.prisma.siteRelease.delete({ where: { id: release.id } })
    await this.storage
      .removeDir(this.storage.releaseDirOf(site.id, release.id))
      .catch(() => undefined)
    await this.invalidateSiteCaches(site.id, site.slug)
    return { ok: true, id: release.id.toString() }
  }

  // ==================== 供开放层 / 站点删除消费 ====================

  /** 站点当前版本行（开放层快照轨入口；无当前版本返回 null = legacy 轨） */
  async activeRelease(siteId: bigint): Promise<SiteRelease | null> {
    const site = await this.prisma.siteSite.findFirst({
      where: { id: siteId },
      select: { activeReleaseId: true },
    })
    if (!site?.activeReleaseId) return null
    return this.prisma.siteRelease.findFirst({ where: { id: site.activeReleaseId } })
  }

  /**
   * 级联清理（站点删除时调用，D146）：删除该站点全部版本行与快照目录树。
   * 失败只记日志（删站主流程不应因清理失败而回滚；残留由运维/保留策略兜底）。
   */
  async purgeForSite(siteId: bigint): Promise<void> {
    try {
      // 实现下沉到纯函数（`release-cleanup.util`）：`SiteManageService` 删站时同样直调它，
      // 从而不必 import 本模块 —— 否则 site.release → display.facade → display.manage →
      // site.facade → site.manage → site.release 构成模块环（P20 B2 聚合引入）。
      await purgeSiteReleaseData(this.prisma, this.storage, siteId)
    } catch (error) {
      this.logger.warn(`清理站点 ${siteId.toString()} 的发布版本失败：${String(error)}`)
    }
  }

  // ==================== 内部 ====================

  /** 站点存在且属主匹配（不存在一律 40400 防探测） */
  private async requireOwnedSite(
    userId: bigint,
    siteId: bigint,
  ): Promise<{
    id: bigint
    userId: bigint
    slug: string
    rootFolderId: bigint
    activeReleaseId: bigint | null
  }> {
    const site = await this.prisma.siteSite.findFirst({
      where: { id: siteId, userId },
      select: { id: true, userId: true, slug: true, rootFolderId: true, activeReleaseId: true },
    })
    if (!site) throw new BusinessException(ErrorCode.NotFound, '站点不存在')
    return site
  }

  /** 版本必须存在且属于该站点（否则 40400，R158） */
  private async requireReleaseInSite(siteId: bigint, releaseId: bigint): Promise<SiteRelease> {
    const release = await this.prisma.siteRelease.findFirst({
      where: { id: releaseId, siteId },
    })
    if (!release) throw new BusinessException(ErrorCode.NotFound, '版本不存在')
    return release
  }

  /** 建版本行（version_no = 站内 max+1；并发由 Redis 锁互斥，唯一索引为数据层兜底） */
  private async createReleaseRow(
    siteId: bigint,
    userId: bigint,
    label?: string,
  ): Promise<SiteRelease> {
    const agg = await this.prisma.siteRelease.aggregate({
      where: { siteId },
      _max: { versionNo: true },
    })
    const trimmed = label?.trim()
    return this.prisma.siteRelease.create({
      data: {
        siteId,
        versionNo: (agg._max.versionNo ?? 0) + 1,
        label: trimmed ? trimmed.slice(0, 100) : null,
        fileCount: 0,
        totalBytes: BigInt(0),
        createdBy: userId,
      },
    })
  }

  /**
   * 聚合挂靠本站的展示应用内容到快照（P20 B2）。
   *
   * 展示应用内容**不在站点树里**（B1：目录恒位于独立工作区，挂靠只改关系字段），发布时按
   * 「工作区 → `快照/disp/{id}/`」归位——于是对外 URL 保持 `/api/open/{slug}/disp/{id}/**` 不变，
   * 且站点版本**自包含**：回滚站点时展示应用内容随之回滚，不依赖展示应用自身的版本存活
   * （这是 D150 的修订：原「disp 不进快照」会让回滚不完整、且云盘改动直达公网）。
   *
   * 未写文件的展示应用（工作区目录不存在）跳过——单个应用异常不让整次发布失败。
   */
  private async appendDisplayContents(
    siteId: bigint,
    ownerId: bigint,
    manifest: Record<string, ManifestEntry>,
    tmpDir: string,
  ): Promise<{ fileCount: number; totalBytes: number }> {
    let fileCount = 0
    let totalBytes = 0
    let items: Array<{ displayId: string; workPath: string }> = []
    try {
      items = await this.displayFacade.listWorkPathsBySite(siteId, ownerId)
    } catch (error) {
      this.logger.warn(`聚合展示应用列表失败（跳过后继续发布）：${String(error)}`)
      return { fileCount, totalBytes }
    }
    for (const item of items) {
      try {
        const workDirId = await this.cloudFacade.resolveUserDirId(ownerId, item.workPath)
        if (workDirId === null) continue
        const copied = await this.copyTree(
          ownerId,
          workDirId,
          `${DISP_DIR}/${item.displayId}`,
          manifest,
          tmpDir,
          false,
        )
        fileCount += copied.fileCount
        totalBytes += copied.totalBytes
      } catch (error) {
        this.logger.warn(`展示应用 ${item.displayId} 聚合跳过：${String(error)}`)
      }
    }
    return { fileCount, totalBytes }
  }

  /**
   * 递归复制站点子树到快照目录（BFS，含 `media/`；顶层 `disp/` 排除，D150 修订见 B2）。
   *
   * 只复制**文件**（目录不入 manifest）；逐文件 sha256 作 `contentHash`。
   * 深度有界防环；不存在的物理文件（DB 有行、盘无文件）按 0 字节跳过并告警——
   * 快照宁可缺一个坏文件，也不因单文件缺失让整次发布失败。
   */
  private async copyTree(
    userId: bigint,
    rootFolderId: bigint,
    prefix: string,
    manifest: Record<string, ManifestEntry>,
    destDir: string,
    /** 复制**站点工作区**时为 true（顶层 `disp/` 已改为从展示应用工作区聚合，见 B2/D150 修订）；
     *  聚合**展示应用**时传 false（此时 `disp/{id}` 正是目标路径本身，不能再排除） */
    excludeTopDisp = true,
  ): Promise<{ fileCount: number; totalBytes: number }> {
    // 遍历实现已抽公共层（`common/utils/cloud-tree-copy.util`）：与展示应用检查点（P20 T167）
    // 共用同一份「工作区 → 不可变快照」逻辑，避免两条路径读同一片工作区却结果不同
    const { entries, fileCount, totalBytes } = await copyCloudTree(this.prisma, this.storage, {
      userId,
      rootFolderId,
      prefix,
      destDir,
      maxDepth: SNAPSHOT_MAX_DEPTH,
      excludeTop: excludeTopDisp ? SNAPSHOT_EXCLUDE_TOP : undefined,
      warn: (message: string) => this.logger.warn(message),
    })
    Object.assign(manifest, entries)
    return { fileCount, totalBytes }
  }



  /**
   * 保留策略（R158/D147）：**未锁定**版本数超过 `site.releaseKeep` 时清理最旧的；
   * 当前版本与锁定版本豁免。
   */
  private async enforceRetention(siteId: bigint, activeReleaseId: bigint): Promise<void> {
    const keep = this.config.get<number>('site.releaseKeep', 20)
    const rows = await this.prisma.siteRelease.findMany({
      where: { siteId },
      orderBy: [{ versionNo: 'desc' }],
      select: { id: true, pinned: true },
    })
    const removable = rows.filter((row) => row.pinned !== 1 && row.id !== activeReleaseId)
    for (const row of removable.slice(keep)) {
      await this.removeRelease(siteId, row.id)
    }
  }

  /** 内部删除（保留策略用；不校验属主与当前版本——调用方已过滤） */
  private async removeRelease(siteId: bigint, releaseId: bigint): Promise<void> {
    await this.prisma.siteRelease.delete({ where: { id: releaseId } }).catch(() => undefined)
    await this.storage
      .removeDir(this.storage.releaseDirOf(siteId, releaseId))
      .catch(() => undefined)
  }

  /**
   * 发布 / 切换 / 版本删除后的缓存失效（R159）。
   *
   * **必须同时失效 slug 缓存**：`site:resolve:{slug}` 存的是站点元信息快照，
   * P19 起其中含 `activeReleaseId`——它决定开放层走快照轨还是 legacy 轨，
   * 漏失效会让线上继续按旧轨解析（本脚本实测踩到：发布后仍直挂工作副本）。
   */
  private async invalidateSiteCaches(siteId: bigint, slug: string): Promise<void> {
    await this.redis.client.del(RedisKey.siteResolve(slug)).catch(() => undefined)
    await this.redis.scanDel(RedisKey.sitePathPrefix(siteId.toString())).catch(() => undefined)
  }

  private toView(row: SiteRelease, active: boolean): ReleaseView {
    return {
      id: row.id.toString(),
      versionNo: row.versionNo,
      label: row.label,
      fileCount: row.fileCount,
      totalBytes: row.totalBytes.toString(),
      pinned: row.pinned === 1,
      createdBy: row.createdBy.toString(),
      createdAt: row.createTime,
      active,
    }
  }
}
