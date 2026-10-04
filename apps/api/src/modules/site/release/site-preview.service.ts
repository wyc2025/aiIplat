import { Injectable, Logger } from '@nestjs/common'
import type { Request, Response } from 'express'
import { ErrorCode } from '../../../common/constants/error-code'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import { CloudFacade } from '../../cloud/facade/cloud-facade.service'
import { CSP_SANDBOX, resolveMime } from '../open/mime'

/** socket 空闲超时（毫秒，与开放层同口径） */
const SOCKET_IDLE_TIMEOUT_MS = 30_000

/**
 * 站点管理态预览（P19 T162 / D149 / FR6）。
 *
 * 读**工作副本**（云盘站点目录）出流——AI / 编辑器写完即刻可见，与线上已发布版本无关。
 * 这正是「工作区 vs 发布版」双轨里的**工作区侧**：发布前的一切迭代都在这里看效果。
 *
 * 安全件与开放层**同款**（R160）：MIME 白名单、CSP 沙箱、`X-Content-Type-Options: nosniff`、
 * ETag/304、`Cache-Control: no-cache`、流式输出 + Range。
 * 与开放层的两点差异（刻意）：
 * 1. **鉴权**：需登录 + 站点权限（未登录 401 / 无权限 403 / 非属主站点 40400），开放层不设本入口；
 * 2. **不消费公开性**：属主对自己站点内任何文件都可预览（含未公开页），不经 `is_public` 链。
 */
@Injectable()
export class SitePreviewService {
  private readonly logger = new Logger(SitePreviewService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudFacade: CloudFacade,
  ) {}

  /**
   * 出流工作副本中某个路径（目录/美化路径按既有回退链解析）。
   *
   * 回退顺序（与开放层一致）：目录 → `index.html`；无扩展名 → `{path}.html` → 站点 `spaFallback` →
   * `{path}/index.html`；全不命中 → 40400。
   */
  async serve(
    userId: bigint,
    siteId: bigint,
    rawPath: string,
    req: Request,
    res: Response,
  ): Promise<void> {
    const site = await this.prisma.siteSite.findFirst({
      where: { id: siteId, userId },
      select: { rootFolderId: true, spaFallback: true },
    })
    if (!site) throw new BusinessException(ErrorCode.NotFound, '站点不存在')

    const normalized = this.normalize(rawPath)
    if (normalized === null) throw new BusinessException(ErrorCode.NotFound, '资源不存在')

    for (const candidate of this.candidates(normalized, rawPath, site.spaFallback)) {
      const file = await this.cloudFacade.resolveOwnTreePath(site.rootFolderId, candidate)
      if (!file || file.isDir === 1) continue
      await this.streamFile(file.id, req, res)
      return
    }
    throw new BusinessException(ErrorCode.NotFound, '资源不存在')
  }

  /** 出流单个文件（安全件与开放层同款） */
  private async streamFile(fileId: bigint, req: Request, res: Response): Promise<void> {
    const range = this.parseRange(req)
    let meta: Awaited<ReturnType<CloudFacade['getPublicStream']>>
    try {
      meta = await this.cloudFacade.getPublicStream(fileId, range)
    } catch (error) {
      // 缓存 fileId 失效（文件被并发删除）→ 统一 40400，禁 500（R15 同口径）
      if (error instanceof BusinessException) throw error
      this.logger.warn(`预览取流失败：${String(error)}`)
      throw new BusinessException(ErrorCode.NotFound, '资源不存在')
    }

    const size = Number(meta.size ?? 0)
    const mime = resolveMime(meta.ext)
    const etag = `W/"${size}-${String(meta.updateTime?.getTime() ?? 0)}"`
    res.set({
      'Content-Type': mime.contentType,
      'Content-Length': String(range ? range.end - range.start + 1 : size),
      // 预览与线上同款：白名单扩展名可协商缓存（ETag/304），其余 no-store（与开放层口径一致）
      'Cache-Control': mime.whitelisted ? 'no-cache' : 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...(mime.sandbox ? { 'Content-Security-Policy': CSP_SANDBOX } : {}),
      ETag: etag,
      'Last-Modified': meta.updateTime?.toUTCString() ?? new Date().toUTCString(),
      ...(mime.attachment ? { 'Content-Disposition': 'attachment' } : {}),
      ...(range ? { 'Content-Range': `bytes ${range.start}-${range.end}/${size}` } : {}),
    })

    // 条件请求（If-None-Match）→ 304
    const inm = req.headers['if-none-match']
    if (typeof inm === 'string' && inm === etag) {
      res.status(304).end()
      return
    }
    res.status(range ? 206 : 200)

    res.setTimeout(SOCKET_IDLE_TIMEOUT_MS)
    meta.stream.pipe(res)
  }

  /** 回退候选序列（与开放层同口径） */
  private candidates(normalized: string, rawPath: string, spaFallback: string | null): string[] {
    if (normalized === '') return ['index.html']
    const list: string[] = []
    if (rawPath.endsWith('/')) {
      list.push(`${normalized}/index.html`)
      return list
    }
    list.push(normalized)
    const last = normalized.split('/').pop() ?? ''
    if (!/\.[A-Za-z0-9]{1,8}$/.test(last)) {
      list.push(`${normalized}.html`)
      if (spaFallback) list.push(spaFallback)
      list.push(`${normalized}/index.html`)
    }
    return list
  }

  /** 规范化（拒反斜杠 / `..` / 空段；返回去首尾斜杠的相对路径，非法返回 null） */
  private normalize(rawPath: string): string | null {
    let decoded: string
    try {
      decoded = decodeURIComponent(rawPath ?? '')
    } catch {
      return null
    }
    if (decoded.includes('\\')) return null
    const segments = decoded.split('/').filter((seg) => seg.length > 0 && seg !== '.')
    if (segments.some((seg) => seg === '..')) return null
    if (segments.length > 10) return null
    return segments.join('/')
  }

  /** Range 解析（`bytes=start-end` / `start-` / `-suffix`；不合法返回 undefined 走整文件） */
  private parseRange(req: Request): { start: number; end: number } | undefined {
    const header = req.headers.range
    if (typeof header !== 'string') return undefined
    const matched = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
    if (!matched) return undefined
    const [, rawStart, rawEnd] = matched
    if (rawStart === '' && rawEnd === '') return undefined
    if (rawStart === '') {
      const suffix = Number(rawEnd)
      if (!Number.isFinite(suffix)) return undefined
      return { start: Math.max(0, -suffix), end: Number.MAX_SAFE_INTEGER }
    }
    const start = Number(rawStart)
    const end = rawEnd === '' ? Number.MAX_SAFE_INTEGER : Number(rawEnd)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return undefined
    return { start, end }
  }
}
