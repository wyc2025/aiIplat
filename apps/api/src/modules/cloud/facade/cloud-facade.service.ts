import { Injectable } from '@nestjs/common'
import type { Readable } from 'node:stream'
import type { CloudFile } from '@prisma/client'
import { ConfigService } from '@nestjs/config'
import { ErrorCode } from '../../../common/constants/error-code'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import { StorageService } from '../../../infra/storage/storage.service'
import { SiteRootService } from '../../site/facade/site-root.service'
import {
  FileService,
  AVATAR_PARENT_ID,
  EDITABLE_TEXT_EXTS,
  MAX_CHILDREN,
} from '../file/file.service'

/** 头像元数据（由调用方经 StorageService 落盘后传入） */
export interface AvatarMeta {
  size: bigint
  ext: string
  mime: string
  storageName: string
}

/** 模板复制元数据（供 site 域创建站点流程复用，T36） */
export interface PublicFileMeta {
  size: bigint
  ext: string
  mime: string
  storageName: string
}

/** 公开文件流结果（供开放静态层输出，T35） */
export interface PublicFileStream {
  stream: Readable
  size: bigint
  mime: string | null
  ext: string | null
  name: string
  updateTime: Date
}

/** 应用附件流结果（P12 D104 最小只读通道；引用索引与暴露校验由 pub/ 调用方完成，本方法不做业务校验） */
export interface AppAttachmentStream {
  stream: Readable
  name: string
  ext: string | null
  size: bigint
  mime: string | null
  /** 最后修改时间（ETag/304 与 Last-Modified 用，照公开层口径） */
  updateTime: Date
}

/** 公开路径解析的最大下行深度（§14.4 有界逐段下行） */
const RESOLVE_MAX_DEPTH = 10

/** 机械原语默认参数（§15.3：子树遍历默认 maxDepth 10 / limit 500，超限 truncated=true） */
const SUBTREE_DEFAULT_MAX_DEPTH = 10
const SUBTREE_DEFAULT_LIMIT = 500

/** 用户云盘虚拟根（parent_id = 0，无实体行；P5 §20.1 云盘根基点） */
const USER_ROOT_ID = BigInt(0)

/** AI 云盘写单文件上限 256KB（P5 R64，与站点写口径一致） */
export const AI_CLOUD_WRITE_MAX_FILE_BYTES = 256 * 1024
/**
 * AI 云盘读文件上限 2MB（P5 R64 原为 64KB；**P10 T97 起放宽**）：
 * 对话附件单文件上限即 2MB（D83）且大附件走「列清单 + 模型自读」（R84），
 * 若读上限仍是 64KB，>64KB 的附件将无法被 read_cloud_file 读到（实体清单形同虚设）。
 * 上下文安全由工具层分页（单次 ≤5 万字符，默认 2 万）承担，不再靠「读不动」兜底。
 */
export const AI_CLOUD_READ_MAX_BYTES = 2 * 1024 * 1024
/** AI 云盘单次批量操作条目上限（move / delete，防模型一次性下发超大数组） */
export const AI_CLOUD_MAX_BATCH = 20

/** 机械写入的 mime 推导（原语级最小映射，白名单外 octet-stream；开放层实际输出以 ext + mime.ts 白名单为准；T49 解压落库复用，故导出） */
export const RAW_MIME_MAP: Record<string, string> = {
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  json: 'application/json',
  txt: 'text/plain',
  md: 'text/markdown',
  svg: 'image/svg+xml',
  xml: 'application/xml',
  yml: 'text/plain',
  yaml: 'text/plain',
  csv: 'text/plain',
}

/** 子树条目（listSubtreeRaw 返回项；path 为相对站点根的 '/' 连接路径） */
export interface SubtreeEntry {
  path: string
  isDir: boolean
  size: number
  updatedAt: Date
}

/** 子树遍历结果（超限截断 truncated=true，§15.3） */
export interface SubtreeListResult {
  files: SubtreeEntry[]
  truncated: boolean
}

/** 机械写入结果（D22 软删旧版 + 新建：同路径覆盖时 action=overwritten） */
export interface RawWriteResult {
  action: 'created' | 'overwritten'
  size: number
}

/** 云盘目录条目（P5 §20.1 listUserFiles 返回项；path 为相对用户云盘根的 '/' 路径，供后续工具直接引用） */
export interface UserFileEntry {
  name: string
  path: string
  isDir: boolean
  size: number
  ext: string | null
  updatedAt: Date
  /** 位于任一站点子树内（含站点根本身，R46/R51 同口径）——提示模型「站点内容优先用 site 系列工具」 */
  inSite: boolean
}

/** 云盘目录列表结果（P5 §20.1：单层或有界子树 + 配额用量） */
export interface UserFileListResult {
  path: string
  items: UserFileEntry[]
  truncated: boolean
  quota: { used: number; limit: number }
}

/** 云盘读文件结果（UTF-8 解码后返回） */
export interface UserFileReadResult {
  path: string
  size: number
  content: string
}

/** 云盘写文件结果（同路径覆盖时 action=overwritten，旧版进回收站） */
export interface UserFileWriteResult {
  path: string
  action: 'created' | 'overwritten'
  size: number
}

/** 云盘移动结果（逐条部分成功语义，照 write_site_files 先例） */
export interface UserFileMoveResult {
  from: string
  to: string
  /** 落位后的完整路径（to + 最终文件名，同名自动 "(1)" 时可见） */
  finalPath?: string
  ok: boolean
  error?: string
  /** R39：目标在公开目录（AI 工具无二次确认位，直接执行并在结果中标注，§20.1 偏差说明） */
  targetPublic?: boolean
}

/** 云盘删除结果（软删进回收站，逐条部分成功语义） */
export interface UserFileDeleteResult {
  path: string
  ok: boolean
  error?: string
}

