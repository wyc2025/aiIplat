import { Controller, Get, Logger, Param, Req, Res } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Request, Response } from 'express'
import { ErrorCode } from '../../../common/constants/error-code'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { RedisService } from '../../../infra/redis/redis.service'
import { Public } from '../../../gateway/decorators/public.decorator'
import { SkipTransform } from '../../../gateway/decorators/skip-transform.decorator'
import { CloudFacade } from '../../cloud/facade/cloud-facade.service'
import { SiteResolveService, type ResolvedPath } from './site-resolve.service'
import { assertRateLimit, extractIp } from './rate-limit.util'
import { CSP_SANDBOX, resolveMime } from './mime'

/** socket 空闲超时（毫秒）：慢连接占用 fd 上限，§14.4 */
const SOCKET_IDLE_TIMEOUT_MS = 30_000
/** 路径段上限（§14.4 有界逐段下行，防环） */
const MAX_DEPTH = 10

/**
 * 开放静态服务（架构增补 §14.4/§14.5，PRD-P4A D5/D6）：
 * /api/open/{slug} 与 /api/open/{slug}/{*path}（Express 5 通配语法，{*path} 得 string[]）。
 * 全程 @Public 免登录、禁挂 @OperationLog（D11）、一切失败统一 40400（R15）。
 * 双保险：解析到首段 === 'api' 一律 40400（数据接口由 OpenApiController 先注册，T38 落地）。
 */
@ApiTags('个人网站-开放静态')
@Controller('open')
export class OpenStaticController {
  private readonly logger = new Logger(OpenStaticController.name)

