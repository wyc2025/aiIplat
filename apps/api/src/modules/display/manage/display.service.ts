import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ErrorCode } from '../../../common/constants/error-code'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import { AppFacade } from '../../app/facade/app-facade.service'
import { CloudFacade } from '../../cloud/facade/cloud-facade.service'
import { SiteFacade, type MySiteInfo } from '../../site/facade/site-facade.service'

/** 展示应用状态（D112）：1 正常 / 0 已删除（软删） */
export const DISPLAY_STATUS_ACTIVE = 1

/** 展示应用名长度上限（D112：列 VARCHAR(64)，业务限 40 留余量） */
export const DISPLAY_NAME_MAX = 40

/** 站点目录内展示应用子目录名（ARCH §30.3：`{站点目录}/disp/{displayId}/`） */
export const DISP_DIR = 'disp'

/**
 * 授权判定主体（P15 R138 / ARCHITECTURE-P15 §6）：本期实现 `display` 分支（查 `disp_grant`）；
 * `credential` 分支由 access 域自行完成（R132 第 2~4 步，凭证判定不需要 `disp_grant`），
 * 此处保留签名占位——下期 MCP 适配器（D129）复用同一主体模型。
 */
export type AccessPrincipal =
  | { type: 'display'; displayId: bigint }
  | { type: 'credential'; credentialId: bigint; appId: bigint }

/** 展示应用视图（后管与 AI 工具出域形态；bigint 一律转字符串） */
export interface DisplayView {
  id: string
  name: string
  siteId: string | null
  siteSlug: string | null
  siteTitle: string | null
  /** 挂靠态 = 站点内相对路径（`disp/{id}`）；未挂靠 = 云盘暂存区相对路径 */
  folderPath: string
  /** **写文件用路径**（相对用户云盘根）：挂靠 = `{slug}/disp/{id}`；未挂靠 = 暂存区路径 */
  writePath: string
  /** 挂靠后的开放层入口（未挂靠为 null） */
  urlPreview: string | null
  grantCount: number
  grants: Array<{ appId: string; appCode: string }>
  createdAt: Date
}

/**
 * 展示应用服务（P14 T125 / D112~D116，ARCHITECTURE §30）。
 *
 * 文件与托管模型（§30.3）：展示应用目录**物理位于所挂靠站点目录内**（`{slug}/disp/{id}/`，相对用户云盘根），
 * 未挂靠时位于云盘暂存区（`{display.stagingPath}/{ownerId}/{id}/`）；换挂靠 = 目录物理移动 + `site_id`
 * 更新（R127：移动中断全回滚，暂存区与站点目录不得出现同一展示应用双份文件）。
 *
 * 跨域纪律（铁律 3/6）：站点信息经 `SiteFacade`、目录机械操作经 `CloudFacade`、
 * 数据应用校验与取数面缓存失效经 `AppFacade`；本域不 import 任何其他域的内部实现。
 */
@Injectable()
export class DisplayService {
  private readonly logger = new Logger(DisplayService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly cloudFacade: CloudFacade,
    private readonly siteFacade: SiteFacade,
    private readonly appFacade: AppFacade,
  ) {}

  // ==================== 查询 ====================

  /** 我的展示应用列表（含挂靠站点与授权清单；软删不列） */
  async list(userId: bigint): Promise<DisplayView[]> {
    const displays = await this.prisma.dispDisplay.findMany({
      where: { ownerId: userId, status: DISPLAY_STATUS_ACTIVE, deletedAt: null },
      orderBy: [{ id: 'asc' }],
    })
    if (displays.length === 0) return []
    const sites = await this.siteFacade.getSites(userId)
    const siteById = new Map(sites.map((site) => [site.id.toString(), site]))
    const grants = await this.prisma.dispGrant.findMany({
      where: { displayId: { in: displays.map((display) => display.id) } },
      orderBy: [{ id: 'asc' }],
      select: { displayId: true, appId: true },
    })
    const appCodes = await this.appFacade.appCodesByIds(
      userId,
      [...new Set(grants.map((grant) => grant.appId))],
    )
    const codeById = new Map(appCodes.map((item) => [item.id, item.code]))
    return displays.map((display) => {
      const site = display.siteId === null ? null : (siteById.get(display.siteId.toString()) ?? null)
      const own = grants.filter((grant) => grant.displayId === display.id)
      return this.toView(
        display,
        site,
        own.map((grant) => ({
          appId: grant.appId.toString(),
          appCode: codeById.get(grant.appId.toString()) ?? '',
        })),
      )
    })
  }