/** 从文件名提取小写扩展名（无扩展名返回 ''） */
function extOfName(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/** app 附件固定目录（P11 D96：附件字段强制落此目录，占云盘配额） */
const APP_ATTACHMENTS_DIR = 'app-attachments'

/**
 * appCode → 安全目录段（防穿越）：仅允许小写字母数字与连字符、可带 "(n)" 冲突后缀；
 * 非法返回 null（调用方抛 40001）。不 import app 域常量（跨域 import 违铁律 6，故本地白名单）。
 */
function sanitizeAppCodeSegment(code: string): string | null {
  const trimmed = typeof code === 'string' ? code.trim() : ''
  if (!/^[a-z0-9][a-z0-9-]{0,40}(\(\d{1,3}\))?$/.test(trimmed)) return null
  return trimmed
}

/**
 * 云盘域门面：跨域（system/site 等）只通过本门面与 cloud 交互，禁止直接 import 内部 FileService（R6）。
 * 封装：删用户预检 hasFiles、头像记录登记 saveAvatar、公开机制（P4a）：resolvePublicPath / getPublicStream / createFolder / registerPublicFile。
 */
@Injectable()
export class CloudFacade {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly storage: StorageService,
    private readonly fileService: FileService,
    private readonly siteRoot: SiteRootService,
  ) {}

  /** 用户是否仍有云盘文件（含头像）；删除用户前预检（R10） */
  async hasFiles(userId: bigint): Promise<boolean> {
    return this.fileService.hasFiles(userId)
  }

  /**
   * 公开路径解析（R2 修订·三态继承；**W12 修订·阻断优先**）：自根目录逐段下行命中 cloud_file 行，
   * 再自目标上溯校验公开链。is_public 三态：0=继承（新建默认）/ 1=显式公开 / 2=显式阻断。
   *
   * **阻断优先（W12/T165，与 `/api/pub/**` 链统一）**：祖先链（含目标自身）**任一节点 = 2 即阻断**；
   * 无 2 时，遇第一个非继承节点 = 1 则放行，一路继承（0）到根仍无显式公开锚点 → 阻断。
   * **收窄点**：目标自身 `1` **不再穿透**父级 `2`（S3 explicit deny 同构，业界通行）——此前两链规则
   * 相反，同一文件在 `/api/pub` 判不可见、在 `/api/open` 判可见，权限结论不可推理（W12 §1）。
   *
   * 任一不满足返回 null（开放层统一转 40400）。深度有界，防环。
   * @param rootFolderId 站点根目录
   * @param path 规范化后的相对路径（段数组或 '/' 分隔字符串）
   */
  async resolvePublicPath(rootFolderId: bigint, path: string): Promise<CloudFile | null> {
    const root = await this.requireRootFolder(rootFolderId)
    if (!root) return null
    const current = await this.descendTree(root, path)
    if (!current) return null

    // 自目标上溯（**W12 修订·阻断优先**）：先扫全链有无显式阻断（2）——任一节点（含自身）为 2 即阻断；
    // 无 2 时再按继承规则裁决（遇第一个非继承节点 1 → 放行；一路 0 到根仍无显式锚点 → 阻断）。
    // 必须走完整条链再裁决：不能遇到 1 就提前放行，否则又变回「1 穿透 2」。
    let cursor: CloudFile | null = current
    let depth = 0
    let explicitPublic = false
    while (cursor && depth <= RESOLVE_MAX_DEPTH) {
      if (cursor.isPublic === 2) return null
      if (cursor.isPublic === 1) explicitPublic = true
      if (cursor.id === rootFolderId) break
      cursor = await this.prisma.cloudFile.findFirst({
        where: { userId: root.userId, id: cursor.parentId, deletedAt: null },
      })
      depth++
    }
    // 深度超限（环/异常链）按未授权处理；站点根建站时恒显式置 1，正常链必在根处裁决
    if (depth > RESOLVE_MAX_DEPTH) return null
    return explicitPublic ? current : null
  }

  /**
   * 按树解析路径（**不校验公开性**，P19 T162/D149）：站点属主**管理态预览**专用。
   *
   * 与 `resolvePublicPath` 共用同一段下行实现（`descendTree`），避免两套路径解析规则漂移；
   * 公开性裁决刻意跳过——预览读的是**工作副本**，属主对自己站点内的任何文件都应可见
   * （含未公开页），这与开放层「只出已发布内容」是两个面。鉴权由调用方（管理态控制器）负责。
   */
  async resolveOwnTreePath(rootFolderId: bigint, path: string): Promise<CloudFile | null> {
    const root = await this.requireRootFolder(rootFolderId)
    if (!root) return null
    return this.descendTree(root, path)
  }

  /** 站点根目录行（存在且未软删的目录；不存在返回 null） */
  private async requireRootFolder(rootFolderId: bigint): Promise<CloudFile | null> {
    return this.prisma.cloudFile.findFirst({
      where: { id: rootFolderId, deletedAt: null, isDir: 1 },
    })
  }

  /** 规范化相对路径并自根逐段下行（拒 `..`、深度有界；两种解析链共用） */
  private async descendTree(root: CloudFile, path: string): Promise<CloudFile | null> {
    const segments = path.split('/').filter((s) => s.length > 0 && s !== '.')
    if (segments.some((s) => s === '..')) return null
    if (segments.length > RESOLVE_MAX_DEPTH) return null
    let current = root
    for (const seg of segments) {
      const next = await this.prisma.cloudFile.findFirst({
        where: { userId: root.userId, parentId: current.id, name: seg, deletedAt: null },
      })
      if (!next) return null
      current = next
    }
    return current
  }

  /** 获取公开文件流（R2 校验通过后由开放静态层管道输出；Range 由调用方传入 { start, end }）。
   * 缓存 fileId 失效（云盘侧 60s TTL 内删除）→ BusinessException 40400（R15 开放层统一码，禁止 500） */
  async getPublicStream(
    fileId: bigint,
    range?: { start: number; end: number },
  ): Promise<PublicFileStream> {
    const file = await this.prisma.cloudFile.findFirst({
      where: { id: fileId, deletedAt: null, isDir: 0 },
    })
    if (!file || !file.storageName) {
      throw new BusinessException(ErrorCode.NotFound, '资源不存在')
    }
    return {
      stream: this.storage.createReadStream(file.storageName, range),
      size: file.size,
      mime: file.mime,
      ext: file.ext,
      name: file.name,
      updateTime: file.updateTime,
    }
  }

  /**
   * 获取应用附件流（P12 D104 / ARCHITECTURE §28.1）：公开面输出附件字段文件的最小只读通道。
   * 仅做「行存在 + 非目录」读取——**引用索引（app_attachment_ref）与暴露校验由 pub/ 调用方完成**，
   * 本方法不重复业务校验（调用方已保证 fileId 来自有效引用且表·字段已暴露）。
   * 行已删/是目录 → BusinessException 40400（公开面统一防探测码，禁止 500）。
   * @param range 可选字节区间（公开文件流复用 §14.4 Range 语义）
   */
  async getAppAttachmentStream(
    fileId: bigint,
    range?: { start: number; end: number },
  ): Promise<AppAttachmentStream> {
    const file = await this.prisma.cloudFile.findFirst({
      where: { id: fileId, deletedAt: null, isDir: 0 },
    })
    if (!file || !file.storageName) {
      throw new BusinessException(ErrorCode.NotFound, '资源不存在')
    }
    return {
      stream: this.storage.createReadStream(file.storageName, range),
      name: file.name,
      ext: file.ext,
      size: file.size,
      mime: file.mime,
      updateTime: file.updateTime,
    }
  }

  /**
   * 按**相对路径**建目录（逐级 `mkdir -p`，已存在则复用）——公开入口（P20 B1）。
   *
   * 供展示应用在工作区创建自己的目录（目录恒定位、与站点树解耦）。调用方不区分
   * 「已存在」与「刚创建」——两者都返回可用的末级目录 id。
   */
  async ensureUserDirPath(userId: bigint, relPath: string): Promise<bigint> {
    const segments = this.normalizeUserDirPath(relPath)
    return this.ensureUserDir(userId, segments)
  }

  /**
   * 新建文件夹（供 site 域创建站点流程建目录）：R4 同名自动"(1)" + R6 单目录子项上限（500）。
   * @param isPublic 显式公开标记（仅站点根目录需要置 1 作为继承锚点；子目录缺省 0=继承父目录）
   */
  async createFolder(
    userId: bigint,
    parentId: bigint,
    name: string,
    isPublic = false,
  ): Promise<CloudFile> {
    // R6：单目录直接子项上限（与 mkdir 同口径）
    const count = await this.prisma.cloudFile.count({
      where: { userId, parentId, deletedAt: null },
    })
    if (count >= 500) {
      throw new BusinessException(ErrorCode.CloudDirLimitExceeded, '单个目录下子项不能超过 500 个')
    }
    const finalName = await this.fileService.resolveNameConflict(userId, parentId, name)
    return this.prisma.cloudFile.create({
      data: {
        userId,
        parentId,
        name: finalName,
        isDir: 1,
        size: BigInt(0),
        isPublic: isPublic ? 1 : 0,
      },
    })
  }

  /**
   * 站点创建回滚（§14.3 第 5 步）：软删已建的 cloud_file 行 + 删除已写的物理文件 + used 回退。
   * 供 site 域创建站点失败时调用（域边界：site 域不得直操 cloud_file/cloud_usage，故回滚经本门面）。
   */
  async discardSiteDraft(
    userId: bigint,
    drafts: Array<{ id: bigint; storageName: string | null; size: bigint }>,
  ): Promise<void> {
    for (const draft of drafts) {
      await this.prisma.cloudFile
        .update({ where: { id: draft.id }, data: { deletedAt: new Date() } })
        .catch(() => undefined)
      if (draft.storageName) {
        await this.storage.remove(draft.storageName).catch(() => undefined)
      }
      if (draft.size > BigInt(0)) {
        await this.adjustUsed(userId, -draft.size)
      }
    }
  }

  /**
   * 删站内部通道（P4E R53）：站点根连同子树软删进回收站。
   * 与 discardSiteDraft 的区别：discard 用于建站失败的未公开草稿回滚（物理删 + used 回退），
   * removeSiteRoot 用于删站（软删 + **used 不动**——数据可还原，占用不释放）。
   *
   * R2 语义「只标记自身」：仅置根的 deleted_at，后代不自标（回收站按祖先链判定同属已删子树），
   * 首次访问即整体不可达；同时置空根的 public_token（P4c D30 轮换，还原后旧链接仍 40400）。
   * 该通道绕过 R52 用户面删除保护（cloud 域对站点根的 30020 拦截只作用于用户直接删除），
   * 属主校验在 site 域完成（manage.getOwnedSite）。
   */
  async removeSiteRoot(userId: bigint, rootFolderId: bigint): Promise<void> {
    await this.prisma.cloudFile.updateMany({
      where: { id: rootFolderId, userId, deletedAt: null },
      data: { deletedAt: new Date(), publicToken: null },
    })
  }

  /**
   * 登记公开文件（供 site 域模板复制：写正式区 + 落 cloud_file + used 记账，复用 T27 链路）。
   * is_public 不写（默认 0=继承父目录）；isPublic 参数保留供特殊场景显式置公开。
   * used 记账用 upsert（配额懒创建：全新用户未做过云盘操作时 cloud_usage 行不存在，T40 联调修复）。
   */
  async registerPublicFile(
    userId: bigint,
    folderId: bigint,
    name: string,
    meta: PublicFileMeta,
    isPublic = false,
  ): Promise<CloudFile> {
    const defaultQuota = BigInt(
      this.config.get<number>('upload.cloudDefaultQuota', 1024 * 1024 * 1024),
    )
    const [created] = await this.prisma.$transaction([
      this.prisma.cloudFile.create({
        data: {
          userId,
          parentId: folderId,
          name,
          isDir: 0,
          size: meta.size,
          mime: meta.mime,
          ext: meta.ext,
          storageName: meta.storageName,
          auditStatus: 0,
          isPublic: isPublic ? 1 : 0,
        },
      }),
      this.prisma.cloudUsage.upsert({
        where: { userId },
        update: { used: { increment: meta.size } },
        create: { userId, quota: defaultQuota, used: meta.size },
      }),
    ])
    return created
  }

  /**
   * 登记新头像：软删旧头像记录并回退 used，新建记录并累加 used。
   * 返回头像可访问 url（指向 cloud 域头像预览端点，前端 img 直接可用）。
   */
  async saveAvatar(userId: bigint, meta: AvatarMeta): Promise<string> {
    // 回退旧头像占用
    const old = await this.prisma.cloudFile.findFirst({
      where: { userId, parentId: AVATAR_PARENT_ID, deletedAt: null },
      orderBy: { id: 'desc' },
    })
    if (old) {
      await this.prisma.cloudFile.update({
        where: { id: old.id },
        data: { deletedAt: new Date() },
      })
      await this.adjustUsed(userId, -old.size)
    }
    const created = await this.prisma.cloudFile.create({
      data: {
        userId,
        parentId: AVATAR_PARENT_ID,
        name: `avatar-${Date.now()}${meta.ext}`,
        isDir: 0,
        size: meta.size,
        ext: meta.ext,
        mime: meta.mime,
        storageName: meta.storageName,
      },
    })
    await this.adjustUsed(userId, meta.size)
    // 头像预览端点归属 cloud 域，url 由 cloud 域统一构造
    return `/api/cloud/file/avatar/${created.id.toString()}`
  }

  /** 调整 cloud_usage.used（懒创建保底），支持负回退 */
  private async adjustUsed(userId: bigint, delta: bigint) {
    const usage = await this.prisma.cloudUsage.findUnique({ where: { userId } })
    if (!usage) {
      const defaultQuota = BigInt(
        this.config.get<number>('upload.cloudDefaultQuota', 1024 * 1024 * 1024),
      )
      await this.prisma.cloudUsage.create({
        data: { userId, quota: defaultQuota, used: delta > BigInt(0) ? delta : BigInt(0) },
      })
      return
    }
    const next = usage.used + delta
    await this.prisma.cloudUsage.update({
      where: { userId },
      data: { used: next < BigInt(0) ? BigInt(0) : next },
    })
  }

  // ==================== P11 app 域附件门面（T103，D96） ====================

  /**
   * app 域附件上传（D96）：服务端**强制**落到用户云盘 `/app-attachments/{appCode}/`（不存在则逐段创建），
   * 服务端拼路径防穿越（appCode 白名单校验，不含 `/` `.`）。占云盘配额，复用 registerPublicFile 记账链。
   *
   * 分域纪律：`maxBytes`（app 配置 10MB）由调用域传入，cloud 域不硬编码其它域口径，只再夹一层云盘单文件上限。
   */
  async uploadForApp(
    userId: bigint,
    appCode: string,
    file: Express.Multer.File | undefined,
    maxBytes: number,
  ): Promise<{ fileId: string; path: string; name: string; ext: string; size: number }> {
    if (!file?.path) {
      throw new BusinessException(ErrorCode.ParamInvalid, '缺少上传文件（multipart 字段名 file）')
    }
    const segment = sanitizeAppCodeSegment(appCode)
    if (!segment) {
      throw new BusinessException(ErrorCode.ParamInvalid, 'appCode 非法')
    }
    const cloudLimit = this.config.get<number>('upload.cloudMaxFileSize', 100 * 1024 * 1024)
    const limit = Math.min(maxBytes, cloudLimit)
    if (file.size > limit) {
      const mb = Math.max(1, Math.floor(limit / 1024 / 1024))
      throw new BusinessException(ErrorCode.CloudFileTooLarge, `附件超出大小上限（${mb}MB）`)
    }
    const originalName = (file.originalname.split(/[\\/]/).pop() ?? '')
      // eslint-disable-next-line no-control-regex -- 剔除控制字符正是本函数目的（防响应头/文件名注入）
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .trim()
    if (!originalName) {
      throw new BusinessException(ErrorCode.ParamInvalid, '文件名无效')
    }
    if (originalName.length > 64) {
      throw new BusinessException(ErrorCode.CloudDirLimitExceeded, '文件名不能超过 64 字符')
    }
    try {
      const dirId = await this.ensureUserDir(userId, [APP_ATTACHMENTS_DIR, segment])
      const { quota, used } = await this.fileService.getQuota(userId)
      if (used + BigInt(file.size) > quota) {
        throw new BusinessException(
          ErrorCode.CloudQuotaExceeded,
          `存储配额不足（已用 ${used.toString()} / 配额 ${quota.toString()} 字节）`,
        )
      }
      const name = await this.fileService.resolveNameConflict(userId, dirId, originalName)
      const ext = extOfName(name)
      const storageName = await this.storage.moveToStorage(file.path, ext)
      let created: CloudFile
      try {
        created = await this.registerPublicFile(userId, dirId, name, {
          size: BigInt(file.size),
          ext,
          mime: RAW_MIME_MAP[ext] ?? 'application/octet-stream',
          storageName,
        })
      } catch (error) {
        await this.storage.remove(storageName).catch(() => undefined)
        throw error
      }
      return {
        fileId: created.id.toString(),
        path: `${APP_ATTACHMENTS_DIR}/${segment}/${name}`,
        name,
        ext,
        size: file.size,
      }
    } finally {
      await this.storage.removeTmp(file.path)
    }
  }

  // ==================== P4b 机械原语（T41，架构增补 §15.3） ====================
  // 管理侧语义：属主操作，不做公开性判定（R2 上溯）、不做站点语义校验（路径/白名单/大小由
  // SiteFacade 负责，本层假设调用方已校验）；仅抛 cloud 段自有码（30001/30003/30006），
  // 禁止抛 site 段码（错误码分段归位纪律）。

  /** 机械原语的统一根目录校验（根目录不存在/已删 → 30001） */
  private async assertRawRoot(rootFolderId: bigint): Promise<CloudFile> {
    const root = await this.prisma.cloudFile.findFirst({
      where: { id: rootFolderId, deletedAt: null, isDir: 1 },
    })
    if (!root) {
      throw new BusinessException(ErrorCode.CloudFileNotFound, '目录不存在或无权访问')
    }
    return root
  }

  /** 机械原语的路径段规范化（split 后拒绝空段/./..；越界深度由各方法按语义处理） */
  private rawSegments(path: string): string[] {
    const segments = path.split('/').filter((s) => s.length > 0 && s !== '.')
    if (segments.some((s) => s === '..')) {
      throw new BusinessException(ErrorCode.CloudFileNotFound, '文件不存在')
    }
    return segments
  }

  /**
   * 子树遍历共用实现（P5 T71 抽出）：自 baseParentId 有界 BFS 下行，
   * 默认 maxDepth 10 / limit 500，超限 truncated=true（§15.3）。
   * @param map 条目映射回调（进入文件行的路径与行数据 → 返回契约形态，供站点/云盘两种语义各自定制）
   */
  private async walkSubtree(
    userId: bigint,
    baseParentId: bigint,
    map: (child: CloudFile, path: string) => SubtreeEntry,
    opts?: { maxDepth?: number; limit?: number },
  ): Promise<SubtreeListResult> {
    const maxDepth = opts?.maxDepth ?? SUBTREE_DEFAULT_MAX_DEPTH
    const limit = opts?.limit ?? SUBTREE_DEFAULT_LIMIT

    const files: SubtreeEntry[] = []
    let truncated = false
    // BFS 逐层下行（'/' 连接路径；文件夹在前按名称升序，输出稳定）
    let queue: Array<{ id: bigint; path: string; depth: number }> = [
      { id: baseParentId, path: '', depth: 0 },
    ]
    while (queue.length > 0 && !truncated) {
      const nextQueue: typeof queue = []
      for (const node of queue) {
        if (truncated) break
        if (node.depth >= maxDepth) continue // 不再下行（有界防环）
        const children = await this.prisma.cloudFile.findMany({
          where: { userId, parentId: node.id, deletedAt: null },
          orderBy: [{ isDir: 'desc' }, { name: 'asc' }],
        })
        for (const child of children) {
          if (files.length >= limit) {
            truncated = true
            break
          }
          const path = node.path ? `${node.path}/${child.name}` : child.name
          files.push(map(child, path))
          if (child.isDir === 1) {
            nextQueue.push({ id: child.id, path, depth: node.depth + 1 })
          }
        }
      }
      queue = nextQueue
    }
    return { files, truncated }
  }

  /**
   * 站点子树遍历（管理侧，不含回收站）：自 rootFolderId 有界 BFS 下行，
   * 默认 maxDepth 10 / limit 500，超限 truncated=true（§15.3）。
   */
  async listSubtreeRaw(
    rootFolderId: bigint,
    opts?: { maxDepth?: number; limit?: number },
  ): Promise<SubtreeListResult> {
    const root = await this.assertRawRoot(rootFolderId)
    return this.walkSubtree(
      root.userId,
      root.id,
      (child, path) => ({
        path,
        isDir: child.isDir === 1,
        size: Number(child.size),
        updatedAt: child.updateTime,
      }),
      opts,
    )
  }

  /**
   * 按路径逐段下行解析（有界 ≤10）；不存在返回 null。
   * @param baseParentId 基点父目录（0 = 用户云盘虚拟根；站点根 id = 站点基点）
   */
  private async findEntryByBase(
    userId: bigint,
    baseParentId: bigint,
    segments: string[],
  ): Promise<CloudFile | null> {
    if (segments.length === 0 || segments.length > RESOLVE_MAX_DEPTH) return null
    let parentId = baseParentId
    let current: CloudFile | null = null
    for (const seg of segments) {
      current = await this.prisma.cloudFile.findFirst({
        where: { userId, parentId, name: seg, deletedAt: null },
      })
      if (!current) return null
      parentId = current.id
    }
    return current
  }

  /**
   * 按路径读文件（机械层共用实现）：逐段下行解析（有界 ≤10）；不存在/是目录 → 30001；
   * 读盘返回 Buffer（UTF-8 解码由调用方负责）。
   */
  private async readFileByBase(
    userId: bigint,
    baseParentId: bigint,
    segments: string[],
  ): Promise<{ size: number; content: Buffer }> {
    const current = await this.findEntryByBase(userId, baseParentId, segments)
    if (!current || current.isDir === 1 || !current.storageName) {
      throw new BusinessException(ErrorCode.CloudFileNotFound, '文件不存在')
    }

    // 读盘 → Buffer
    const chunks: Buffer[] = []
    for await (const chunk of this.storage.createReadStream(current.storageName)) {
      chunks.push(Buffer.from(chunk))
    }
    return { size: Number(current.size), content: Buffer.concat(chunks) }
  }

  /**
   * 按路径读文件（管理侧，站点基点）：逐段下行解析（有界 ≤10）；不存在/是目录 → 30001；
   * 读盘返回 Buffer（UTF-8 解码由调用方负责）。
   */
  async readFileRaw(
    rootFolderId: bigint,
    path: string,
  ): Promise<{ size: number; content: Buffer }> {
    const root = await this.assertRawRoot(rootFolderId)
    return this.readFileByBase(root.userId, root.id, this.rawSegments(path))
  }

  /**
   * 按路径写文件（管理侧，R18/D22 软删旧版 + 新建）：
   * - 基点：rootFolderId=0 → 用户云盘虚拟根（P5 云盘根语义）；否则要求实体目录行存在。
   * - 中间目录 mkdir -p 语义：逐段下行，已存在目录直接复用，不存在才经 createFolder 创建
   *   （R4 同名"(1)"仅在并发撞名时兜底 + R6 子项上限）。严禁无脑逐段 createFolder——
   *   同路径二次写入会造出 "pages (1)" 平行目录，站点路径即 URL 下是致命错误。
   * - 中间段撞同名文件、目标末段撞同名目录 → 30001（调用方记为该文件 per-file error）。
   * - 同路径未删文件 → 软删（回收站，used 不动，可回滚）→ writeFromBuffer → registerPublicFile
   *   （used += size，upsert 懒创建；is_public 默认 0=继承父目录，公开根下新文件自动可访问）。
   * - 配额：used + size > quota → 30003（软删旧版不动 used，按增量判断）。
   */
  async writeFileRaw(
    userId: bigint,
    rootFolderId: bigint,
    path: string,
    content: Buffer,
  ): Promise<RawWriteResult> {
    const segments = this.rawSegments(path)
    if (segments.length === 0 || segments.length > RESOLVE_MAX_DEPTH) {
      throw new BusinessException(ErrorCode.CloudDirLimitExceeded, '超出目录限制（深度>10）')
    }
    // 基点解析：0 = 用户云盘虚拟根（无实体行）；否则实体目录行必须存在
    const baseParentId =
      rootFolderId === USER_ROOT_ID ? USER_ROOT_ID : (await this.assertRawRoot(rootFolderId)).id
    const dirSegments = segments.slice(0, -1)
    const name = segments[segments.length - 1]
    const size = BigInt(content.length)

    // 配额预检（R3；check-then-act 竞态按平台口径接受）
    const usage = await this.prisma.cloudUsage.findUnique({ where: { userId } })
    const quota = usage
      ? usage.quota
      : BigInt(this.config.get<number>('upload.cloudDefaultQuota', 1024 * 1024 * 1024))
    const used = usage ? usage.used : BigInt(0)
    if (used + size > quota) {
      throw new BusinessException(ErrorCode.CloudQuotaExceeded, '存储配额不足')
    }

    // 中间目录 mkdir -p：逐段下行复用，不存在才建
    let parentId = baseParentId
    for (const seg of dirSegments) {
      const next = await this.prisma.cloudFile.findFirst({
        where: { userId, parentId, name: seg, deletedAt: null },
      })
      if (!next) {
        parentId = (await this.createFolder(userId, parentId, seg)).id
      } else if (next.isDir === 1) {
        parentId = next.id
      } else {
        // 中间段撞同名文件：无法下穿
        throw new BusinessException(ErrorCode.CloudFileNotFound, '同名路径存在文件，无法创建目录')
      }
    }

    // 目标末段：撞同名目录 → 无法以文件覆盖目录
    const existing = await this.prisma.cloudFile.findFirst({
      where: { userId, parentId, name, deletedAt: null },
    })
    if (existing && existing.isDir === 1) {
      throw new BusinessException(ErrorCode.CloudFileNotFound, '同名目录已存在，无法写入文件')
    }

    // R6 单目录子项上限（排除将被软删的同名旧文件，覆盖场景不新增子项）
    const childCount = await this.prisma.cloudFile.count({
      where: {
        userId,
        parentId,
        deletedAt: null,
        ...(existing ? { id: { not: existing.id } } : {}),
      },
    })
    if (childCount >= MAX_CHILDREN) {
      throw new BusinessException(ErrorCode.CloudDirLimitExceeded, '单个目录下子项不能超过 500 个')
    }

    // 写物理文件（失败则零副作用）
    const ext = extOfName(name)
    const storageName = await this.storage.writeFromBuffer(content, ext)

    try {
      // 同路径已存在未删文件 → 软删旧版（进回收站，used 不动，可回滚）
      if (existing) {
        await this.prisma.cloudFile.update({
          where: { id: existing.id },
          data: { deletedAt: new Date() },
        })
      }
      // 登记新行 + used 记账（upsert 懒创建；is_public 默认 0=继承父目录）
      await this.registerPublicFile(userId, parentId, name, {
        size,
        ext,
        mime: RAW_MIME_MAP[ext] ?? 'application/octet-stream',
        storageName,
      })
    } catch (e) {
      // 登记失败：删刚写的物理文件防孤儿（旧版已软删，可从回收站还原）
      await this.storage.remove(storageName).catch(() => undefined)
      throw e
    }

    return { action: existing ? 'overwritten' : 'created', size: Number(size) }
  }

  // ==================== P5 云盘根基点原语（T71，架构增补 §20.1） ====================
  // 基点 = 用户云盘根（parent_id = 0，虚拟根无实体行）；校验纪律与站点原语相同：
  // 路径规范化防穿越（空段/./.. /绝对路径/反斜杠拒绝）、文本白名单、大小上限全在本层，
  // 抛 cloud 段自有码（30001/30006/30012/30013/30020）；不做公开性判定（R2 上溯属访问侧）。

  /**
   * 云盘路径规范化（R64）：拒绝空串 / 绝对路径 / 反斜杠 / 空段 / `.` / `..`，单段 ≤64 字符；
   * 非法一律 30001（云盘段「不存在」口径，不泄漏路径规则细节之外的内部结构）。
   */
  private normalizeUserPath(path: string): string[] {
    if (typeof path !== 'string' || path.trim().length === 0) {
      throw new BusinessException(ErrorCode.CloudFileNotFound, '路径非法（不能为空）')
    }
    const raw = path.trim()
    if (raw.includes('\\')) {
      throw new BusinessException(ErrorCode.CloudFileNotFound, '路径非法（禁止反斜杠）')
    }
    if (raw.startsWith('/')) {
      throw new BusinessException(ErrorCode.CloudFileNotFound, '路径非法（禁止绝对路径）')
    }
    const segments = raw.split('/')
    for (const seg of segments) {
      if (seg.length === 0 || seg === '.' || seg === '..') {
        throw new BusinessException(ErrorCode.CloudFileNotFound, '路径非法（含空段/./..）')
      }
      if (seg.length > 64) {
        throw new BusinessException(ErrorCode.CloudFileNotFound, '路径非法（单段超长）')
      }
    }
    if (segments.length > RESOLVE_MAX_DEPTH) {
      throw new BusinessException(ErrorCode.CloudDirLimitExceeded, '超出目录限制（深度>10）')
    }
    return segments
  }

  /** 目标目录路径解析（允许空串 / `.` / `/` 表示用户云盘根，供 move 的 to 使用） */
  private normalizeUserDirPath(path: unknown): string[] {
    if (typeof path !== 'string') {
      throw new BusinessException(ErrorCode.CloudFileNotFound, '路径非法（不能为空）')
    }
    const trimmed = path.trim()
    if (trimmed === '' || trimmed === '.' || trimmed === '/') return []
    return this.normalizeUserPath(trimmed)
  }

  /** 逐段确认目录存在（不存在则 mkdir -p 逐段创建），返回目录行 id（0 = 用户云盘根） */
  private async ensureUserDir(userId: bigint, segments: string[]): Promise<bigint> {
    let parentId = USER_ROOT_ID
    for (const seg of segments) {
      const next = await this.prisma.cloudFile.findFirst({
        where: { userId, parentId, name: seg, deletedAt: null },
      })
      if (!next) {
        parentId = (await this.createFolder(userId, parentId, seg)).id
      } else if (next.isDir === 1) {
        parentId = next.id
      } else {
        throw new BusinessException(ErrorCode.CloudFileNotFound, '同名路径存在文件，无法创建目录')
      }
    }
    return parentId
  }

  /** 批量操作条目数校验（防模型一次性下发超大数组，R64） */
  private assertBatchSize(count: number, action: string): void {
    if (count === 0 || count > AI_CLOUD_MAX_BATCH) {
      throw new BusinessException(
        ErrorCode.ParamInvalid,
        `单次${action} 1~${AI_CLOUD_MAX_BATCH} 项`,
      )
    }
  }

  /**
   * 云盘目录列表（基点 = 用户云盘根）：
   * - path 缺省 = 根目录；recursive=false（缺省）单层、true 有界子树（maxDepth 10 / limit 500）
   * - 条目带相对路径 path 与 inSite 标记（站点子树内 → 提示模型优先用 site 系列工具）
   * - 附带配额用量
   */
  async listUserFiles(
    userId: bigint,
    opts: { path?: string; recursive?: boolean },
  ): Promise<UserFileListResult> {
    const pathRaw = typeof opts.path === 'string' ? opts.path.trim() : ''
    const hasPath = pathRaw !== '' && pathRaw !== '.' && pathRaw !== '/'
    const baseSegments = hasPath ? this.normalizeUserPath(pathRaw) : []
    const basePath = baseSegments.join('/')

    // 基点目录解析（空 = 用户云盘根）
    let baseParentId = USER_ROOT_ID
    let baseInSite = false
    const siteRoots = new Set(await this.siteRoot.getRootFolderIds(userId))
    if (baseSegments.length > 0) {
      const base = await this.findEntryByBase(userId, USER_ROOT_ID, baseSegments)
      if (!base) {
        throw new BusinessException(ErrorCode.CloudFileNotFound, '目录不存在或无权访问')
      }
      if (base.isDir !== 1) {
        throw new BusinessException(ErrorCode.CloudFileNotFound, '目标不是文件夹')
      }
      baseParentId = base.id
      baseInSite = await this.isInAnySite(userId, base.id, siteRoots)
    }

    const items: UserFileEntry[] = []
    let truncated = false
    const toEntry = (child: CloudFile, dirInSite: boolean, parentPath: string): UserFileEntry => ({
      name: child.name,
      path: parentPath ? `${parentPath}/${child.name}` : child.name,
      isDir: child.isDir === 1,
      size: Number(child.size),
      ext: child.ext,
      updatedAt: child.updateTime,
      inSite: dirInSite || siteRoots.has(child.id),
    })

    if (opts.recursive === true) {
      // 有界子树（口径同 listSubtreeRaw：maxDepth 10 / limit 500），inSite 逐层继承
      let queue: Array<{ id: bigint; path: string; depth: number; inSite: boolean }> = [
        { id: baseParentId, path: basePath, depth: 0, inSite: baseInSite },
      ]
      while (queue.length > 0 && !truncated) {
        const nextQueue: typeof queue = []
        for (const node of queue) {
          if (truncated) break
          if (node.depth >= SUBTREE_DEFAULT_MAX_DEPTH) continue
          const children = await this.prisma.cloudFile.findMany({
            where: { userId, parentId: node.id, deletedAt: null },
            orderBy: [{ isDir: 'desc' }, { name: 'asc' }],
          })
          for (const child of children) {
            if (items.length >= SUBTREE_DEFAULT_LIMIT) {
              truncated = true
              break
            }
            const entry = toEntry(child, node.inSite, node.path)
            items.push(entry)
            if (child.isDir === 1) {
              nextQueue.push({
                id: child.id,
                path: entry.path,
                depth: node.depth + 1,
                inSite: entry.inSite,
              })
            }
          }
        }
        queue = nextQueue
      }
    } else {
      // 单层：目录按名称升序、文件按修改时间倒序（与 file.service.list 展示口径一致）
      const children = await this.prisma.cloudFile.findMany({
        where: { userId, parentId: baseParentId, deletedAt: null },
      })
      const dirs = children
        .filter((f) => f.isDir === 1)
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
      const files = children
        .filter((f) => f.isDir === 0)
        .sort((a, b) => b.updateTime.getTime() - a.updateTime.getTime())
      for (const child of [...dirs, ...files]) {
        items.push(toEntry(child, baseInSite, basePath))
      }
    }

    const { quota, used } = await this.fileService.getQuota(userId)
    return {
      path: basePath,
      items,
      truncated,
      quota: { used: Number(used), limit: Number(quota) },
    }
  }

  /** 是否处于任一站点子树内（含站点根本身，R46/R51 同口径；有界上溯 ≤10 防环） */
  private async isInAnySite(userId: bigint, id: bigint, siteRoots: Set<bigint>): Promise<boolean> {
    let cursor = id
    for (let i = 0; i <= RESOLVE_MAX_DEPTH; i++) {
      if (siteRoots.has(cursor)) return true
      const row = await this.prisma.cloudFile.findFirst({
        where: { id: cursor, userId },
        select: { parentId: true },
      })
      if (!row || row.parentId === USER_ROOT_ID) return false
      cursor = row.parentId
    }
    return false
  }

  /**
   * 云盘读文本文件（基线 = 用户云盘根）：文本白名单（30012）+ ≤2MB（30013）+ 不存在/目录 30001。
   * P10 T97：体积上限由 64KB 放宽到 2MB（与附件口径一致），超长内容由工具层分页消费。
   */
  async readUserFile(userId: bigint, path: string): Promise<UserFileReadResult> {
    const segments = this.normalizeUserPath(path)
    const normalized = segments.join('/')
    const ext = extOfName(normalized)
    if (!EDITABLE_TEXT_EXTS.has(ext)) {
      throw new BusinessException(
        ErrorCode.CloudFileTypeNotAllowed,
        '该文件类型不支持读取（仅文本白名单）',
      )
    }
    const entry = await this.findEntryByBase(userId, USER_ROOT_ID, segments)
    if (!entry || entry.isDir === 1 || !entry.storageName) {
      throw new BusinessException(ErrorCode.CloudFileNotFound, '文件不存在或无权访问')
    }
    if (Number(entry.size) > AI_CLOUD_READ_MAX_BYTES) {
      const mb = Math.max(1, Math.floor(AI_CLOUD_READ_MAX_BYTES / 1024 / 1024))
      throw new BusinessException(ErrorCode.CloudContentTooLarge, `文件超出读取上限（${mb}MB）`)
    }
    const raw = await this.readFileByBase(userId, USER_ROOT_ID, segments)
    return { path: normalized, size: raw.size, content: raw.content.toString('utf-8') }
  }

  /**
   * 按文件 ID 读文本（P8 T88 文章导入用）：供 site 域把「云盘里已有的 md/txt」解析成文章草稿。
   *
   * 与 `readUserFile` 的差异：
   * - 以 **fileId** 定位（前端文件选择器拿到的是 id，不必先拼路径）；
   * - 扩展名白名单与体积上限**由调用方传入**（cloud 域不硬编码其它域的导入口径）；
   * - 返回原始字节（编码探测留给调用域：GBK/UTF-8 属于"文章"语义，不是存储语义）。
   */
  async readTextFileById(
    userId: bigint,
    fileId: bigint,
    opts: { exts: ReadonlySet<string>; maxBytes: number; purpose?: string },
  ): Promise<{ id: string; name: string; ext: string; size: number; content: Buffer }> {
    const row = await this.prisma.cloudFile.findFirst({
      where: { id: fileId, userId, deletedAt: null },
    })
    if (!row || row.isDir === 1 || !row.storageName) {
      throw new BusinessException(ErrorCode.CloudFileNotFound, '文件不存在或无权访问')
    }
    const ext = (row.ext ?? '').toLowerCase()
    if (!opts.exts.has(ext)) {
      const allow = [...opts.exts].map((item) => `.${item}`).join(' / ')
      throw new BusinessException(
        ErrorCode.CloudFileTypeNotAllowed,
        `该文件类型不支持${opts.purpose ?? '读取'}（仅支持 ${allow}）`,
      )
    }
    if (Number(row.size) > opts.maxBytes) {
      const mb = Math.max(1, Math.floor(opts.maxBytes / 1024 / 1024))
      throw new BusinessException(ErrorCode.CloudContentTooLarge, `文件超过 ${mb}MB 上限`)
    }

    const chunks: Buffer[] = []
    for await (const chunk of this.storage.createReadStream(row.storageName)) {
      chunks.push(Buffer.from(chunk))
    }
    const content = Buffer.concat(chunks)
    return { id: row.id.toString(), name: row.name, ext, size: content.length, content }
  }

  /**
   * 按**云盘相对路径**读文本（P9 T92 修订）：AI 工具的寻址惯例是 path——
   * `list_cloud_files` 按设计只回 name/path（不回 id），只收 fileId 的工具模型根本喂不进去。
   *
   * 实现：逐段下行解析（≤10 层）拿到文件行后，**直接复用 `readTextFileById`**——
   * 白名单、体积上限、读盘与错误码（30001/30012/30013）与 REST 导入完全同源，没有第二份实现。
   */
  async readTextFileByPath(
    userId: bigint,
    path: string,
    opts: { exts: ReadonlySet<string>; maxBytes: number; purpose?: string },
  ): Promise<{ id: string; name: string; ext: string; size: number; content: Buffer }> {
    const segments = this.normalizeUserPath(path)
    const entry = await this.findEntryByBase(userId, USER_ROOT_ID, segments)
    if (!entry || entry.isDir === 1) {
      throw new BusinessException(ErrorCode.CloudFileNotFound, '文件不存在或无权访问')
    }
    return this.readTextFileById(userId, entry.id, opts)
  }

  // ==================== P10 附件门面（T96，D82/R82/R84） ====================

  /**
   * 按文件 ID 取「相对用户云盘根」的路径（P10 T96）。
   * 场景：前端文件选择器 / 上传接口只回 fileId，而 ai 域附件元信息与可读清单都按 **path** 寻址
   * （`read_cloud_file` 按路径读），故由 cloud 域统一拼路径（域边界：ai 域禁止直查 cloud_file 表）。
   * 有界上溯 ≤10 层；不存在 / 已删 / 非本人 → null（调用方按「失效」降级，不抛异常）。
   */
  async pathOfUserFile(userId: bigint, fileId: bigint): Promise<string | null> {
    const row = await this.prisma.cloudFile.findFirst({
      where: { id: fileId, userId, deletedAt: null },
      select: { name: true, parentId: true },
    })
    if (!row) return null
    const segments = [row.name]
    let cursor = row.parentId
    for (let depth = 0; depth <= RESOLVE_MAX_DEPTH && cursor !== USER_ROOT_ID; depth++) {
      const parent = await this.prisma.cloudFile.findFirst({
        where: { id: cursor, userId },
        select: { name: true, parentId: true },
      })
      if (!parent) break
      segments.unshift(parent.name)
      cursor = parent.parentId
    }
    return segments.join('/')
  }

  /**
   * 按「相对用户云盘根」的路径解析**目录** id（展示应用卡片「打开云盘目录」直达用）。
   *
   * 与 `resolvePublicPath` 的关键差异：**不做公开性上溯**——调用方（display 域）要的是目录节点本身，
   * 与站点是否公开无关；而展示应用目录通常是继承态（`is_public=0`），走公开解析会被判 null。
   * 未命中 / 非目录 / 路径非法 → `null`（调用方降级为「目录尚未创建」，不抛异常、不泄漏内部错误码）。
   */
  async resolveUserDirId(userId: bigint, path: string): Promise<bigint | null> {
    let segments: string[]
    try {
      segments = this.normalizeUserPath(path)
    } catch {
      return null
    }
    if (segments.length === 0) return null
    const entry = await this.findEntryByBase(userId, USER_ROOT_ID, segments)
    return entry && entry.isDir === 1 ? entry.id : null
  }

  /**
   * 批量判定文件是否仍「有效」（本人 + 未删除 + 非目录，P10 T96 / D82 失效降级）。
   * 供 ai 域标注附件 invalid（源文件已删除）：只查行不读盘，零成本；返回有效 fileId 字符串集合。
   */
  async filterAliveFileIds(userId: bigint, fileIds: readonly bigint[]): Promise<Set<string>> {
    if (fileIds.length === 0) return new Set()
    const rows = await this.prisma.cloudFile.findMany({
      where: { id: { in: [...fileIds] }, userId, deletedAt: null, isDir: 0 },
      select: { id: true },
    })
    return new Set(rows.map((row) => row.id.toString()))
  }

  /**
   * 云盘写文本文件（基点 = 用户云盘根，R64/D22 温和覆盖）：
   * 路径规范（30001）→ 文本白名单（30012）→ 单文件 ≤256KB 文本（30013）→
   * writeFileRaw 全链（mkdir -p / R6 / 同名旧版进回收站 / used 记账 / 配额 30003）。
   */
  async writeUserFile(userId: bigint, path: string, content: string): Promise<UserFileWriteResult> {
    const segments = this.normalizeUserPath(path)
    const normalized = segments.join('/')
    const ext = extOfName(normalized)
    if (!EDITABLE_TEXT_EXTS.has(ext)) {
      throw new BusinessException(
        ErrorCode.CloudFileTypeNotAllowed,
        '该文件类型不支持写入（仅文本白名单）',
      )
    }
    if (typeof content !== 'string') {
      throw new BusinessException(ErrorCode.ParamInvalid, 'content 必须为字符串')
    }
    const buffer = Buffer.from(content, 'utf-8')
    if (buffer.length > AI_CLOUD_WRITE_MAX_FILE_BYTES) {
      throw new BusinessException(ErrorCode.CloudContentTooLarge, '内容超出单文件写入上限（256KB）')
    }
    const result = await this.writeFileRaw(userId, USER_ROOT_ID, normalized, buffer)
    return { path: normalized, action: result.action, size: result.size }
  }

  /**
   * 云盘批量移动（基点 = 用户云盘根）：`to` 为目录路径（自动 mkdir -p），
   * 逐条独立成败（部分成功语义）；站点根/防环/回收站保护经 file.service.move 全继承（30019）。
   * R39 偏差（§20.1）：AI 工具无「移入公开目录二次确认」交互位——确认卡即用户确认动作，
   * 故直接带 confirmPublic 执行，并在结果中标注 targetPublic=true。
   */
  async moveUserFiles(
    userId: bigint,
    moves: Array<{ from: string; to: string }>,
  ): Promise<UserFileMoveResult[]> {
    this.assertBatchSize(moves.length, '最多可移动')
    const results: UserFileMoveResult[] = []
    for (const move of moves) {
      const fromRaw = typeof move?.from === 'string' ? move.from : ''
      const toRaw = typeof move?.to === 'string' ? move.to : ''
      try {
        const fromSegments = this.normalizeUserPath(fromRaw)
        const source = await this.findEntryByBase(userId, USER_ROOT_ID, fromSegments)
        if (!source) {
          throw new BusinessException(ErrorCode.CloudFileNotFound, '源文件/文件夹不存在或无权访问')
        }
        const toSegments = this.normalizeUserDirPath(toRaw)
        const targetParentId = await this.ensureUserDir(userId, toSegments)
        const moved = await this.fileService.move(userId, source.id, {
          targetParentId: Number(targetParentId),
          confirmPublic: true,
        })
        const toPath = toSegments.join('/')
        results.push({
          from: fromSegments.join('/'),
          to: toPath,
          finalPath: toPath ? `${toPath}/${moved.finalName}` : moved.finalName,
          ok: true,
          targetPublic: moved.targetPublic,
        })
      } catch (e) {
        if (!(e instanceof BusinessException)) throw e
        results.push({
          from: fromRaw,
          to: toRaw,
          ok: false,
          error: `${e.message}（错误码 ${e.code}）`,
        })
      }
    }
    return results
  }

  /**
   * 目标目录是否处于公开状态（R39 同口径三态上溯：遇第一个非继承节点定生死；
   * 目标不存在/在根 → false）。供 move_cloud_files 确认卡预判「目标在公开目录」用，
   * 不抛异常（路径非法按 false 处理）。
   */
  async isUserDirPublic(userId: bigint, path: string): Promise<boolean> {
    let segments: string[]
    try {
      segments = this.normalizeUserDirPath(path)
    } catch {
      return false
    }
    if (segments.length === 0) return false
    const dir = await this.findEntryByBase(userId, USER_ROOT_ID, segments)
    if (!dir || dir.isDir !== 1) return false

    let cursor: bigint = dir.id
    for (let i = 0; i <= RESOLVE_MAX_DEPTH + 1 && cursor !== USER_ROOT_ID; i++) {
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

  /**
   * 用户云盘路径是否存在（基点 = 用户云盘根，P14 T125：供 display 域判定「挂靠移动」的源目录是否已落盘）。
   * 路径非法或不存在一律 false（不抛异常，调用方据此走「空目录挂靠」分支）。
   */
  async existsUserPath(userId: bigint, path: string): Promise<boolean> {
    let segments: string[]
    try {
      segments = this.normalizeUserPath(path)
    } catch {
      return false
    }
    if (segments.length === 0) return false
    const entry = await this.findEntryByBase(userId, USER_ROOT_ID, segments)
    return entry !== null && entry !== undefined
  }

  /**
   * 云盘批量删除（基点 = 用户云盘根）：仅软删进回收站（可还原）；
   * 站点根拦截 30020 经 file.service.remove 继承，逐条独立成败。
   */
  async deleteUserFiles(userId: bigint, paths: string[]): Promise<UserFileDeleteResult[]> {
    this.assertBatchSize(paths.length, '最多可删除')
    const results: UserFileDeleteResult[] = []
    for (const path of paths) {
      const raw = typeof path === 'string' ? path : ''
      try {
        const segments = this.normalizeUserPath(raw)
        const entry = await this.findEntryByBase(userId, USER_ROOT_ID, segments)
        if (!entry) {
          throw new BusinessException(ErrorCode.CloudFileNotFound, '文件/文件夹不存在或无权访问')
        }
        await this.fileService.remove(userId, entry.id)
        results.push({ path: segments.join('/'), ok: true })
      } catch (e) {
        if (!(e instanceof BusinessException)) throw e
        results.push({ path: raw, ok: false, error: `${e.message}（错误码 ${e.code}）` })
      }
    }
    return results
  }
}
