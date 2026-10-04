import { Controller, Get, Logger, Param, Req, Res } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Request, Response } from 'express'
import type { Readable } from 'node:stream'
import { ErrorCode } from '../../../common/constants/error-code'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { RedisService } from '../../../infra/redis/redis.service'
import { Public } from '../../../gateway/decorators/public.decorator'
import { SkipTransform } from '../../../gateway/decorators/skip-transform.decorator'
import { CloudFacade } from '../../cloud/facade/cloud-facade.service'
import { DisplayFacade } from '../../display/facade/display-facade.service'
import { SiteResolveService, type ResolvedPath, type ResolvedSite } from './site-resolve.service'
import { SiteReleaseTrackService } from './site-release-track.service'
import { assertRateLimit, extractIp } from './rate-limit.util'
import { CSP_SANDBOX, resolveMime } from './mime'

/** socket 空闲超时（毫秒）：慢连接占用 fd 上限，§14.4 */
const SOCKET_IDLE_TIMEOUT_MS = 30_000
/** 路径段上限（§14.4 有界逐段下行，防环） */
const MAX_DEPTH = 10

/** 出流元数据（P19 T162 双轨统一形态：legacy 轨来自云盘、快照轨来自 site-releases） */
interface ServeFileMeta {
  stream: Readable
  size: number
  ext: string | null
  name: string
  mtime: Date
}

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
    private readonly displayFacade: DisplayFacade,
    /** 快照轨解析（P19 T162）：站点已发布时从 site-releases 出流（D144） */
    private readonly releaseTrack: SiteReleaseTrackService,
  ) {}

  /** 站点入口（= 根目录 index.html） */
  @Public()
  @SkipTransform()
  @Get(':slug')
  @ApiOperation({ summary: '站点入口（根目录 index.html）' })
  async index(
    @Param('slug') slug: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.serve(slug, '', req, res)
  }

  /**
   * 展示应用入口（P14 §30.3）：`/api/open/:slug/disp/:id` = 该展示应用目录的 index.html。
   * 无尾斜杠 → 301 补斜杠（修正相对引用基址，照站点根语义）。
   *
   * **声明顺序**（控制器内声明顺序 = 路由注册顺序，同 §14.4 铁律）：本方法须在
   * `:slug/*path`（站点静态通配）**之前**，否则 `/disp/:id/` 会被通配吞掉、再被 SPA/美化回退
   * 兜成站点首页（P14 端到端实测发现：返回 200 站点首页而非 40400）。
   */
  @Public()
  @SkipTransform()
  @Get(':slug/disp/:id')
  @ApiOperation({ summary: '展示应用入口（挂靠校验；未挂靠/挂他站/已删 → 40400）' })
  async displayIndex(
    @Param('slug') slug: string,
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const prefix = await this.resolveDisplayPrefix(slug, id)
    if (!req.path.endsWith('/')) {
      res.status(301).set('Location', `/api/open/${slug}/${prefix}/`).end()
      return
    }
    await this.serveDisplay(slug, id, '', req, res)
  }

  /**
   * 展示应用静态文件（P14 §30.3）：站点目录内 `disp/{id}/**` 子树，其余语义（MIME/CSP/ETag/Range/
   * 路径美化/SPA 回退）与站点静态完全一致（同一 `serve` 流程）。同样须先于 `:slug/*path` 声明。
   */
  @Public()
  @SkipTransform()
  @Get(':slug/disp/:id/*path')
  @ApiOperation({ summary: '展示应用静态文件（相对路径资源；挂靠校验后走站点目录子树）' })
  async displayStatic(
    @Param('slug') slug: string,
    @Param('id') id: string,
    @Param('path') path: string[],
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    // P15 D123 双保险：`disp/{id}/api/**` 是取数面子前缀（由 OpenAppDataController 承接）——
    // 若因注册顺序意外落到静态通配，一律 40400，绝不把 `api/` 当文件路径解析
    // （否则会被路径美化 / SPA 回退兜成 200 站点首页，P14 已实测过该类吞并）。
    if (path.length > 0 && path[0] === 'api') {
      throw new BusinessException(ErrorCode.NotFound, '资源不存在')
    }
    await this.serveDisplay(slug, id, path.join('/'), req, res)
  }

  /**
   * 展示应用挂靠校验（P14 R125 前置 / §30.3）：站点存在 → 展示应用存在、未软删且 `site_id` = 本站点；
   * 任一不满足一律 40400（不暴露存在性；未挂靠的暂存区目录不对外服务，§30.8 ④）。
   */
  private async resolveDisplayPrefix(slug: string, rawId: string): Promise<string> {
    const site = await this.resolveService.resolveSite(slug)
    if (!site) {
      throw new BusinessException(ErrorCode.NotFound, '资源不存在')
    }
    if (!/^\d{1,20}$/.test(rawId)) {
      throw new BusinessException(ErrorCode.NotFound, '资源不存在')
    }
    const meta = await this.displayFacade.resolveForOpen(BigInt(site.siteId), BigInt(rawId))
    return meta.relPath
  }

  /** 静态文件（nginx 语义，路径即 URL）——须在展示应用路由**之后**声明（通配优先级语义，见上） */
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

  /**
   * 开放静态核心流程（§14.4；P19 T162 双轨）。
   *
   * @param track `auto`（默认）= 按站点是否已发布自动选轨；`legacy` = 强制直挂工作副本
   *              （**`disp/` 展示应用托管链专用**：D150 明确它不随快照，维持现状实时语义）
   */
  private async serve(
    slug: string,
    rawPath: string,
    req: Request,
    res: Response,
    track: 'auto' | 'legacy' = 'auto',
  ): Promise<void> {
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

    // 4. 目录语义（R4）：根请求带斜杠 → index.html；根请求无斜杠 → 301 补斜杠（修正相对引用基址，
    //    Location 含挂载点前缀）。normalized 已无尾斜杠（normalizePath 吃掉空段），原始斜杠信息取自 req.path
    const hasTrailingSlash = req.path.endsWith('/')
    let target = normalized
    if (target === '') {
      if (!hasTrailingSlash) {
        res.status(301).set('Location', `/api/open/${slug}/`).end()
        return
      }
      target = 'index.html'
    }

    // 4.5 快照轨分叉（P19 D144/T162）：站点已发布 → 从不可变快照出流（不消费 is_public，R161）；
    //     从未发布 → 继续 legacy 直挂工作副本（公开判定为 W12 阻断优先语义）；disp 链显式走 legacy。
    if (track === 'auto' && site.activeReleaseId) {
      await this.serveFromRelease(site, rawPath, req, res)
      return
    }

    let resolved = await this.resolveService.resolvePath(site.siteId, site.rootFolderId, target)
    if (!resolved.found) {
      // 文件未命中：尝试目录语义（index.html 命中 → 按请求形态直出或 301 补斜杠；目录存在但无 index.html → 404）
      const dirResult = await this.tryDirectoryRedirect(
        slug,
        site.siteId,
        site.rootFolderId,
        target,
        normalized,
        hasTrailingSlash,
        res,
      )
      if (dirResult === 'redirected') {
        return
      }
      if (!dirResult.found) {
        // P7 D77/R78（路径美化）：无扩展名路径再走回退链 —— x.html → 站点 SPA 回退入口；都无 → 404
        const fallback = await this.tryPrettyFallback(
          site.siteId,
          site.rootFolderId,
          normalized,
          site.spaFallback,
        )
        if (!fallback.found) {
          throw new BusinessException(ErrorCode.NotFound, '资源不存在')
        }
        resolved = fallback
      } else {
        resolved = dirResult
      }
    }

    // 5~10. 统一出流（P19 T162 抽出：legacy 轨与快照轨共用同一套安全头 / ETag / Range / 超时逻辑，
    //       避免两条轨的头漂移——安全件只写一遍）
    await this.sendFile(
      async (range) => {
        const meta = await this.cloudFacade.getPublicStream(BigInt(resolved.fileId), range)
        return {
          stream: meta.stream,
          size: Number(meta.size),
          ext: meta.ext,
          name: meta.name,
          mtime: meta.updateTime,
        }
      },
      req,
      res,
    )
  }

  /**
   * 统一出流（P19 T162）：MIME 白名单 + CSP 沙箱 + ETag/304 + Range/416 + 空闲超时 + 流式。
   *
   * `load` 负责「按区间取元数据与流」——legacy 轨读云盘、快照轨读 site-releases，
   * 两条轨只在取流来源上不同，**响应头与安全语义完全同源**。
   *
   * Cache-Control 维持 D28/P4b 口径：白名单统一 `no-cache`（ETag/304 协商），
   * 白名单外 `no-store`（P19 未改缓存策略，长缓存挂 Phase2）。
   */
  private async sendFile(
    load: (range?: { start: number; end: number }) => Promise<ServeFileMeta>,
    req: Request,
    res: Response,
  ): Promise<void> {
    const meta = await load()
    const size = meta.size
    const rangeResult = req.headers.range ? this.parseRange(req.headers.range, size) : null
    if (rangeResult === 'unsatisfiable') {
      res.status(416).set('Content-Range', `bytes */${size}`).end()
      return
    }
    // 命中 Range 时按区间重新取流（避免全量读盘）
    const rangeParsed = rangeResult ?? null
    const file = rangeParsed ? await load({ start: rangeParsed.start, end: rangeParsed.end }) : meta

    const mime = resolveMime(file.ext)
    const etag = `W/"${file.size}-${file.mtime.getTime()}"`
    if (req.headers['if-none-match'] === etag) {
      res.status(304).set('ETag', etag).end()
      return
    }

    res.set({
      ETag: etag,
      'Last-Modified': file.mtime.toUTCString(),
      'Cache-Control': mime.whitelisted ? 'no-cache' : 'no-store',
      'Content-Type': mime.contentType,
      'X-Content-Type-Options': 'nosniff',
    })
    if (mime.sandbox) {
      res.set('Content-Security-Policy', CSP_SANDBOX)
    }
    if (mime.attachment) {
      // filename 走 ASCII 兜底 + filename*（UTF-8 原名）：中文名直接进 quoted-string 会让 Node 抛
      // ERR_INVALID_CHAR（500 → 下载变白页，2026-09-12 与云盘 pack 同批修复），口径同 cloud 域四处单文件下载
      res.set(
        'Content-Disposition',
        `attachment; filename="${this.asciiFallback(file.name)}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      )
    }

    // socket 空闲超时（res.setTimeout 仅针对本响应：无数据流动 30s 触发；响应 finish 自动清除，
    // 不影响 keep-alive 连接复用；防慢连接占 fd，活跃流不受影响）
    res.setTimeout(SOCKET_IDLE_TIMEOUT_MS, () => {
      this.logger.warn(`开放静态连接空闲超时，强制关闭：${req.path}`)
      res.destroy()
    })

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

  /**
   * 展示应用内容出流（**P20 B3**）：内容源与站点树**解耦**——按站点是否已发布选轨。
   *
   * - 已发布 → **快照轨**：发布时已把展示应用工作区聚合进 `快照/disp/{id}/`（B2），此处只换解析根；
   * - 未发布 → **工作区轨**：直读 `{display.stagingPath}/{userId}/{displayId}/`（管理态实时语义）。
   *
   * 对外 URL 恒为 `/api/open/{slug}/disp/{id}/**`（两轨下都不变，契约冻结）。
   * 挂靠校验沿用 `DisplayFacade.resolveForOpen`（存在 / 未软删 / 挂靠本站点，任一不满足 40400）。
   */
  private async serveDisplay(
    slug: string,
    rawId: string,
    subPath: string,
    req: Request,
    res: Response,
  ): Promise<void> {
    await assertRateLimit(
      this.redis,
      'static',
      extractIp(req),
      this.config.get<number>('site.siteOpenStaticRateLimit', 120),
    )
    const site = await this.resolveService.resolveSite(slug)
    if (!site) throw new BusinessException(ErrorCode.NotFound, '站点不存在')
    if (!/^\d{1,20}$/.test(rawId)) throw new BusinessException(ErrorCode.NotFound, '资源不存在')

    const meta = await this.displayFacade.resolveForOpen(BigInt(site.siteId), BigInt(rawId))
    const rel = subPath ? `${meta.relPath}/${subPath}` : `${meta.relPath}/index.html`

    if (site.activeReleaseId) {
      const dir = this.releaseTrack.dirOf(site.siteId, site.activeReleaseId)
      const hit = await this.releaseTrack.resolve(dir, rel, site.spaFallback)
      if (!hit) throw new BusinessException(ErrorCode.NotFound, '资源不存在')
      await this.sendFile(
        async (range) => ({
          stream: this.releaseTrack.stream(dir, hit.relPath, range),
          size: hit.size,
          ext: hit.ext,
          name: hit.relPath.split('/').pop() ?? 'index.html',
          mtime: hit.mtime,
        }),
        req,
        res,
      )
      return
    }

    const workRoot = this.config.get<string>('display.stagingPath', 'disp-staging')
    const workDirId = await this.cloudFacade.resolveUserDirId(
      BigInt(site.userId),
      `${workRoot}/${site.userId}/${rawId}`,
    )
    if (workDirId === null) throw new BusinessException(ErrorCode.NotFound, '资源不存在')
    const file = await this.cloudFacade.resolveOwnTreePath(workDirId, subPath || 'index.html')
    if (!file || file.isDir === 1) throw new BusinessException(ErrorCode.NotFound, '资源不存在')
    await this.sendFile(
      async (range) => {
        const streamed = await this.cloudFacade.getPublicStream(file.id, range)
        return {
          stream: streamed.stream,
          size: Number(streamed.size),
          ext: streamed.ext,
          name: streamed.name,
          mtime: streamed.updateTime,
        }
      },
      req,
      res,
    )
  }

  /**
   * 快照轨出流（P19 T162 / D144 / R161）：站点已有当前版本 → 从不可变快照
   * `site-releases/{siteId}/{releaseId}/` 读，**不查云盘、不消费 `is_public`**。
   *
   * 回退链（真实文件 → `.html` → 目录 `index.html` → `spaFallback`）与安全件与 legacy 轨**完全一致**；
   * `disp/` 展示应用托管链不经此轨（独立授权链，`displayIndex`/`displayStatic` 显式走 legacy）。
   */
  private async serveFromRelease(
    site: ResolvedSite,
    rawPath: string,
    req: Request,
    res: Response,
  ): Promise<void> {
    const releaseId = site.activeReleaseId
    if (!releaseId) throw new BusinessException(ErrorCode.NotFound, '资源不存在')
    const dir = this.releaseTrack.dirOf(site.siteId, releaseId)
    const hit = await this.releaseTrack.resolve(dir, rawPath, site.spaFallback)
    if (!hit) throw new BusinessException(ErrorCode.NotFound, '资源不存在')
    await this.sendFile(
      async (range) => ({
        stream: this.releaseTrack.stream(dir, hit.relPath, range),
        size: hit.size,
        ext: hit.ext,
        name: hit.relPath.split('/').pop() ?? 'index.html',
        mtime: hit.mtime,
      }),
      req,
      res,
    )
  }

  /**
   * 路径美化回退（P7 D77/R78）：无扩展名路径（如 /article/42、/about）依次尝试
   *   ① `{path}.html` ② 站点 SPA 回退入口（site_site.spa_fallback，默认模板为 index.html）；
   * 带扩展名的请求不参与回退（保持"文件不存在即 404"的既有语义，避免掩盖真实缺失）。
   * 目录语义（`{path}/index.html`）已在 tryDirectoryRedirect 先行覆盖。
   */
  private async tryPrettyFallback(
    siteId: string,
    rootFolderId: string,
    normalized: string,
    spaFallback: string | null,
  ): Promise<ResolvedPath> {
    const lastSegment = normalized.split('/').pop() ?? ''
    if (/\.[A-Za-z0-9]{1,8}$/.test(lastSegment)) return { found: false }
    const candidates = [`${normalized}.html`]
    if (spaFallback) candidates.push(spaFallback)
    for (const candidate of candidates) {
      const r = await this.resolveService.resolvePath(siteId, rootFolderId, candidate)
      if (r.found) return r
    }
    return { found: false }
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
    slug: string,
    siteId: string,
    rootFolderId: string,
    target: string,
    normalized: string,
    hasTrailingSlash: boolean,
    res: Response,
  ): Promise<ResolvedPath | 'redirected'> {
    // 目录下 index.html 命中：请求带斜杠 → 直出（基址正确）；无斜杠 → 301 补斜杠（修正相对引用基址，
    // Location 必须带挂载点前缀 /api/open/{slug}，否则浏览器会跟随到不存在的根路径，2026-08-29 修复）
    const asDirIndex = `${normalized}/index.html`
    if (asDirIndex !== target) {
      const r = await this.resolveService.resolvePath(siteId, rootFolderId, asDirIndex)
      if (r.found) {
        if (hasTrailingSlash) return r
        res.status(301).set('Location', `/api/open/${slug}/${normalized}/`).end()
        return 'redirected'
      }
    }
    // 目录本身存在（但目录下无 index.html）→ 40400（nginx 无 autoindex 语义；
    // 若 301 补斜杠，Location 与请求 URL 相同会造成无限重定向循环，2026-08-29 修复）
    const dirResolved = await this.cloudFacade.resolvePublicPath(BigInt(rootFolderId), normalized)
    if (dirResolved && dirResolved.isDir === 1) {
      throw new BusinessException(ErrorCode.NotFound, '资源不存在')
    }
    return { found: false }
  }

  /** filename 的 ASCII 兜底（quoted-string 内的非 ASCII/引号/反斜杠一律替换，照 T27 口径） */
  private asciiFallback(name: string): string {
    const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
    return ascii || 'file'
  }

  /** 解析单区间 Range（bytes=start-end / start- / -suffix），与 P3 transfer 口径一致 */
  private parseRange(
    header: string,
    size: number,
  ): { start: number; end: number } | 'unsatisfiable' | null {
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
