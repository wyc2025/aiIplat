import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { randomBytes } from 'node:crypto'
import type { CloudFile } from '@prisma/client'
import { ErrorCode } from '../../../common/constants/error-code'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import { StorageService } from '../../../infra/storage/storage.service'
import { SiteRootService } from '../../site/facade/site-root.service'
import type {
  FileListQueryDto,
  MkdirDto,
  MoveFileDto,
  RenameDto,
  SetPublicDto,
  SetPublicLinkDto,
  UpdateContentDto,
} from './dto/file.dto'

/** 目录深度上限（R6） */
const MAX_DEPTH = 10
/** 头像记录的虚拟父目录（不可达，避免污染根目录列表）：BigInt(-1) */
export const AVATAR_PARENT_ID = BigInt(-1)
/** 单目录直接子项上限（R6；TransferService 上传计数复用，故导出） */
export const MAX_CHILDREN = 500

/** 在线编辑文本扩展名白名单（P4b §15.12：与 site 域 SITE_FILE_TEXT_EXTS 同集，写死代码，两边以架构增补为准对齐） */
const EDITABLE_TEXT_EXTS: ReadonlySet<string> = new Set([
  'html',
  'htm',
  'css',
  'js',
  'mjs',
  'txt',
  'md',
  'json',
  'svg',
  'xml',
  'yml',
  'yaml',
  'csv',
])

/** 在线编辑内容上限（§15.12：1MB，字节级在 service 精算） */
const EDIT_MAX_BYTES = 1024 * 1024

