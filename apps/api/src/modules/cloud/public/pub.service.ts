import { Injectable } from '@nestjs/common'
import type { Request, Response } from 'express'
import type { CloudFile } from '@prisma/client'
import { ErrorCode } from '../../../common/constants/error-code'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import { CloudFacade } from '../facade/cloud-facade.service'
import { resolvePubMime } from './pub-mime'

/** socket 空闲超时（毫秒）：照 site 开放层 §14.4 口径，防慢连接占 fd */
const SOCKET_IDLE_TIMEOUT_MS = 30_000
/** path 下行最大深度（有界防环，照 §14.4） */
const MAX_DEPTH = 10

/** 公开文件夹列表项（API-P4C §8.3 契约） */
export interface PubListItem {
  name: string
  isDir: boolean
  size: number
  ext: string
  updatedAt: Date
}

/**
 * 云盘公开访问判定链（P4c §16.2，资产登记：token 校验 + 三态上溯 + path 下行）：
 * 1. token 查 cloud_file（deletedAt null 且 is_public=1）→ 40400（防探测统一码，不区分原因）
 * 2. 三态上溯（R25）：任一祖先 is_public=2（显式阻断）→ 40400；祖先行不存在/已删同样视为阻断
 *    （语义与 P4a site 开放层的"遇第一个非继承节点定生死、显式 1 可穿透父级阻断"不同：
 *    P4c PRD 验收明确"父目录设阻断 → 其下公开文件链接 40400"，故独立成链，不复用 resolvePublicPath）
 * 3. d 类端点 path 逐段下行：任一段不存在或 is_public=2 → 40400（0=继承放行 / 1=显式公开放行）
 * 4. 一期 DB 直查不加 Redis 缓存（D38）
 */
