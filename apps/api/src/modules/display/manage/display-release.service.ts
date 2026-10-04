import { Injectable, Logger } from '@nestjs/common'
import type { DispRelease } from '@prisma/client'
import { ErrorCode } from '../../../common/constants/error-code'
import { RedisKey } from '../../../common/constants/redis-key'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { copyCloudTree } from '../../../common/utils/cloud-tree-copy.util'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import { RedisService } from '../../../infra/redis/redis.service'
import { StorageService } from '../../../infra/storage/storage.service'
import { CloudFacade } from '../../cloud/facade/cloud-facade.service'

/** 检查点视图（管理侧出域形态；bigint → string） */
export interface DispReleaseView {
  id: string
  versionNo: number
  label: string | null
  fileCount: number
  totalBytes: string
  pinned: boolean
  createdBy: string
  createTime: Date
}

/** 保存锁 TTL（秒）：覆盖一次工作区复制，异常退出后自动释放 */
const SAVE_LOCK_TTL_SEC = 120
/** 遍历深度上限（防环；与站点快照同量级） */
const SNAPSHOT_MAX_DEPTH = 20
/** 清单文件名（随检查点目录落盘，不进请求热路径） */
const MANIFEST_NAME = 'manifest.json'

/**
 * 展示应用版本检查点（P20 T167，D152）。
 *
 * 「保存」= 把展示应用工作区复制成**不可变快照**（`disp-releases/{displayId}/{releaseId}/`）
 * 并落一行 `disp_release`；「恢复」= 把某个检查点写回工作区。
 *
 * 使用场景是**回退**：AI 改坏页面、或误删文件时，有个能一键回到的版本。
 * 与站点发布（`SiteReleaseService`）刻意**分治**：
 * - 站点发布是「上线」（面向公网，快照不可变、指针翻转、原子生效）；
 * - 检查点是「存档」（面向属主，可反复写回工作区）。
 * 两者节奏不同（展示应用不必随站点发布），故不共用表，也不互为前提。
 *
 * 工作区读写的遍历与复制复用 `common/utils/cloud-tree-copy.util`（与站点快照同一实现）；
 * 写回工作区经 `CloudFacade`（铁律 5：展示应用域不直操 `cloud_file`）。
 */
@Injectable()
export class DisplayReleaseService {
  private readonly logger = new Logger(DisplayReleaseService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly storage: StorageService,
    private readonly cloudFacade: CloudFacade,
  ) {}

  // ==================== 对外 ====================

  /** 保存当前工作区为检查点（同应用内序号递增；Redis 锁互斥防并发重号） */
  async save(userId: bigint, displayId: bigint, label?: string): Promise<DispReleaseView> {
    const display = await this.requireOwned(userId, displayId)
    const lockKey = RedisKey.dispReleaseLock(display.id.toString())
    const acquired = await this.redis.client.set(lockKey, '1', 'EX', SAVE_LOCK_TTL_SEC, 'NX')
    if (acquired !== 'OK') {
      throw new BusinessException(ErrorCode.DisplayReleaseConflict, '该展示页正在保存版本，请稍后再试')
    }
    let tmpDir: string | null = null
    try {
      // 工作区目录恒在（B1：建应用时即创建）；不存在视为「还没有页面文件」
      const workDirId = await this.cloudFacade.resolveUserDirId(
        userId,
        this.workRelPath(userId, display.id),
      )
      if (workDirId === null) {
        throw new BusinessException(ErrorCode.ParamInvalid, '这个展示页还没有页面文件，无需保存版本')
      }

      const row = await this.prisma.dispRelease.create({
        data: {
          displayId: display.id,
          versionNo: await this.nextVersionNo(display.id),
          label: label?.trim() ? label.trim() : null,
          fileCount: 0,
          totalBytes: BigInt(0),
          createdBy: userId,
        },
      })
      tmpDir = this.storage.dispReleaseDirOf(display.id, row.id, true)
      const finalDir = this.storage.dispReleaseDirOf(display.id, row.id, false)
      await this.storage.removeDir(tmpDir)

      const { entries, fileCount, totalBytes } = await copyCloudTree(this.prisma, this.storage, {
        userId,
        rootFolderId: workDirId,
        destDir: tmpDir,
        maxDepth: SNAPSHOT_MAX_DEPTH,
        warn: (message: string) => this.logger.warn(message),
      })
      await this.storage.writeInto(
        tmpDir,
        MANIFEST_NAME,
        Buffer.from(JSON.stringify(entries), 'utf-8'),
      )
      await this.storage.renameDir(tmpDir, finalDir)
      tmpDir = null

      const saved = await this.prisma.dispRelease.update({
        where: { id: row.id },
        data: { fileCount, totalBytes: BigInt(totalBytes) },
      })
      return this.toView(saved)
    } catch (error) {
      if (tmpDir) await this.storage.removeDir(tmpDir).catch(() => undefined)
      // 落库成功但复制失败的半成品：把行删掉，避免留下引用不到快照的空版本
      throw error
    } finally {
      await this.redis.client.del(lockKey)
    }
  }

  /** 检查点列表（新→旧；`totalBytes` 出域为字符串） */
  async list(userId: bigint, displayId: bigint): Promise<DispReleaseView[]> {
    await this.requireOwned(userId, displayId)
    const rows = await this.prisma.dispRelease.findMany({
      where: { displayId },
      orderBy: { versionNo: 'desc' },
    })
    return rows.map((row) => this.toView(row))
  }