  // ==================== 创建 / 挂靠 / 删除 ====================

  /** 创建展示应用（D112）：未指定站点 → 暂存区；重名 50018（owner 内唯一） */
  async create(userId: bigint, input: { name: string; siteSlug?: string }): Promise<DisplayView> {
    const name = (input.name ?? '').trim()
    this.assertName(name)
    await this.assertNameFree(userId, name)
    const site = input.siteSlug ? await this.requireOwnedSite(userId, input.siteSlug) : null

    // 先落行拿 id（目录路径含 id），再回写挂靠信息（同一请求内两步，无并发窗口）
    const created = await this.prisma.dispDisplay.create({
      data: { ownerId: userId, name, siteId: null, folderPath: '', status: DISPLAY_STATUS_ACTIVE },
    })
    const folderPath = site
      ? this.siteRelPath(created.id)
      : this.stagingRelPath(userId, created.id)
    const updated = await this.prisma.dispDisplay.update({
      where: { id: created.id },
      data: { siteId: site ? site.id : null, folderPath },
    })
    return this.toView(updated, site, [])
  }

  /**
   * 挂靠 / 换挂靠 / 取消挂靠（D116 / R127）：目录物理移动 + `site_id` 更新；
   * 库更新失败 → 反向移动补偿（移动中断 = 全回滚）；源目录不存在（尚未写文件）→ 跳过移动，
   * 仅更新挂靠关系（AI 之后写文件时自动 mkdir -p 到站点目录）。
   */
  async affiliate(
    userId: bigint,
    id: bigint,
    siteSlug?: string | null,
  ): Promise<DisplayView & { moved: boolean }> {
    const display = await this.requireOwned(userId, id)
    const target = siteSlug ? await this.requireOwnedSite(userId, siteSlug) : null
    if (target && display.siteId !== null && target.id === display.siteId) {
      throw new BusinessException(ErrorCode.ParamInvalid, '该展示应用已挂靠此站点')
    }
    const currentSite =
      display.siteId === null ? null : await this.siteFacade.getSiteInfo(userId, display.siteId)
    if (display.siteId !== null && !currentSite) {
      throw new BusinessException(ErrorCode.DisplayNotFound, '展示应用挂靠的站点已不存在，请先重新挂靠')
    }

    // 移动基点 = 用户云盘根；from/to 均为「父目录」，目录名（id）保持不变
    const from = currentSite
      ? `${currentSite.slug}/${DISP_DIR}`
      : `${this.stagingRoot()}/${userId.toString()}`
    const to = target
      ? `${target.slug}/${DISP_DIR}`
      : `${this.stagingRoot()}/${userId.toString()}`
    const nextFolderPath = target ? this.siteRelPath(display.id) : this.stagingRelPath(userId, display.id)

    const moved = await this.moveDir(userId, from, to)
    try {
      const updated = await this.prisma.dispDisplay.update({
        where: { id: display.id },
        data: { siteId: target ? target.id : null, folderPath: nextFolderPath },
      })
      return { ...this.toView(updated, target, []), moved }
    } catch (error) {
      if (moved) await this.moveDir(userId, to, from).catch(() => false)
      throw error
    }
  }