@Injectable()
export class FileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly storage: StorageService,
    private readonly siteRoot: SiteRootService,
  ) {}

  /** 目录内容列表：文件夹在前（名称升序），文件在后（修改时间倒序），不分页 */
  async list(userId: bigint, query: FileListQueryDto) {
    const parentId = BigInt(query.parentId ?? 0)
    // 父目录归属校验（根目录跳过）
    if (parentId !== BigInt(0)) {
      await this.assertOwned(parentId, userId, false)
    }

    const children = await this.prisma.cloudFile.findMany({
      where: { userId, parentId, deletedAt: null },
    })
    const dirs = children
      .filter((f) => f.isDir === 1)
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
    const files = children
      .filter((f) => f.isDir === 0)
      .sort((a, b) => b.updateTime.getTime() - a.updateTime.getTime())

    // 聚合"有效分享"标记（P4d D48 起文件夹亦可分享，故目录与文件一并统计）：
    // 有 status=1 且未过期的链接 → shared=true
    const sharedIds = [...dirs, ...files].map((f) => f.id)
    const sharedSet = new Set<bigint>()
    if (sharedIds.length > 0) {
      const shares = await this.prisma.cloudShare.findMany({
        where: { userId, fileId: { in: sharedIds }, status: 1 },
        select: { fileId: true, expireAt: true },
      })
      const now = Date.now()
      for (const s of shares) {
        if (!s.expireAt || s.expireAt.getTime() >= now) {
          sharedSet.add(s.fileId)
        }
      }
    }

    // R46（P4d T52）/ R51（P4E T59）：inSite 标记——沿 parentId 上溯是否经过「任一」站点根锚点
    // （site_site.root_folder_id）。站点根由 site 域经 SiteRootService 提供（域边界纪律），
    // 上溯在 cloud 域内完成（有界 ≤10，与公开判定链同口径）；多站下根系集合仍很小。
    const siteRootIds = await this.siteRoot.getRootFolderIds(userId)
    const siteRootSet = new Set(siteRootIds)
    const dirInSite =
      parentId !== BigInt(0) && (await this.isWithinAnySubtree(userId, parentId, siteRootSet))

    const list = [...dirs, ...files].map((f) => ({
      id: f.id,
      name: f.name,
      isDir: f.isDir,
      size: f.size,
      ext: f.ext,
      mime: f.mime,
      updateTime: f.updateTime,
      shared: sharedSet.has(f.id),
      // R23（走查 W2 修复）：返回原始三态 int（0=继承 / 1=显式公开 / 2=显式阻断），前端双标签；有效公开性以开放层访问时上溯判定为准
      isPublic: f.isPublic,
      // P4c F1：公开链接 token（仅显式公开行有值，供「复制公开链接」）；allowListing 仅文件夹有意义（D32）
      publicToken: f.isPublic === 1 ? f.publicToken : null,
      allowListing: f.allowListing,
      // P4d R46/D49 + P4E R51：位于任一站点子树内（含站点根本身）→ 前端按钮组改「设为私有/取消私有」；站点外走 token 公开
      inSite: dirInSite || siteRootSet.has(f.id),
      // P4d R45：站点根目录行无「设为私有」（恒公开锚点，整站关闭走站点 status）
      isSiteRoot: siteRootSet.has(f.id),
    }))

    const { quota, used } = await this.getQuota(userId)
    return { list, quota, used }
  }

  /** 面包屑链：从根到当前目录（含当前自身，不含根"我的文件"），根目录返回 [] */
  async path(userId: bigint, id: bigint) {
    if (id === BigInt(0)) return []
    const chain: Array<{ id: bigint; name: string }> = []
    let current = await this.assertOwned(id, userId, false)
    // 上溯到根（parent_id=0 停止），最多 MAX_DEPTH 层防环；先装自身，再逐级向上
    chain.unshift({ id: current.id, name: current.name })
    while (current.parentId !== BigInt(0) && chain.length < MAX_DEPTH) {
      current = await this.assertOwned(current.parentId, userId, false)
      chain.unshift({ id: current.id, name: current.name })
    }
    return chain
  }

  /** 新建文件夹：深度/数量限制 + 同名自动"(1)" */
  async mkdir(userId: bigint, dto: MkdirDto) {
    const parentId = BigInt(dto.parentId)
    if (parentId !== BigInt(0)) {
      await this.assertOwned(parentId, userId, true)
    }

    // 深度限制：当前目录深度已达上限则拒绝（新目录深度 = 父深度 + 1）
    const depth = await this.computeDepth(parentId, userId)
    if (depth + 1 > MAX_DEPTH) {
      throw new BusinessException(ErrorCode.CloudDirLimitExceeded, '目录深度不能超过 10 层')
    }

    // 数量限制
    const count = await this.prisma.cloudFile.count({
      where: { userId, parentId, deletedAt: null },
    })
    if (count >= MAX_CHILDREN) {
      throw new BusinessException(ErrorCode.CloudDirLimitExceeded, '单个目录下子项不能超过 500 个')
    }

    // 同名冲突：自动追加 "(1)"、"(2)"；is_public 不写（默认 0=继承父目录，R2 三态语义）
    const name = await this.resolveNameConflict(userId, parentId, dto.name)

    const created = await this.prisma.cloudFile.create({
      data: { userId, parentId, name, isDir: 1, size: BigInt(0) },
    })
    return { id: created.id.toString(), name }
  }

  /** 重命名：同名冲突阻止（30002） */
  async rename(userId: bigint, dto: RenameDto) {
    const id = BigInt(dto.id)
    const target = await this.assertOwned(id, userId, false)
    if (target.name === dto.name) {
      return { id: id.toString(), name: target.name }
    }
    // 同目录下同名（排除自身、排除回收站项）
    const conflict = await this.prisma.cloudFile.findFirst({
      where: { userId, parentId: target.parentId, name: dto.name, deletedAt: null, NOT: { id } },
    })
    if (conflict) {
      throw new BusinessException(ErrorCode.CloudNameConflict, '同目录下已存在同名项')
    }
    const updated = await this.prisma.cloudFile.update({
      where: { id },
      data: { name: dto.name },
    })
    return { id: updated.id.toString(), name: updated.name }
  }

  /**
   * 移动单个项（P4d F1/T52，剪切粘贴与拖拽移动共用；批量 = 前端队列逐条调用 D42）：
   * 校验链：源归属（30001）→ 源在回收站（30019，R38）→ 目标为当前用户的未删除目录（0=根目录）
   * → 源为站点根（30019，R37）→ 防环：目标位于源子树内（含源自身，30019）→ R39 公开继承标记
   * → 同父目录幂等返回 → R6 目标子项上限/深度上限（30006）→ R4 同名自动"(1)" → 更新 parentId。
   * 公开性按新父目录上溯重新判定（三态自然语义）；token 挂 fileId 不受影响（D30）；used 不变。
   * 响应 `{ id, name, finalName, targetPublic }`：targetPublic 且未带 confirmPublic 时**不执行移动**，
   * 仅返回标记供前端弹 R39 警告后重发（批量场景整批一次确认）。
   */
  async move(userId: bigint, id: bigint, dto: MoveFileDto) {
    const source = await this.prisma.cloudFile.findFirst({ where: { id, userId } })
    if (!source) {
      throw new BusinessException(ErrorCode.CloudFileNotFound, '文件/文件夹不存在或无权访问')
    }
    if (source.deletedAt) {
      throw new BusinessException(ErrorCode.CloudMoveTargetInvalid, '回收站中的项不可移动')
    }

    const targetParentId = BigInt(dto.targetParentId)
    // 目标校验：0=根目录（无实体行）；其余必须为当前用户的未删除文件夹
    if (targetParentId !== BigInt(0)) {
      const target = await this.prisma.cloudFile.findFirst({ where: { id: targetParentId, userId } })
      if (!target) {
        throw new BusinessException(ErrorCode.CloudFileNotFound, '目标目录不存在或无权访问')
      }
      if (target.deletedAt) {
        throw new BusinessException(ErrorCode.CloudMoveTargetInvalid, '目标目录在回收站中，不可移入')
      }
      if (target.isDir !== 1) {
        throw new BusinessException(ErrorCode.CloudFileNotFound, '目标不是文件夹')
      }
    }

    // R37：站点根目录禁止移动（移动会破坏站点子树锚点）
    if (await this.siteRoot.isSiteRoot(userId, source.id)) {
      throw new BusinessException(ErrorCode.CloudMoveTargetInvalid, '站点根目录不可移动')
    }

    // R37 防环：目标不能是源自身，也不能位于源的子树内
    if (
      targetParentId === source.id ||
      (targetParentId !== BigInt(0) && (await this.isWithinSubtree(userId, targetParentId, source.id)))
    ) {
      throw new BusinessException(ErrorCode.CloudMoveTargetInvalid, '不能移动到自身或其子目录下')
    }

    // R39 公开继承标记：目标上溯是否命中公开锚点（首个非继承节点法定生死，与 P4a 三态语义同口径）
    const targetPublic = targetParentId !== BigInt(0) ? await this.isTargetPublic(userId, targetParentId) : false

    // 同父目录：幂等返回（不重命名、不写库）
    if (targetParentId === source.parentId) {
      return { id: source.id.toString(), name: source.name, finalName: source.name, targetPublic }
    }

    // R6：目标目录子项上限（500）
    const childCount = await this.prisma.cloudFile.count({
      where: { userId, parentId: targetParentId, deletedAt: null },
    })
    if (childCount >= MAX_CHILDREN) {
      throw new BusinessException(ErrorCode.CloudDirLimitExceeded, '目标目录子项已达上限 500 个')
    }

    // R6：深度上限（目标深度 + 源子树高度 ≤ 10）
    const targetDepth = await this.computeDepth(targetParentId, userId)
    const height = await this.subtreeHeight(userId, source)
    if (targetDepth + height > MAX_DEPTH) {
      throw new BusinessException(ErrorCode.CloudDirLimitExceeded, '目录深度不能超过 10 层')
    }

    // R4：同名自动 "(1)"（排除源自身，避免同父目录场景误判）
    const finalName = await this.resolveNameConflict(userId, targetParentId, source.name, source.id)

    // R39：未确认公开继承后果时不动库，仅返回标记
    if (targetPublic && dto.confirmPublic !== true) {
      return { id: source.id.toString(), name: source.name, finalName, targetPublic: true }
    }

    await this.prisma.cloudFile.update({
      where: { id },
      data: { parentId: targetParentId, name: finalName },
    })
    return { id: source.id.toString(), name: source.name, finalName, targetPublic }
  }

  /**
   * 删除：软删入回收站（R2：只标记自身，后代不变）；公开行同步置空 token（P4c D30 轮换，还原后旧链接仍 40400）。
   * P4E R52（补 P4a 遗留口子）：命中任一站点根 → 30020，须先在站点侧删除站点（删站走
   * CloudFacade.removeSiteRoot 内部通道，绕过本用户面保护，见 P4E R53）。
   */
  async remove(userId: bigint, id: bigint) {
    const target = await this.assertOwned(id, userId, false)
    if (await this.siteRoot.isSiteRoot(userId, target.id)) {
      throw new BusinessException(
        ErrorCode.CloudSiteRootProtected,
        '站点根目录不能直接删除，请先到「个人网站 → 站点列表」删除站点',
      )
    }
    await this.prisma.cloudFile.update({
      where: { id },
      data: { deletedAt: new Date(), ...(target.publicToken ? { publicToken: null } : {}) },
    })
    return { success: true }
  }

  /**
   * 设为公开 / 取消公开（P4a/R2 修订·三态继承）：仅标记自身，不级联写。
   * API 契约保持二元（1=设为公开 / 0=取消公开），落库映射三态：1→1（显式公开）、0→2（显式阻断）；
   * 子树内新建项默认 0（继承），故阻断/公开均由上溯判定自然级联，无需遍历子树。
   */
  async setPublic(userId: bigint, dto: SetPublicDto) {
    const id = BigInt(dto.id)
    await this.assertOwned(id, userId, false)
    const isPublic = dto.isPublic === 1 ? 1 : 2
    await this.prisma.cloudFile.update({ where: { id }, data: { isPublic } })
    return { id: id.toString(), isPublic: isPublic === 1 }
  }

  /**
   * 创建公开链接（P4c F1/D29/D30）：is_public 置 1 + 生成 public_token。
   * 幂等：已公开且已有 token → 返回既有 token（不重新生成）；isPublic=1 但无 token（历史公开行/轮换后）
   * → 补发新 token。文件夹可传 allowListing（D32）。审核门禁挂接（P3 R9 口径：开关默认关、先空转）。
   * viewUrl：文件 /view/f/{token}，文件夹 /view/d/{token}。
   */
  async createPublicLink(userId: bigint, id: bigint, dto: SetPublicLinkDto) {
    const file = await this.assertOwned(id, userId, false)

    // 审核门禁（R9 口径）：开关开启且未通过审核 → 拒绝（照 share create 同款判断）
    if (this.config.get<boolean>('upload.cloudAuditEnabled', false) && file.auditStatus !== 1) {
      throw new BusinessException(ErrorCode.CloudAuditNotPassed, '文件未通过内容审核，禁止公开')
    }

    // 幂等：已有 token 直接返回（allowListing 参数仍生效，可仅改列表开关）
    const isDir = file.isDir === 1
    const allowListing = dto.allowListing === undefined ? null : (dto.allowListing ? 1 : 0)
    if (file.isPublic === 1 && file.publicToken) {
      if (isDir && allowListing !== null) {
        await this.prisma.cloudFile.update({ where: { id }, data: { allowListing } })
      }
      return this.toPublicLinkResult(id, file.publicToken, isDir, allowListing ?? file.allowListing)
    }

    // 生成 token（R24：URL-safe ≥21 位；唯一索引碰撞重生成重试，最多 5 次）
    for (let attempt = 0; ; attempt++) {
      const token = randomBytes(18).toString('base64url') // 24 字符
      try {
        await this.prisma.cloudFile.update({
          where: { id },
          data: {
            isPublic: 1,
            publicToken: token,
            ...(isDir && allowListing !== null ? { allowListing } : {}),
          },
        })
        return this.toPublicLinkResult(id, token, isDir, isDir ? (allowListing ?? file.allowListing) : null)
      } catch (error) {
        // 唯一索引冲突（P2002）重试；其余错误上抛
        if (attempt >= 4 || (typeof error !== 'object' || error === null || (error as { code?: string }).code !== 'P2002')) {
          throw error
        }
      }
    }
  }

  /**
   * 取消公开（P4c R27）：public_token 置空（轮换，旧链接永久失效）+ is_public 归 0（继承）。
   * 重新公开将生成新 token。
   */
  async cancelPublicLink(userId: bigint, id: bigint) {
    await this.assertOwned(id, userId, false)
    await this.prisma.cloudFile.update({
      where: { id },
      data: { isPublic: 0, publicToken: null },
    })
    return { success: true }
  }

  /** 公开链接响应组装（API-P4C §8.1 契约） */
  private toPublicLinkResult(id: bigint, token: string, isDir: boolean, allowListing: number | null) {
    return {
      publicToken: token,
      viewUrl: isDir ? `/view/d/${token}` : `/view/f/${token}`,
      allowListing,
    }
  }

  /**
   * 在线编辑保存（P4b F4/§15.5）：assertOwned（30001）→ 非目录（40001）→ 白名单（30012）→
   * ≤1MB（30013）→ writeFromBuffer 写新物理 → replaceFileContent（公共行更新）。
   * 更新行语义（D22）：fileId/URL 不变 → site:path 缓存仍有效，开放层立即生效
   * （ETag 随 size/mtime 变化自然失效），无需跨域失效（PRD F4 定论）。
   */
  async saveFileContent(userId: bigint, id: bigint, dto: UpdateContentDto) {
    const file = await this.assertOwned(BigInt(id), userId, false)
    if (file.isDir !== 0) {
      throw new BusinessException(ErrorCode.ParamInvalid, '目标不是文件，无法在线编辑')
    }
    const ext = file.ext ?? ''
    if (!EDITABLE_TEXT_EXTS.has(ext)) {
      throw new BusinessException(ErrorCode.CloudFileTypeNotAllowed, '该文件类型不支持在线编辑（仅文本白名单）')
    }
    const byteLength = Buffer.byteLength(dto.content, 'utf-8')
    if (byteLength > EDIT_MAX_BYTES) {
      throw new BusinessException(ErrorCode.CloudContentTooLarge, '内容超出在线编辑上限（1MB）')
    }
    const newStorageName = await this.storage.writeFromBuffer(Buffer.from(dto.content, 'utf-8'), ext)
    await this.replaceFileContent(userId, file, newStorageName, BigInt(byteLength))
    return { id: file.id.toString(), name: file.name, size: byteLength }
  }

  /**
   * 替换文件内容公共实现（P4b §15.5；R5 覆盖上传与在线编辑保存共用，禁止复制粘贴）：
   * 配额差额校验（delta>0 且超配额 → 30003）→ 事务更新行（storage_name/size/update_time 必更；
   * mime/ext 由覆盖上传场景传入，在线编辑场景文件名不变故不动）+ used 差额记账
   * （$executeRawUnsafe GREATEST 兜底，R5）→ 删旧物理文件（不可回滚，D22）。
   * 落库失败回滚新物理文件（调用方传入前已写好），旧文件保留。
   */
  async replaceFileContent(
    userId: bigint,
    target: Pick<CloudFile, 'id' | 'size' | 'storageName'>,
    newStorageName: string,
    newSize: bigint,
    extra?: { mime?: string | null; ext?: string | null },
  ): Promise<void> {
    const { quota, used } = await this.getQuota(userId)
    const delta = newSize - target.size
    if (delta > BigInt(0) && used + delta > quota) {
      throw new BusinessException(ErrorCode.CloudQuotaExceeded, '存储配额不足')
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.cloudFile.update({
          where: { id: target.id },
          data: {
            size: newSize,
            storageName: newStorageName,
            updateTime: new Date(),
            ...(extra?.mime !== undefined ? { mime: extra.mime } : {}),
            ...(extra?.ext !== undefined ? { ext: extra.ext } : {}),
          },
        })
        await tx.$executeRawUnsafe(
          'UPDATE cloud_usage SET used = GREATEST(used + ?, 0), update_time = NOW() WHERE user_id = ?',
          delta,
          userId,
        )
      })
      // 事务成功后删除旧物理文件（单个失败 warn 不阻断，覆盖语义优先保证内容更新）
      if (target.storageName) {
        await this.storage.remove(target.storageName)
      }
    } catch (error) {
      // 落库失败：回滚新物理文件，旧文件保留
      await this.storage.remove(newStorageName).catch(() => undefined)
      throw error
    }
  }

  /** 我的配额（cloud_usage 懒创建） */
  async getQuota(userId: bigint) {
    let usage = await this.prisma.cloudUsage.findUnique({ where: { userId } })
    if (!usage) {
      const defaultQuota = this.config.get<number>('upload.cloudDefaultQuota', 1024 * 1024 * 1024)
      usage = await this.prisma.cloudUsage.upsert({
        where: { userId },
        update: {},
        create: { userId, quota: BigInt(defaultQuota), used: BigInt(0) },
      })
    }
    return { quota: usage.quota, used: usage.used }
  }

  /** 用户是否存在未删除的云盘文件（含头像记录）；用于删用户预检（R10） */
  async hasFiles(userId: bigint): Promise<boolean> {
    const hit = await this.prisma.cloudFile.findFirst({
      where: { userId, deletedAt: null },
      select: { id: true },
    })
    return !!hit
  }

  /** 头像预览流：仅归属当前用户且未删除的头像记录可读；返回 { stream, mime } */
  async getAvatarStream(id: bigint, userId: bigint) {
    const file = await this.prisma.cloudFile.findFirst({
      where: { id, userId, deletedAt: null, parentId: AVATAR_PARENT_ID },
    })
    if (!file || !file.storageName) {
      throw new BusinessException(ErrorCode.CloudFileNotFound, '头像不存在或无权访问')
    }
    return { stream: this.storage.createReadStream(file.storageName), mime: file.mime }
  }

  /** 校验目标项归属当前用户且未删除；isDir 校验可强制要求文件夹（TransferService 上传/预览复用） */
  async assertOwned(id: bigint, userId: bigint, mustBeDir: boolean) {
    const file = await this.prisma.cloudFile.findFirst({
      where: { id, userId, deletedAt: null },
    })
    if (!file) {
      throw new BusinessException(ErrorCode.CloudFileNotFound, '文件/文件夹不存在或无权访问')
    }
    if (mustBeDir && file.isDir !== 1) {
      throw new BusinessException(ErrorCode.CloudFileNotFound, '目标不是文件夹')
    }
    return file
  }

  /** 计算目录深度（根目录深度 = 0），上溯到 parent_id=0（T49 解压目标深度校验复用，公开） */
  async computeDepth(id: bigint, userId: bigint): Promise<number> {
    let depth = 0
    let current = id
    // 防环上限 MAX_DEPTH + 1
    for (let i = 0; i <= MAX_DEPTH && current !== BigInt(0); i++) {
      depth++
      const parent = await this.prisma.cloudFile.findFirst({
        where: { id: current, userId, deletedAt: null },
      })
      if (!parent) break
      current = parent.parentId
    }
    return depth
  }

  /** 同名自动重命名：同目录下（未删除项）已存在则追加 "(1)"、"(2)"…（TransferService 上传复用；
   * move 场景传 excludeId 排除源自身） */
  async resolveNameConflict(
    userId: bigint,
    parentId: bigint,
    name: string,
    excludeId?: bigint,
  ): Promise<string> {
    const exclude = excludeId ? { id: { not: excludeId } } : {}
    const exists = await this.prisma.cloudFile.findFirst({
      where: { userId, parentId, name, deletedAt: null, ...exclude },
    })
    if (!exists) return name

    // 提取扩展名与主名（文件夹无扩展名概念，直接整体处理）
    const dotIndex = name.lastIndexOf('.')
    const baseName = dotIndex > 0 ? name.slice(0, dotIndex) : name
    const ext = dotIndex > 0 ? name.slice(dotIndex) : ''

    for (let i = 1; i < MAX_CHILDREN; i++) {
      const candidate = `${baseName}(${i})${ext}`
      const conflict = await this.prisma.cloudFile.findFirst({
        where: { userId, parentId, name: candidate, deletedAt: null, ...exclude },
      })
      if (!conflict) return candidate
    }
    // 理论不可达（500 项上限），兜底返回带时间戳的名称
    return `${baseName}(${Date.now()})${ext}`
  }

  /** candidateId 是否为 ancestorId 自身或其后代（有界上溯 ≤10 层防环；0=根目录恒 false） */
  private async isWithinSubtree(userId: bigint, candidateId: bigint, ancestorId: bigint): Promise<boolean> {
    return this.isWithinAnySubtree(userId, candidateId, new Set([ancestorId]))
  }

  /**
   * candidateId 是否处于「任一给定祖先集合」的子树内（含等于集合成员本身）；
   * 一次上溯 + 集合判定（P4E R51 多站口径），避免多根逐一上溯的 N 倍查询。
   * 有界上溯 ≤ MAX_DEPTH 层防环；0=根目录恒 false（根不在祖先集合中）。
   */
  private async isWithinAnySubtree(
    userId: bigint,
    candidateId: bigint,
    ancestors: Set<bigint>,
  ): Promise<boolean> {
    if (candidateId === BigInt(0)) return false
    let cursor = candidateId
    for (let i = 0; i <= MAX_DEPTH; i++) {
      if (ancestors.has(cursor)) return true
      const row = await this.prisma.cloudFile.findFirst({
        where: { id: cursor, userId },
        select: { parentId: true },
      })
      if (!row || row.parentId === BigInt(0)) return false
      cursor = row.parentId
    }
    return false
  }

  /**
   * 目标是否处于公开状态（R39 判定）：自目标上溯遇第一个非继承节点定生死
   * （1=显式公开 → true / 2=显式阻断 → false），一路继承到根 → false（与 P4a 三态上溯同口径）。
   */
  private async isTargetPublic(userId: bigint, targetId: bigint): Promise<boolean> {
    let cursor = targetId
    for (let i = 0; i <= MAX_DEPTH + 1 && cursor !== BigInt(0); i++) {
      const row = await this.prisma.cloudFile.findFirst({
        where: { id: cursor, userId },
        select: { isPublic: true, parentId: true },
      })
      if (!row) return false
      if (row.isPublic === 1) return true
      if (row.isPublic === 2) return false
      cursor = row.parentId
    }
    return false
  }

  /** 子树高度（源自身计 1；文件恒 1；有界 ≤ MAX_DEPTH，用于移动后深度上限校验 R6） */
  private async subtreeHeight(userId: bigint, source: { id: bigint; isDir: number }): Promise<number> {
    if (source.isDir !== 1) return 1
    let level = 1
    let queue: bigint[] = [source.id]
    while (queue.length > 0) {
      const children = await this.prisma.cloudFile.findMany({
        where: { userId, parentId: { in: queue }, deletedAt: null, isDir: 1 },
        select: { id: true },
      })
      if (children.length === 0) break
      level++
      if (level > MAX_DEPTH) break // 异常深子树按上限截断（正常树 ≤10）
      queue = children.map((c) => c.id)
    }
    return level
  }
}
