import { Injectable } from '@nestjs/common'
import type { Readable } from 'node:stream'
import type { CloudFile } from '@prisma/client'
import { ConfigService } from '@nestjs/config'
import { ErrorCode } from '../../../common/constants/error-code'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import { StorageService } from '../../../infra/storage/storage.service'
import { FileService, AVATAR_PARENT_ID, MAX_CHILDREN } from '../file/file.service'

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

/** 公开路径解析的最大下行深度（§14.4 有界逐段下行） */
const RESOLVE_MAX_DEPTH = 10

/** 机械原语默认参数（§15.3：子树遍历默认 maxDepth 10 / limit 500，超限 truncated=true） */
const SUBTREE_DEFAULT_MAX_DEPTH = 10
const SUBTREE_DEFAULT_LIMIT = 500

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

/** 从文件名提取小写扩展名（无扩展名返回 ''） */
function extOfName(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
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
  ) {}

  /** 用户是否仍有云盘文件（含头像）；删除用户前预检（R10） */
  async hasFiles(userId: bigint): Promise<boolean> {
    return this.fileService.hasFiles(userId)
  }

  /**
   * 公开路径解析（R2 修订·三态继承）：自根目录逐段下行命中 cloud_file 行，再自目标上溯校验公开链。
   * is_public 三态：0=继承（新建默认）/ 1=显式公开 / 2=显式阻断；
   * 上溯时遇第一个非继承节点定生死——1 放行（可穿透父级阻断）/ 2 阻断；一路继承到根仍无显式锚点 → 阻断。
   * 任一不满足返回 null（开放层统一转 40400）。深度有界（≤10 层），防环。
   * @param rootFolderId 站点根目录
   * @param path 规范化后的相对路径（段数组或 '/' 分隔字符串）
   */
  async resolvePublicPath(rootFolderId: bigint, path: string): Promise<CloudFile | null> {
    // 根目录必须存在且未删（公开性由下方上溯统一裁决：根恒为显式 1/2，0 视为异常态阻断）
    const root = await this.prisma.cloudFile.findFirst({
      where: { id: rootFolderId, deletedAt: null, isDir: 1 },
    })
    if (!root) return null

    // 规范化：空路径 = 根目录（默认 index.html 由调用方拼接）
    const segments = path.split('/').filter((s) => s.length > 0 && s !== '.')
    if (segments.some((s) => s === '..')) return null
    if (segments.length > RESOLVE_MAX_DEPTH) return null

    // 自根逐段下行
    let current = root
    for (const seg of segments) {
      const next = await this.prisma.cloudFile.findFirst({
        where: { userId: root.userId, parentId: current.id, name: seg, deletedAt: null },
      })
      if (!next) return null
      current = next
    }

    // 自目标上溯（R2 修订·三态继承）：遇第一个非继承节点定生死——1 放行 / 2 阻断；
    // 一路继承（0）回到根仍无显式锚点 → 阻断（站点根恒显式置 1/2，正常链必在根处裁决）
    let cursor: CloudFile | null = current
    let depth = 0
    while (cursor && depth <= RESOLVE_MAX_DEPTH) {
      if (cursor.isPublic === 1) return current
      if (cursor.isPublic === 2) return null
      if (cursor.id === rootFolderId) return null
      cursor = await this.prisma.cloudFile.findFirst({
        where: { userId: root.userId, id: cursor.parentId, deletedAt: null },
      })
      depth++
    }
    return null
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
   * 新建文件夹（供 site 域创建站点流程建目录）：R4 同名自动"(1)" + R6 单目录子项上限（500）。
   * @param isPublic 显式公开标记（仅站点根目录需要置 1 作为继承锚点；子目录缺省 0=继承父目录）
   */
  async createFolder(userId: bigint, parentId: bigint, name: string, isPublic = false): Promise<CloudFile> {
    // R6：单目录直接子项上限（与 mkdir 同口径）
    const count = await this.prisma.cloudFile.count({
      where: { userId, parentId, deletedAt: null },
    })
    if (count >= 500) {
      throw new BusinessException(ErrorCode.CloudDirLimitExceeded, '单个目录下子项不能超过 500 个')
    }
    const finalName = await this.fileService.resolveNameConflict(userId, parentId, name)
    return this.prisma.cloudFile.create({
      data: { userId, parentId, name: finalName, isDir: 1, size: BigInt(0), isPublic: isPublic ? 1 : 0 },
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
    const defaultQuota = BigInt(this.config.get<number>('upload.cloudDefaultQuota', 1024 * 1024 * 1024))
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
      const defaultQuota = BigInt(this.config.get<number>('upload.cloudDefaultQuota', 1024 * 1024 * 1024))
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
   * 站点子树遍历（管理侧，不含回收站）：自 rootFolderId 有界 BFS 下行，
   * 默认 maxDepth 10 / limit 500，超限 truncated=true（§15.3）。
   */
  async listSubtreeRaw(
    rootFolderId: bigint,
    opts?: { maxDepth?: number; limit?: number },
  ): Promise<SubtreeListResult> {
    const maxDepth = opts?.maxDepth ?? SUBTREE_DEFAULT_MAX_DEPTH
    const limit = opts?.limit ?? SUBTREE_DEFAULT_LIMIT
    const root = await this.assertRawRoot(rootFolderId)

    const files: SubtreeEntry[] = []
    let truncated = false
    // BFS 逐层下行（路径相对站点根，'/' 连接；文件夹在前按名称升序，输出稳定）
    let queue: Array<{ id: bigint; path: string; depth: number }> = [{ id: root.id, path: '', depth: 0 }]
    while (queue.length > 0 && !truncated) {
      const nextQueue: typeof queue = []
      for (const node of queue) {
        if (truncated) break
        if (node.depth >= maxDepth) continue // 不再下行（有界防环）
        const children = await this.prisma.cloudFile.findMany({
          where: { userId: root.userId, parentId: node.id, deletedAt: null },
          orderBy: [{ isDir: 'desc' }, { name: 'asc' }],
        })
        for (const child of children) {
          if (files.length >= limit) {
            truncated = true
            break
          }
          const path = node.path ? `${node.path}/${child.name}` : child.name
          files.push({
            path,
            isDir: child.isDir === 1,
            size: Number(child.size),
            updatedAt: child.updateTime,
          })
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
   * 按路径读文件（管理侧）：逐段下行解析（有界 ≤10）；不存在/是目录 → 30001；
   * 读盘返回 Buffer（UTF-8 解码由调用方负责）。
   */
  async readFileRaw(rootFolderId: bigint, path: string): Promise<{ size: number; content: Buffer }> {
    const root = await this.assertRawRoot(rootFolderId)
    const segments = this.rawSegments(path)
    if (segments.length === 0 || segments.length > RESOLVE_MAX_DEPTH) {
      throw new BusinessException(ErrorCode.CloudFileNotFound, '文件不存在')
    }

    // 逐段下行（有界 ≤10）
    let current: CloudFile = root
    for (const seg of segments) {
      if (current.isDir !== 1) {
        throw new BusinessException(ErrorCode.CloudFileNotFound, '文件不存在')
      }
      const next = await this.prisma.cloudFile.findFirst({
        where: { userId: root.userId, parentId: current.id, name: seg, deletedAt: null },
      })
      if (!next) {
        throw new BusinessException(ErrorCode.CloudFileNotFound, '文件不存在')
      }
      current = next
    }
    if (current.isDir === 1 || !current.storageName) {
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
   * 按路径写文件（管理侧，R18/D22 软删旧版 + 新建）：
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
    const root = await this.assertRawRoot(rootFolderId)
    const segments = this.rawSegments(path)
    if (segments.length === 0 || segments.length > RESOLVE_MAX_DEPTH) {
      throw new BusinessException(ErrorCode.CloudDirLimitExceeded, '超出目录限制（深度>10）')
    }
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
    let parent: CloudFile = root
    for (const seg of dirSegments) {
      const next = await this.prisma.cloudFile.findFirst({
        where: { userId, parentId: parent.id, name: seg, deletedAt: null },
      })
      if (!next) {
        parent = await this.createFolder(userId, parent.id, seg)
      } else if (next.isDir === 1) {
        parent = next
      } else {
        // 中间段撞同名文件：无法下穿
        throw new BusinessException(ErrorCode.CloudFileNotFound, '同名路径存在文件，无法创建目录')
      }
    }

    // 目标末段：撞同名目录 → 无法以文件覆盖目录
    const existing = await this.prisma.cloudFile.findFirst({
      where: { userId, parentId: parent.id, name, deletedAt: null },
    })
    if (existing && existing.isDir === 1) {
      throw new BusinessException(ErrorCode.CloudFileNotFound, '同名目录已存在，无法写入文件')
    }

    // R6 单目录子项上限（排除将被软删的同名旧文件，覆盖场景不新增子项）
    const childCount = await this.prisma.cloudFile.count({
      where: {
        userId,
        parentId: parent.id,
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
      await this.registerPublicFile(userId, parent.id, name, {
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
}