  /**
   * 恢复到工作区：先把工作区现有内容**软删进回收站**（用户可再撤），再把检查点写回。
   *
   * 之所以先删：检查点恢复的语义是「回到那个状态」，若只覆盖同名文件，检查点之后**新增**的文件
   * 会残留，用户看到的就不是那个版本了。软删而非硬删，是为了让「恢复错了」还能撤回。
   */
  async restore(
    userId: bigint,
    displayId: bigint,
    releaseId: bigint,
  ): Promise<{ ok: true; restoredFiles: number; removedFiles: number }> {
    const display = await this.requireOwned(userId, displayId)
    const release = await this.requireRelease(display.id, releaseId)
    const finalDir = this.storage.dispReleaseDirOf(display.id, release.id, false)
    if (!(await this.storage.dirExists(finalDir))) {
      throw new BusinessException(ErrorCode.NotFound, '该版本的备份内容已不存在')
    }
    const manifest = await this.readManifest(finalDir)

    // ① 清空工作区现有文件（软删 → 回收站，可撤回）
    //    注意路径口径：`listSubtreeRaw` 返回的 path 相对**起始目录**，而 `deleteUserFiles`
    //    从云盘根解析，故此处必须拼回工作区前缀（否则删不到，表现为「多余文件残留」）
    const workPrefix = this.workRelPath(userId, display.id)
    const workDirId = await this.cloudFacade.resolveUserDirId(userId, workPrefix)
    const subtree =
      workDirId === null ? { files: [] } : await this.cloudFacade.listSubtreeRaw(workDirId)
    const removed = subtree.files
      .filter((file) => !file.isDir)
      .map((file) => `${workPrefix}/${file.path}`)
    if (removed.length > 0) {
      await this.cloudFacade.deleteUserFiles(userId, removed)
    }

    // ② 写回检查点内容
    let restoredFiles = 0
    for (const relPath of Object.keys(manifest)) {
      const content = await this.readSnapshotFile(finalDir, relPath)
      if (content === null) continue
      await this.cloudFacade.writeUserFile(userId, this.workRelPath(userId, display.id, relPath), content)
      restoredFiles += 1
    }
    return { ok: true, restoredFiles, removedFiles: removed.length }
  }

  /** 锁定 / 解锁（锁定后豁免自动清理与手动删除） */
  async pin(userId: bigint, displayId: bigint, releaseId: bigint, pinned: boolean): Promise<DispReleaseView> {
    const display = await this.requireOwned(userId, displayId)
    const release = await this.requireRelease(display.id, releaseId)
    const updated = await this.prisma.dispRelease.update({
      where: { id: release.id },
      data: { pinned: pinned ? 1 : 0 },
    })
    return this.toView(updated)
  }

  /** 删除检查点（锁定的需先解锁；快照目录一并清理） */
  async remove(userId: bigint, displayId: bigint, releaseId: bigint): Promise<{ ok: true }> {
    const display = await this.requireOwned(userId, displayId)
    const release = await this.requireRelease(display.id, releaseId)
    if (release.pinned === 1) {
      throw new BusinessException(ErrorCode.DisplayReleaseConflict, '该版本已锁定，请先解锁再删除')
    }
    await this.prisma.dispRelease.delete({ where: { id: release.id } })
    await this.storage
      .removeDir(this.storage.dispReleaseDirOf(display.id, release.id, false))
      .catch(() => undefined)
    return { ok: true }
  }

  // ==================== 内部 ====================

  /** 展示应用存在、属主匹配、未软删（否则 40400 防探测） */
  private async requireOwned(userId: bigint, displayId: bigint) {
    const display = await this.prisma.dispDisplay.findUnique({ where: { id: displayId } })
    if (!display || display.ownerId !== userId || display.deletedAt !== null || display.status !== 1) {
      throw new BusinessException(ErrorCode.NotFound, '资源不存在')
    }
    return display
  }

  private async requireRelease(displayId: bigint, releaseId: bigint): Promise<DispRelease> {
    const release = await this.prisma.dispRelease.findUnique({ where: { id: releaseId } })
    if (!release || release.displayId !== displayId) {
      throw new BusinessException(ErrorCode.NotFound, '资源不存在')
    }
    return release
  }

  /** 应用内序号：max+1（并发由 Redis 锁互斥，唯一索引兜底） */
  private async nextVersionNo(displayId: bigint): Promise<number> {
    const latest = await this.prisma.dispRelease.findFirst({
      where: { displayId },
      orderBy: { versionNo: 'desc' },
      select: { versionNo: true },
    })
    return (latest?.versionNo ?? 0) + 1
  }

  /** 工作区相对路径（P20 B1 恒定位：`disp-staging/{ownerId}/{displayId}[/{relPath}]`） */
  private workRelPath(userId: bigint, displayId: bigint, relPath?: string): string {
    const base = `${this.stagingRoot}/${userId.toString()}/${displayId.toString()}`
    return relPath ? `${base}/${relPath}` : base
  }

  private get stagingRoot(): string {
    return 'disp-staging'
  }

  private async readManifest(dir: string): Promise<Record<string, unknown>> {
    const text = await this.readSnapshotFile(dir, MANIFEST_NAME)
    if (text === null) return {}
    try {
      return JSON.parse(text) as Record<string, unknown>
    } catch {
      return {}
    }
  }

  /** 读检查点目录内的文本文件（内容不合法 / 不存在 → null，调用方跳过） */
  private readSnapshotFile(dir: string, relPath: string): Promise<string | null> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = []
      const stream = this.storage.createDirReadStream(dir, relPath)
      stream.on('data', (chunk: Buffer) => chunks.push(chunk))
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
      stream.on('error', () => resolve(null))
    })
  }

  private toView(row: DispRelease): DispReleaseView {
    return {
      id: row.id.toString(),
      versionNo: row.versionNo,
      label: row.label,
      fileCount: row.fileCount,
      totalBytes: row.totalBytes.toString(),
      pinned: row.pinned === 1,
      createdBy: row.createdBy.toString(),
      createTime: row.createTime,
    }
  }
}