  /** 软删展示应用（API §21.1-4）：清授权边；目录保留于云盘由用户处置；改名释放唯一槽 */
  async remove(userId: bigint, id: bigint): Promise<{ ok: true; id: string }> {
    const display = await this.requireOwned(userId, id)
    const grants = await this.prisma.dispGrant.findMany({
      where: { displayId: display.id },
      select: { appId: true },
    })
    await this.prisma.$transaction([
      this.prisma.dispGrant.deleteMany({ where: { displayId: display.id } }),
      this.prisma.dispDisplay.update({
        where: { id: display.id },
        data: {
          status: 0,
          deletedAt: new Date(),
          // 释放唯一槽（同 app_table 口径，用户不可见）
          name: `__deleted_${display.id.toString()}`,
        },
      }),
    ])
    for (const appId of [...new Set(grants.map((grant) => grant.appId))]) {
      await this.appFacade.invalidatePublicCache(appId).catch(() => undefined)
    }
    return { ok: true, id: display.id.toString() }
  }

  // ==================== 授权（D114：数据应用 → 展示应用） ====================

  /** 授权（重复授权 50017；数据应用未发布 is_public=0 时给出提示但仍可授权，API §21.1-5） */
  async grant(
    userId: bigint,
    displayId: bigint,
    appCode: string,
  ): Promise<{ ok: true; displayId: string; appCode: string; appName: string; isPublic: number }> {
    const display = await this.requireOwned(userId, displayId)
    const app = await this.appFacade.appIdByCode(userId, appCode)
    const appId = BigInt(app.appId)
    const exists = await this.prisma.dispGrant.findFirst({
      where: { appId, displayId: display.id },
      select: { id: true },
    })
    if (exists) {
      throw new BusinessException(
        ErrorCode.DisplayGrantConflict,
        `数据应用「${app.appCode}」已授权给展示应用「${display.name}」`,
      )
    }
    await this.prisma.dispGrant.create({ data: { appId, displayId: display.id, grantedBy: userId } })
    await this.appFacade.invalidatePublicCache(appId).catch(() => undefined)
    return {
      ok: true,
      displayId: display.id.toString(),
      appCode: app.appCode,
      appName: app.name,
      isPublic: app.isPublic,
    }
  }

  /** 撤权（授权不存在 50017） */
  async revoke(
    userId: bigint,
    displayId: bigint,
    appCode: string,
  ): Promise<{ ok: true; displayId: string; appCode: string }> {
    const display = await this.requireOwned(userId, displayId)
    const app = await this.appFacade.appIdByCode(userId, appCode)
    const appId = BigInt(app.appId)
    const edge = await this.prisma.dispGrant.findFirst({
      where: { appId, displayId: display.id },
      select: { id: true },
    })
    if (!edge) {
      throw new BusinessException(ErrorCode.DisplayGrantConflict, '授权关系不存在')
    }
    await this.prisma.dispGrant.delete({ where: { id: edge.id } })
    await this.appFacade.invalidatePublicCache(appId).catch(() => undefined)
    return { ok: true, displayId: display.id.toString(), appCode: app.appCode }
  }

  // ==================== 开放层支撑（R125 / §30.3） ====================

  /**
   * R125 修订版第 ③ 步（P15 R138 主体化）：该**展示应用**是否被授予此数据应用。
   * 未命中一律 **40400**（对外不区分原因，防探测口径沿用）。
   *
   * P15 D123 收窄：判定粒度由「站点级」收窄为「展示应用级」——原先「站点下任一挂靠展示应用命中
   * 即放行」会让**同站点其他未授权的展示应用**也能调同一接口；现挂靠校验（存在 / 未软删 / 本站点）
   * 由 `resolveForOpen` 前置完成，本方法只按 `displayId` 精确查 `disp_grant` 命中。
   *
   * `credential` 主体不经本方法（凭证判定由 access 域完成，R132 第 2~4 步），签名预留多主体。
   */
  async assertCanRead(appId: bigint, principal: AccessPrincipal): Promise<void> {
    if (principal.type !== 'display') {
      // 凭证主体不走 disp_grant（R132 由 access 域自行判定）；防御性 40400
      throw new BusinessException(ErrorCode.NotFound, '资源不存在')
    }
    const display = await this.prisma.dispDisplay.findFirst({
      where: { id: principal.displayId, status: DISPLAY_STATUS_ACTIVE, deletedAt: null },
      select: { id: true },
    })
    if (!display) {
      throw new BusinessException(ErrorCode.NotFound, '资源不存在')
    }
    const hit = await this.prisma.dispGrant.findFirst({
      where: { appId, displayId: display.id },
      select: { id: true },
    })
    if (!hit) {
      throw new BusinessException(ErrorCode.NotFound, '资源不存在')
    }
  }

