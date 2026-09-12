import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Response } from 'express'
import { ZipFile } from 'yazl'
import { ErrorCode } from '../../../common/constants/error-code'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import { StorageService } from '../../../infra/storage/storage.service'

/** 打包时目录递归展开的深度上限（R6 同口径，D45/§17.2） */
const PACK_MAX_DEPTH = 10

/** 打包条目（zip 内相对路径 + 正式区 storage_name + 字节数） */
export interface PackEntry {
  path: string
  storageName: string
  size: bigint
}

/** 打包收集结果 */
export interface PackCollectResult {
  entries: PackEntry[]
  /** 被跳过的源项数（不存在/已删/回收站/超单文件上限），进响应头 X-Pack-Skipped（R41） */
  skipped: number
  /** 条目总数超上限被截断（截断点记运行日志） */
  truncated: boolean
}

/**
 * 流式打包（P4d T54/D45，R41）：yazl 边压边流向 HTTP 响应——**零临时落盘、禁整包进内存**。
 * 双调用方：
 * - 管理侧 `POST /cloud/file/pack-download`（打包自有文件，不查三态——自己的文件自己的包）；
 * - 访客侧 `GET /cloud/share/:token/pack`（文件夹分享整包，publicOnly=true 时 is_public=2 阻断项
 *   及其子树不可见，R43/D48）。
 * zip 条目名由 yazl 统一置 UTF-8 flag（bit 11，源码 FILE_NAME_IS_UTF8 恒开），Windows 解压不乱码。
 */
@Injectable()
export class PackService {
  private readonly logger = new Logger(PackService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly storage: StorageService,
  ) {}

  /** 打包文件名：iplat-pack-yyyyMMdd-HHmm.zip */
  buildFilename(now = new Date()): string {
    const pad = (n: number) => String(n).padStart(2, '0')
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
    return `iplat-pack-${stamp}.zip`
  }

  /**
   * 收集打包条目：逐个根项（文件直接入包；文件夹有界 BFS 展开，保留目录结构）。
   * 跳过项：不存在/已删（回收站内 id 也在其中）、非属主、超单文件上限（R41）、无物理文件；
   * 访客侧（publicOnly）额外过滤 is_public=2 的阻断项及其整棵子树。
   * 条目总数超 CLOUD_UNZIP_MAX_ENTRIES 口径（5000）截断并记日志。
   */
  async collect(
    userId: bigint,
    rootIds: bigint[],
    opts: { publicOnly?: boolean } = {},
  ): Promise<PackCollectResult> {
    const maxFileSize = BigInt(this.config.get<number>('upload.cloudMaxFileSize', 100 * 1024 * 1024))
    const maxEntries = this.config.get<number>('upload.cloudUnzipMaxEntries', 5000)

    const entries: PackEntry[] = []
    const seenPaths = new Set<string>()
    let skipped = 0
    let truncated = false

    const pushFile = (path: string, storageName: string | null, size: bigint): void => {
      if (!storageName || size > maxFileSize || seenPaths.has(path)) {
        if (!seenPaths.has(path)) skipped++
        return
      }
      seenPaths.add(path)
      entries.push({ path, storageName, size })
    }

    for (const rootId of rootIds) {
      if (truncated) break
      const row = await this.prisma.cloudFile.findFirst({
        where: { id: rootId, userId, deletedAt: null },
      })
      // 不存在 / 已删（含回收站项）→ 跳过计数（R41）
      if (!row || (opts.publicOnly && row.isPublic === 2)) {
        skipped++
        continue
      }
      if (row.isDir === 0) {
        pushFile(row.name, row.storageName, row.size)
        continue
      }

      // 目录：有界 BFS 展开，zip 内保留目录结构
      let queue: Array<{ id: bigint; prefix: string; depth: number }> = [
        { id: row.id, prefix: `${row.name}/`, depth: 1 },
      ]
      while (queue.length > 0 && !truncated) {
        const nextQueue: typeof queue = []
        for (const node of queue) {
          if (truncated) break
          const children = await this.prisma.cloudFile.findMany({
            where: { userId, parentId: node.id, deletedAt: null },
            orderBy: [{ isDir: 'desc' }, { name: 'asc' }],
          })
          for (const child of children) {
            // 访客视角：显式阻断项及其子树对外不可见（R43/D48）
            if (opts.publicOnly && child.isPublic === 2) continue
            if (entries.length >= maxEntries) {
              truncated = true
              break
            }
            const path = node.prefix + child.name
            if (child.isDir === 1) {
              if (node.depth < PACK_MAX_DEPTH) {
                nextQueue.push({ id: child.id, prefix: `${path}/`, depth: node.depth + 1 })
              }
              continue
            }
            pushFile(path, child.storageName, child.size)
          }
        }
        queue = nextQueue
      }
    }

    if (truncated) {
      this.logger.warn(`打包条目数超过 ${maxEntries}，已截断（用户 ${userId.toString()}）`)
    }
    return { entries, skipped, truncated }
  }