@Injectable()
export class PubService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudFacade: CloudFacade,
  ) {}

  // ==================== token 解析与判定链 ====================

  /** 文件类端点（f 三件套）：token → 文件行（非目录） */
  async resolvePublicFile(token: string): Promise<CloudFile> {
    const row = await this.byToken(token)
    if (!row || row.isDir !== 0) {
      throw notFound()
    }
    await this.assertAncestorsNotBlocked(row)
    return row
  }

  /** 文件夹类端点（d 四件套）：token → 文件夹行 */
  async resolvePublicFolder(token: string): Promise<CloudFile> {
    const row = await this.byToken(token)
    if (!row || row.isDir !== 1) {
      throw notFound()
    }
    await this.assertAncestorsNotBlocked(row)
    return row
  }

  /** 公开文件元信息（f info / d info 共用契约） */
  toInfo(row: CloudFile) {
    return {
      name: row.name,
      size: Number(row.size),
      mime: row.mime ?? '',
      ext: row.ext ?? '',
      updatedAt: row.updateTime,
    }
  }

  /**
   * 公开文件夹单层列表（d list）：allow_listing=0 → 40117（R33）；path 逐段下行后取直接子项，
   * 文件夹在前、名称字典序（照 file.list 口径）。
   */
  async listFolder(folder: CloudFile, rawPath: string | undefined): Promise<{ path: string; items: PubListItem[] }> {
    if (folder.allowListing !== 1) {
      throw new BusinessException(ErrorCode.CloudListingDisabled, '该文件夹未开放列表浏览')
    }
    const target = await this.descend(folder, rawPath)
    const children = await this.prisma.cloudFile.findMany({
      where: { userId: target.userId, parentId: target.id, deletedAt: null },
      orderBy: [{ isDir: 'desc' }, { name: 'asc' }],
    })
    return {
      path: this.normalizePath(rawPath ?? '') ?? '',
      items: children.map((c) => ({
        name: c.name,
        isDir: c.isDir === 1,
        size: Number(c.size),
        ext: c.ext ?? '',
        updatedAt: c.updateTime,
      })),
    }
  }

  /** d 类子项寻址：path（指向文件）→ 目标行；缺 path / 指向目录 → 40400 */
  async resolveSubFile(folder: CloudFile, rawPath: string | undefined): Promise<CloudFile> {
    const target = await this.descend(folder, rawPath)
    if (target.isDir !== 0) {
      throw notFound()
    }
    return target
  }

  // ==================== 流式输出（raw / download 共用） ====================

  /**
   * 公开文件流输出：inline（raw）或 attachment（download / R26 强制下载类）。
   * 复用 CloudFacade.getPublicStream（StorageService 流式读取，禁整文件进内存）；
   * Range 三形式 / 206 / 416、ETag/304（Cache-Control: no-cache，D28 口径）、
   * Content-Disposition filename* 编码原名 + ASCII 兜底（照 T27 口径）。
   */
  async serveFile(row: CloudFile, req: Request, res: Response, mode: 'raw' | 'download'): Promise<void> {
    // 1. 取元数据（size/ext/name/updateTime；无 Range 时即全量流）
    const meta = await this.cloudFacade.getPublicStream(row.id)
    const size = Number(meta.size)

    // 2. MIME 与处置：download 一律 attachment；raw 按白名单（R26：html/svg 强制 attachment）
    const resolved = resolvePubMime(meta.ext)
    const disposition =
      mode === 'download' || !resolved.inline ? 'attachment' : 'inline'
    const contentType = mode === 'download' ? 'application/octet-stream' : resolved.contentType

    // 3. ETag / 304（协商缓存；no-cache：变更立即可见，未变仅头部往返）
    const etag = `W/"${meta.size.toString()}-${meta.updateTime.getTime()}"`
    if (req.headers['if-none-match'] === etag) {
      res.status(304).set('ETag', etag).end()
      return
    }

    // 4. Range 解析（bytes=start-end / start- / -suffix；语法非法忽略回 200 全量；越界 416）
    const parsed = req.headers.range ? this.parseRange(req.headers.range, size) : null
    if (parsed === 'unsatisfiable') {
      res.status(416).set('Content-Range', `bytes */${size}`).end()
      return
    }

    // 5. 公共响应头（nosniff 由 helmet 全局兜底）
    res.set({
      ETag: etag,
      'Last-Modified': meta.updateTime.toUTCString(),
      'Cache-Control': 'no-cache',
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `${disposition}; filename="${this.asciiFallback(meta.name)}"; filename*=UTF-8''${encodeURIComponent(meta.name)}`,
    })

    // 6. socket 空闲超时（照开放层口径）
    res.setTimeout(SOCKET_IDLE_TIMEOUT_MS, () => {
      res.destroy()
    })

    // 7. 流式输出（Range 命中时按区间重新取流，避免全量读盘）
    const stream =
      parsed !== null
        ? (await this.cloudFacade.getPublicStream(row.id, { start: parsed.start, end: parsed.end })).stream
        : meta.stream
    if (parsed !== null) {
      res.status(206).set({
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${parsed.start}-${parsed.end}/${size}`,
        'Content-Length': String(parsed.end - parsed.start + 1),
      })
    } else {
      res.status(200).set({
        'Accept-Ranges': 'bytes',
        'Content-Length': String(size),
      })
    }
    stream.pipe(res)
  }

  // ==================== 内部实现 ====================

  /** token 查行（deletedAt null 且 is_public=1；软删行 token 视为失效） */
  private async byToken(token: string): Promise<CloudFile | null> {
    if (!token) return null
    return this.prisma.cloudFile.findFirst({
      where: { publicToken: token, deletedAt: null, isPublic: 1 },
    })
  }

  /** R25 三态上溯：任一祖先 is_public=2 → 40400；祖先缺失/已删视为阻断；有界 ≤12 层防环 */
  private async assertAncestorsNotBlocked(row: CloudFile): Promise<void> {
    let cursorId = row.parentId
    let depth = 0
    while (cursorId !== BigInt(0) && depth <= MAX_DEPTH + 2) {
      const ancestor = await this.prisma.cloudFile.findFirst({
        where: { id: cursorId, deletedAt: null },
      })
      if (!ancestor) throw notFound()
      if (ancestor.isPublic === 2) throw notFound()
      cursorId = ancestor.parentId
      depth++
    }
    if (depth > MAX_DEPTH + 2) throw notFound()
  }

  /**
   * path 逐段下行（d 类端点）：规范化（拒反斜杠/../超深/非法编码）后自 folder 下行；
   * 缺 path = folder 自身；任一段不存在或 is_public=2 → 40400。
   */
  private async descend(folder: CloudFile, rawPath: string | undefined): Promise<CloudFile> {
    const normalized = this.normalizePath(rawPath ?? '')
    if (normalized === null) throw notFound()
    let current = folder
    // 空路径 = folder 自身（split('/') 对 '' 会产出空段，须先判空）
    const segments = normalized.length > 0 ? normalized.split('/') : []
    for (const seg of segments) {
      const next = await this.prisma.cloudFile.findFirst({
        where: { userId: folder.userId, parentId: current.id, name: seg, deletedAt: null },
      })
      if (!next) throw notFound()
      if (next.isPublic === 2) throw notFound()
      current = next
    }
    return current
  }

  /** 路径规范化（R3 同款）：解码后拒绝反斜杠/../空段；返回 '/' 连接路径或 null */
  private normalizePath(rawPath: string): string | null {
    let decoded: string
    try {
      decoded = decodeURIComponent(rawPath)
    } catch {
      return null
    }
    if (decoded.includes('\\')) return null
    const segments: string[] = []
    for (const seg of decoded.split('/')) {
      if (seg === '' || seg === '.') continue
      if (seg === '..') return null
      segments.push(seg)
    }
    if (segments.length > MAX_DEPTH) return null
    return segments.join('/')
  }

  /** 解析单区间 Range 头（语义照 T27 streamToResponse） */
  private parseRange(header: string, size: number): { start: number; end: number } | 'unsatisfiable' | null {
    if (size === 0) return 'unsatisfiable'
    const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
    if (!match) return null
    const [, startRaw, endRaw] = match
    if (startRaw === '') {
      if (endRaw === '') return null
      const suffix = Number(endRaw)
      if (suffix === 0) return 'unsatisfiable'
      return { start: Math.max(0, size - suffix), end: size - 1 }
    }
    const start = Number(startRaw)
    if (start >= size) return 'unsatisfiable'
    const end = endRaw === '' ? size - 1 : Math.min(Number(endRaw), size - 1)
    if (end < start) return null
    return { start, end }
  }

  /** filename 的 ASCII 兜底（quoted-string 内引号/反斜杠替换，照 T27 口径） */
  private asciiFallback(name: string): string {
    const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
    return ascii || 'file'
  }
}

/** 公开资源类统一 40400（防探测，不区分原因） */
function notFound(): BusinessException {
  return new BusinessException(ErrorCode.NotFound, '资源不存在')
}