  /**
   * 开放层静态服务解析（`:slug/disp/:id/**`）：展示应用存在、未软删、且挂靠在本站点
   * → 返回站点内相对路径与属主（未挂靠/挂他站/已删一律 40400；暂存区不对外服务，§30.8 ④）。
   */
  async resolveForOpen(
    siteId: bigint,
    displayId: bigint,
  ): Promise<{ displayId: string; relPath: string; ownerId: string }> {
    const display = await this.prisma.dispDisplay.findFirst({
      where: { id: displayId, siteId, status: DISPLAY_STATUS_ACTIVE, deletedAt: null },
      select: { id: true, ownerId: true },
    })
    if (!display) {
      throw new BusinessException(ErrorCode.NotFound, '资源不存在')
    }
    return {
      displayId: display.id.toString(),
      relPath: this.siteRelPath(display.id),
      ownerId: display.ownerId.toString(),
    }
  }

  // ==================== 市场 bundle（T129 / D117 / §30.6） ====================

  /**
   * bundle 导出（出边闭包）：该数据应用授权的全部展示应用 + 其文本文件内容。
   * 挂靠态从站点目录 `disp/{id}/` 子树读取；未挂靠态只带名称（文件在暂存区，不进包）；
   * 单个展示应用文件读取失败 → 该应用 `files` 为空但仍随包（授权边不丢）。
   */
  async exportBundle(
    ownerId: bigint,
    appId: bigint,
  ): Promise<{
    displays: Array<{ name: string; files: Array<{ path: string; content: string }> }>
    grants: Array<{ displayName: string }>
    skipped: string[]
  }> {
    const edges = await this.prisma.dispGrant.findMany({
      where: { appId },
      select: { displayId: true },
    })
    if (edges.length === 0) return { displays: [], grants: [], skipped: [] }
    const displays = await this.prisma.dispDisplay.findMany({
      where: {
        id: { in: edges.map((edge) => edge.displayId) },
        ownerId,
        status: DISPLAY_STATUS_ACTIVE,
        deletedAt: null,
      },
      orderBy: [{ id: 'asc' }],
    })
    const result: Array<{ name: string; files: Array<{ path: string; content: string }> }> = []
    const skipped: string[] = []
    for (const display of displays) {
      let files: Array<{ path: string; content: string }> = []
      try {
        files = await this.readDisplayFiles(ownerId, display)
      } catch (error) {
        this.logger.warn(`展示应用文件随包读取失败（仅带名称）：${display.name}｜${String(error)}`)
        skipped.push(display.name)
      }
      result.push({ name: display.name, files })
    }
    return {
      displays: result,
      grants: result.map((item) => ({ displayName: item.name })),
      skipped,
    }
  }