  /**
   * 流式输出 zip（R41：零落盘、禁整包进内存）。
   * 响应头：application/zip + Content-Disposition filename*（UTF-8 原名）+ ASCII 兜底 + X-Pack-Skipped。
   * 条目 > 单文件上限 / 回收站项在收集阶段已跳过并计数（响应头提示）。
   *
   * 注意（2026-09-12 修复）：quoted-string 的 filename 必须 ASCII 兜底——分享侧包名取源文件夹名，
   * 中文名直接进响应头会让 Node 抛 ERR_INVALID_CHAR（500 → 访客「下载全部」变白页），
   * 口径与 transfer/pub/share 三处单文件下载一致。
   */
  async stream(entries: PackEntry[], res: Response, opts: { filename: string; skipped: number }): Promise<void> {
    const zip = new ZipFile()

    res.status(200).set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${this.asciiFallback(opts.filename)}"; filename*=UTF-8''${encodeURIComponent(opts.filename)}`,
      'X-Pack-Skipped': String(opts.skipped),
      // 流式响应无 Content-Length（chunked），禁缓存
      'Cache-Control': 'no-store',
    })

    // 客户端中断（关页面/取消下载）→ 销毁 zip 输出流，避免继续读盘
    res.on('close', () => {
      if (!res.writableEnded) {
        zip.outputStream.destroy()
      }
    })
    zip.on('error', (error) => {
      this.logger.warn(`打包输出失败：${error.message}`)
      if (!res.writableEnded) res.destroy(error)
    })

    zip.outputStream.pipe(res)
    for (const entry of entries) {
      try {
        zip.addFile(this.storage.resolvePath(entry.storageName), entry.path)
      } catch (error) {
        // 单条物理路径异常（越界/丢失）→ 跳过该条，不中断整包
        this.logger.warn(`打包跳过条目 ${entry.path}：${(error as Error).message}`)
      }
    }
    zip.end()
  }

  /** 打包并输出（管理侧入口；ids 为空或全部无效 → 30001，避免下载空包无反馈） */
  async packToResponse(userId: bigint, rootIds: bigint[], res: Response): Promise<void> {
    const { entries, skipped } = await this.collect(userId, rootIds)
    if (entries.length === 0) {
      throw new BusinessException(
        ErrorCode.CloudFileNotFound,
        skipped > 0 ? '所选项目不可打包（不存在或超出单文件上限）' : '没有可打包的内容',
      )
    }
    await this.stream(entries, res, { filename: this.buildFilename(), skipped })
  }

  /** filename 的 ASCII 兜底（quoted-string 内的非 ASCII/引号/反斜杠一律替换，照 T27 口径） */
  private asciiFallback(name: string): string {
    const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
    return ascii || 'file'
  }
}
