import { Injectable } from '@nestjs/common'
import type { Readable } from 'node:stream'
import type { CloudFile } from '@prisma/client'
import { ConfigService } from '@nestjs/config'
import { ErrorCode } from '../../../common/constants/error-code'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import { StorageService } from '../../../infra/storage/storage.service'
import { FileService, AVATAR_PARENT_ID } from '../file/file.service'

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
}