  /**
   * bundle 物化（复制侧）：为接收方创建展示应用副本（重名 `(2)…(n)` 递增）并写入随包文本文件，
   * 再按 `displayName → 新 id` 重建授权边（指向**新 appId 与副本**，跨属主问题自然消解）。
   * 副本一律进未挂靠暂存区（D117：挂靠不随复制）；单个展示应用失败只计入 `skipped`，不中断整体。
   */
  async materializeBundle(
    userId: bigint,
    newAppId: bigint,
    input: {
      displays: Array<{ name: string; files: Array<{ path: string; content: string }> }>
      grants: Array<{ displayName: string }>
    },
  ): Promise<{ displays: Array<{ id: string; name: string; siteId: string | null }>; skipped: string[] }> {
    if (input.displays.length === 0) return { displays: [], skipped: [] }
    const maxSuffix = this.config.get<number>('display.copyNameSuffixMax', 20)
    const created: Array<{ id: string; name: string; siteId: string | null }> = []
    const idByName = new Map<string, bigint>()
    const skipped: string[] = []

    for (const item of input.displays) {
      try {
        const name = await this.uniqueNameForCopy(userId, item.name, maxSuffix)
        const row = await this.prisma.dispDisplay.create({
          data: { ownerId: userId, name, siteId: null, folderPath: '', status: DISPLAY_STATUS_ACTIVE },
        })
        const folderPath = this.stagingRelPath(userId, row.id)
        await this.prisma.dispDisplay.update({ where: { id: row.id }, data: { folderPath } })
        for (const file of item.files) {
          try {
            await this.cloudFacade.writeUserFile(userId, `${folderPath}/${file.path}`, file.content)
          } catch (error) {
            this.logger.warn(`随包展示文件写入跳过：${name}/${file.path}｜${String(error)}`)
          }
        }
        idByName.set(item.name, row.id)
        created.push({ id: row.id.toString(), name, siteId: null })
      } catch (error) {
        this.logger.warn(`展示应用副本创建失败，已跳过：${item.name}｜${String(error)}`)
        skipped.push(item.name)
      }
    }

    for (const grant of input.grants) {
      const displayId = idByName.get(grant.displayName)
      if (!displayId) continue
      await this.prisma.dispGrant
        .create({ data: { appId: newAppId, displayId, grantedBy: userId } })
        .catch(() => undefined)
    }
    return { displays: created, skipped }
  }

  /** 复制重名递增：`名称` → `名称(2)` … `名称(maxSuffix)`；耗尽抛 50018（由调用方计入 skipped） */
  private async uniqueNameForCopy(userId: bigint, base: string, maxSuffix: number): Promise<string> {
    for (let index = 1; index <= maxSuffix; index++) {
      const candidate = index === 1 ? base : `${base}(${index})`
      if (candidate.length > 64) continue
      const exists = await this.prisma.dispDisplay.findFirst({
        where: { ownerId: userId, name: candidate },
        select: { id: true },
      })
      if (!exists) return candidate
    }
    throw new BusinessException(ErrorCode.DisplayNameConflict, `展示应用重名递增超限：${base}`)
  }

  /** 读展示应用目录下文本文件（挂靠态经站点目录；未挂靠返回空清单） */
  private async readDisplayFiles(
    ownerId: bigint,
    display: { id: bigint; siteId: bigint | null },
  ): Promise<Array<{ path: string; content: string }>> {
    if (display.siteId === null) return []
    const site = await this.siteFacade.getSiteInfo(ownerId, display.siteId)
    if (!site) return []
    const prefix = `${this.siteRelPath(display.id)}/`
    const { files } = await this.cloudFacade.listSubtreeRaw(site.rootFolderId)
    const result: Array<{ path: string; content: string }> = []
    for (const entry of files) {
      if (entry.isDir || !entry.path.startsWith(prefix)) continue
      const relative = entry.path.slice(prefix.length)
      try {
        const raw = await this.cloudFacade.readFileRaw(site.rootFolderId, entry.path)
        result.push({ path: relative, content: raw.content.toString('utf-8') })
      } catch (error) {
        // 非文本白名单 / 超读上限：不随包（R128：二进制素材断链自担）
        this.logger.warn(`随包读取跳过（非文本或超限）：${entry.path}｜${String(error)}`)
      }
    }
    return result
  }

  // ==================== 内部 ====================