  constructor(
    private readonly resolveService: SiteResolveService,
    private readonly cloudFacade: CloudFacade,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  /** 站点入口（= 根目录 index.html） */
  @Public()
  @SkipTransform()
  @Get(':slug')
  @ApiOperation({ summary: '站点入口（根目录 index.html）' })
  async index(@Param('slug') slug: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    await this.serve(slug, '', req, res)
  }

  /** 静态文件（nginx 语义，路径即 URL） */
  @Public()
  @SkipTransform()
  @Get(':slug/*path')
  @ApiOperation({ summary: '站点静态文件（MIME 白名单 + CSP 沙箱 + ETag/304 + Range）' })
  async static(
    @Param('slug') slug: string,
    @Param('path') path: string[],
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.serve(slug, path.join('/'), req, res)
  }

  /** 开放静态核心流程（§14.4） */
  private async serve(slug: string, rawPath: string, req: Request, res: Response): Promise<void> {
    // 1. 独立限流（静态桶 120 次/分/IP，site 配置组）
    await assertRateLimit(
      this.redis,
      'static',
      extractIp(req),
      this.config.get<number>('site.siteOpenStaticRateLimit', 120),
    )

    // 2. slug 解析（缓存 300s）；站点不存在/停用 → 40400
    const site = await this.resolveService.resolveSite(slug)
    if (!site) {
      throw new BusinessException(ErrorCode.NotFound, '站点不存在')
    }

    // 3. 路径规范化（R3：拒绝空段/反斜杠/./..；首段 api 一律 40400 双保险）
    const normalized = this.normalizePath(rawPath)
    if (normalized === null) {
      throw new BusinessException(ErrorCode.NotFound, '资源不存在')
    }
    if (normalized === 'api' || normalized.startsWith('api/')) {
      throw new BusinessException(ErrorCode.NotFound, '资源不存在')
    }

    // 4. 目录语义（R4）：空 → index.html；尾斜杠 → index.html；文件未命中但目录命中 → 301 补斜杠
    let target = normalized
    if (target === '') {
      target = 'index.html'
    } else if (target.endsWith('/')) {
      target = `${target}index.html`
    }

    let resolved = await this.resolveService.resolvePath(site.siteId, site.rootFolderId, target)
    if (!resolved.found) {
      // 文件未命中：尝试目录语义（去尾斜杠 / 补尾斜杠找 index.html）
      const dirResult = await this.tryDirectoryRedirect(
        site.siteId,
        site.rootFolderId,
        target,
        normalized,
        res,
      )
      if (dirResult === 'redirected') {
        return
      }
      if (!dirResult.found) {
        throw new BusinessException(ErrorCode.NotFound, '资源不存在')
      }
      resolved = dirResult
    }

    // 5. 解析 Range（先取元数据判断区间，再按区间取流）
    const fileMeta = await this.cloudFacade.getPublicStream(BigInt(resolved.fileId))
    const size = Number(fileMeta.size)
    const rangeResult = req.headers.range ? this.parseRange(req.headers.range, size) : null
    if (rangeResult === 'unsatisfiable') {
      res.status(416).set('Content-Range', `bytes */${size}`).end()
      return
    }
    // 命中 Range 时按区间重新取流（避免全量读盘）
    const rangeParsed = rangeResult ?? null
    const file =
      rangeParsed !== null
        ? await this.cloudFacade.getPublicStream(BigInt(resolved.fileId), {
            start: rangeParsed.start,
            end: rangeParsed.end,
          })
        : fileMeta

    // 6. MIME 白名单 + 安全头（§14.5）
    const mime = resolveMime(file.ext)

    // 7. ETag / 304（Cache-Control：html no-cache，其余白名单 public max-age）
    const etag = `W/"${file.size.toString()}-${file.updateTime.getTime()}"`
    const ifNoneMatch = req.headers['if-none-match']
    if (ifNoneMatch === etag) {
      res.status(304).set('ETag', etag).end()
      return
    }

    const isHtml = mime.contentType.startsWith('text/html')
    const cacheControl = isHtml ? 'no-cache' : mime.whitelisted ? 'public, max-age=3600' : 'no-store'

    // 8. 公共响应头（nosniff 已由 helmet 全局开启；ACAO 由 main.ts CORS 函数式统一）
    res.set({
      ETag: etag,
      'Last-Modified': file.updateTime.toUTCString(),
      'Cache-Control': cacheControl,
      'Content-Type': mime.contentType,
      'X-Content-Type-Options': 'nosniff',
    })
    if (mime.sandbox) {
      res.set('Content-Security-Policy', CSP_SANDBOX)
    }
    if (mime.attachment) {
      res.set('Content-Disposition', `attachment; filename="${file.name}"`)
    }

    // 9. socket 空闲超时（res.setTimeout 仅针对本响应：无数据流动 30s 触发；响应 finish 自动清除，
    //    不影响 keep-alive 连接复用；防慢连接占 fd，活跃流不受影响）
    res.setTimeout(SOCKET_IDLE_TIMEOUT_MS, () => {
      this.logger.warn(`开放静态连接空闲超时，强制关闭：${slug}/${rawPath}`)
      res.destroy()
    })

    // 10. 流式输出（Range 单区间：206；全量：200）
    if (rangeParsed !== null) {
      res.status(206).set({
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${rangeParsed.start}-${rangeParsed.end}/${size}`,
        'Content-Length': String(rangeParsed.end - rangeParsed.start + 1),
      })
    } else {
      res.status(200).set({
        'Accept-Ranges': 'bytes',
        'Content-Length': String(size),
      })
    }
    file.stream.pipe(res)
  }

  /** 路径规范化（R3）：解码后拒绝空段/反斜杠/./..；返回规范化相对路径或 null */
  private normalizePath(rawPath: string): string | null {
    // URL 解码（decodeURIComponent 容错：非法编码直接拒绝）
    let decoded: string
    try {
      decoded = decodeURIComponent(rawPath)
    } catch {
      return null
    }
    // 拒绝反斜杠（防 Windows 语义混淆）
    if (decoded.includes('\\')) return null
    const segments = decoded.split('/')
    const result: string[] = []
    for (const seg of segments) {
      if (seg === '' || seg === '.') continue // 空段与 . 跳过
      if (seg === '..') return null // 拒绝父级穿越
      result.push(seg)
    }
    if (result.length > MAX_DEPTH) return null
    return result.join('/')
  }

  /**
   * 目录语义（R4）：文件未命中时，尝试「目录 + index.html」或「无扩展名且目录存在 → 301 补斜杠」。
   * 返回 ResolvedPath，或 'redirected'（已 301 补斜杠）。
   */
  private async tryDirectoryRedirect(
    siteId: string,
    rootFolderId: string,
    target: string,
    normalized: string,
    res: Response,
  ): Promise<ResolvedPath | 'redirected'> {
    // 尝试目录下 index.html（path/ 与 path 两种形态）
    const asDirIndex = `${normalized.replace(/\/$/, '')}/index.html`
    if (asDirIndex !== target) {
      const r = await this.resolveService.resolvePath(siteId, rootFolderId, asDirIndex)
      if (r.found) return r
    }
    // 无扩展名且未命中文件：若目录存在 → 301 补斜杠（相对引用依赖正确基址）
    const noExt = !/\.[a-z0-9]+$/i.test(normalized) && normalized !== ''
    if (noExt) {
      const dirResolved = await this.cloudFacade.resolvePublicPath(BigInt(rootFolderId), normalized)
      if (dirResolved && dirResolved.isDir === 1) {
        res.status(301).set('Location', `/${normalized}/`).end()
        return 'redirected'
      }
    }
    return { found: false }
  }

  /** 解析单区间 Range（bytes=start-end / start- / -suffix），与 P3 transfer 口径一致 */
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
}