  /** 目录移动（基点 = 用户云盘根）：源不存在返回 false（空目录挂靠）；失败抛 50016 语义错 */
  private async moveDir(userId: bigint, from: string, to: string): Promise<boolean> {
    if (from === to) return false
    const exists = await this.cloudFacade.existsUserPath(userId, from)
    if (!exists) return false
    const results = await this.cloudFacade.moveUserFiles(userId, [{ from, to }])
    const failed = results.find((item) => !item.ok)
    if (failed) {
      throw new BusinessException(
        ErrorCode.DisplayNotFound,
        `展示应用目录移动失败：${failed.error ?? '未知原因'}`,
      )
    }
    return true
  }

  /** 属主校验（不存在/已删/非属主统一 50016） */
  private async requireOwned(userId: bigint, id: bigint) {
    const display = await this.prisma.dispDisplay.findFirst({
      where: { id, ownerId: userId, status: DISPLAY_STATUS_ACTIVE, deletedAt: null },
    })
    if (!display) {
      throw new BusinessException(ErrorCode.DisplayNotFound, '展示应用不存在或已删除')
    }
    return display
  }

  /** 站点必须属主且存在（40119 文案不暴露他人站点存在性；未建站/多站歧义 → 40001 引导） */
  private async requireOwnedSite(userId: bigint, slug: string): Promise<MySiteInfo> {
    const resolution = await this.siteFacade.resolveSite(userId, slug)
    if (resolution.status === 'ok') return resolution.site
    if (resolution.status === 'notfound') {
      throw new BusinessException(ErrorCode.SiteForbidden, `站点不存在或非属主：${slug}`)
    }
    throw new BusinessException(ErrorCode.ParamInvalid, '站点不可用（请先建站并确认 slug）')
  }

  private assertName(name: string): void {
    if (!name) {
      throw new BusinessException(ErrorCode.ParamInvalid, '展示应用名必填')
    }
    if (name.length > DISPLAY_NAME_MAX) {
      throw new BusinessException(ErrorCode.ParamInvalid, `展示应用名不能超过 ${DISPLAY_NAME_MAX} 字`)
    }
  }

  /** 同名占用检查（含软删行，避免撞 DB 唯一索引；DB 兜底 50018） */
  private async assertNameFree(userId: bigint, name: string): Promise<void> {
    const exists = await this.prisma.dispDisplay.findFirst({
      where: { ownerId: userId, name },
      select: { id: true },
    })
    if (exists) {
      throw new BusinessException(ErrorCode.DisplayNameConflict, `展示应用名已存在：${name}`)
    }
  }

  private toView(
    display: {
      id: bigint
      name: string
      siteId: bigint | null
      folderPath: string
      createdAt: Date
    },
    site: MySiteInfo | null,
    grants: Array<{ appId: string; appCode: string }>,
  ): DisplayView {
    return {
      id: display.id.toString(),
      name: display.name,
      siteId: display.siteId === null ? null : display.siteId.toString(),
      siteSlug: site?.slug ?? null,
      siteTitle: site?.title ?? null,
      folderPath: display.folderPath,
      // 写文件基点 = 用户云盘根：挂靠态需拼站点 slug（AI 用云盘写文件工具直接可用）
      writePath: site ? `${site.slug}/${DISP_DIR}/${display.id.toString()}` : display.folderPath,
      urlPreview: site ? `/api/open/${site.slug}/disp/${display.id.toString()}/` : null,
      grantCount: grants.length,
      grants,
      createdAt: display.createdAt,
    }
  }

  /** 暂存区根目录名（配置 display.stagingPath，默认 disp-staging） */
  private stagingRoot(): string {
    return this.config.get<string>('display.stagingPath', 'disp-staging')
  }

  /** 未挂靠目录（相对用户云盘根）：`{stagingPath}/{ownerId}/{displayId}` */
  private stagingRelPath(userId: bigint, displayId: bigint): string {
    return `${this.stagingRoot()}/${userId.toString()}/${displayId.toString()}`
  }

  /** 挂靠目录（相对**站点根**）：`disp/{displayId}`（开放层静态路由相对站点根，slug 变更不影响） */
  private siteRelPath(displayId: bigint): string {
    return `${DISP_DIR}/${displayId.toString()}`
  }
}
