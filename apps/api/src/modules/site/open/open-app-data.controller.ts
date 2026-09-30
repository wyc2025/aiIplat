import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger'
import type { Request, Response } from 'express'
import { ErrorCode } from '../../../common/constants/error-code'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { RedisService } from '../../../infra/redis/redis.service'
import { Public } from '../../../gateway/decorators/public.decorator'
import { SkipTransform } from '../../../gateway/decorators/skip-transform.decorator'
import { AccessFacade } from '../../access/facade/access-facade.service'
import { AppFacade } from '../../app/facade/app-facade.service'
import { DisplayFacade } from '../../display/facade/display-facade.service'
import { SiteResolveService } from './site-resolve.service'
import { assertRateLimit, extractIp } from './rate-limit.util'

/** socket 空闲超时（口径同开放静态层） */
const SOCKET_IDLE_TIMEOUT_MS = 30_000

/** 校验链通过后的取数上下文（站点属主 / 应用标识 / 主体 displayId） */
interface GrantedContext {
  ownerId: bigint
  appCode: string
  displayId: string
  appId: string
}

/**
 * 授权取数面端点（P14 T125 建 → P15 T133 路径收窄，API-P15 §4 / ARCHITECTURE-P15 §6）。
 *
 * 取代退役的匿名公开面（`/api/pub/app/{pubCode}/**`，D115）：**展示应用页面**经同源相对路径
 * `./api/app/{appCode}/...` 取数（页面位于 `disp/{id}/` 下，天然同源），服务端按 R125 修订版校验链
 * （① 站点存在 → ② 展示应用存在、未软删且挂靠本站点 → ③ 该展示应用被授予该数据应用 → ④ `is_public=1`
 * 总开关 → ⑤ 表·字段暴露三开关）逐级放行，任一不满足统一 **40400**（不区分原因，防探测口径沿用）；
 * 参数越界 **40001**、超限 **42900** 为例外。
 *
 * **D123 路径收窄**：旧路径 `:slug/api/app/:appCode/**` 退役 → 现为 `:slug/disp/:id/api/app/:appCode/**`，
 * 判定粒度由「站点级」收窄为「展示应用级」（同站点其他未授权展示应用不再能调）。
 *
 * 路由注册顺序（铁律）：本控制器必须声明在 `OpenStaticController` 的 `:slug/disp/:id/*path` 与
 * `:slug/*path` 通配**之前**（模块 controllers 数组顺序）；静态侧另有 `disp/:id/api/` 子前缀排除双保险。
 */
@ApiTags('个人网站-开放取数')
@Controller('open')
export class OpenAppDataController {
  constructor(
    private readonly resolveService: SiteResolveService,
    private readonly displayFacade: DisplayFacade,
    private readonly appFacade: AppFacade,
    private readonly accessFacade: AccessFacade,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Get(':slug/disp/:id/api/app/:appCode/schema')
  @ApiParam({ name: 'slug', description: '站点 slug' })
  @ApiParam({ name: 'id', description: '展示应用 id（须挂靠该站点，D123）' })
  @ApiParam({ name: 'appCode', description: '数据应用 code（须已被该展示应用授权）' })
  @ApiOperation({ summary: '暴露表结构（R125 修订链；未挂靠/未授权/未公开/未暴露一律 40400）' })
  async appSchema(
    @Param('slug') slug: string,
    @Param('id') id: string,
    @Param('appCode') appCode: string,
    @Req() req: Request,
  ) {
    await this.rateLimit(req)
    return this.audited(
      { req, slug, displayId: id, appCode, endpoint: 'schema', table: null, query: null },
      (ctx) => this.appFacade.publicSchema(ctx.ownerId, ctx.appCode),
      () => 0,
    )
  }

  @Public()
  @Get(':slug/disp/:id/api/app/:appCode/tables/:table/records')
  @ApiParam({ name: 'table', description: '逻辑表名（须已暴露）' })
  @ApiOperation({
    summary: '列表（R104 固定口径：size≤50 / sort≤2 / filter≤3 / expand≤1 层；越界 40001）',
  })
  async appList(
    @Param('slug') slug: string,
    @Param('id') id: string,
    @Param('appCode') appCode: string,
    @Param('table') table: string,
    @Query() query: Record<string, unknown>,
    @Req() req: Request,
  ) {
    await this.rateLimit(req)
    return this.audited(
      { req, slug, displayId: id, appCode, endpoint: 'records', table, query },
      (ctx) => this.appFacade.publicList(ctx.ownerId, ctx.appCode, table, query),
      (payload) => payload.list.length,
    )
  }

  @Public()
  @Get(':slug/disp/:id/api/app/:appCode/tables/:table/records/:rowId')
  @ApiParam({ name: 'rowId', description: '行 rowId' })
  @ApiOperation({ summary: '单行详情（行不存在 → 40400；支持 expand）' })
  async appDetail(
    @Param('slug') slug: string,
    @Param('id') id: string,
    @Param('appCode') appCode: string,
    @Param('table') table: string,
    @Param('rowId') rowId: string,
    @Query() query: Record<string, unknown>,
    @Req() req: Request,
  ) {
    await this.rateLimit(req)
    return this.audited(
      { req, slug, displayId: id, appCode, endpoint: 'detail', table, query },
      (ctx) => this.appFacade.publicDetail(ctx.ownerId, ctx.appCode, table, rowId, query),
      () => 1,
    )
  }

  @Public()
  @SkipTransform()
  @Get(':slug/disp/:id/api/app/:appCode/files/:fileId/stream')
  @ApiParam({ name: 'fileId', description: '云盘文件 id（须被应用数据引用且字段已暴露）' })
  @ApiOperation({ summary: '附件流（inline + Range；?download=1 → attachment + 原名；R26 MIME）' })
  async appFile(
    @Param('slug') slug: string,
    @Param('id') id: string,
    @Param('appCode') appCode: string,
    @Param('fileId') fileId: string,
    @Query('download') download: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.rateLimit(req)
    const asDownload = download === '1' || download === 'true'
    await this.audited(
      {
        req,
        slug,
        displayId: id,
        appCode,
        endpoint: 'file',
        table: null,
        query: { download: asDownload },
      },
      async (ctx) => {
        await this.serveAttachment(ctx.ownerId, ctx.appCode, fileId, req, res, asDownload)
        return null
      },
      () => 0,
    )
  }

  // ==================== 内部 ====================

  /**
   * R125 修订版校验链前几级（`is_public` 与暴露三开关在 app 域取数方法内）：
   * ① 站点存在（slug 解析，停用/不存在 → 40400）；
   * ② 展示应用存在、未软删且挂靠本站点（`DisplayFacade.resolveForOpen`，D123 收窄）；
   * ③ 该展示应用被授予此数据应用（`DisplayFacade.assertCanRead`，主体化判定 R138）；
   * ④ `is_public=1` 总开关（`resolveGrantedApp` 内校验）。
   * 站点属主即数据应用属主（授权两跳均在本站点属主名下）。
   */
  private async assertGranted(
    slug: string,
    rawDisplayId: string,
    appCode: string,
  ): Promise<GrantedContext> {
    const site = await this.resolveService.resolveSite(slug)
    if (!site) {
      throw new BusinessException(ErrorCode.NotFound, '资源不存在')
    }
    if (!/^\d{1,20}$/.test(rawDisplayId)) {
      throw new BusinessException(ErrorCode.NotFound, '资源不存在')
    }
    const displayId = BigInt(rawDisplayId)
    // ② 挂靠校验：展示应用存在、未软删、site_id = 本站点（未挂靠/挂他站/已删 → 40400）
    await this.displayFacade.resolveForOpen(BigInt(site.siteId), displayId)
    const ownerId = BigInt(site.userId)
    const app = await this.appFacade.resolveGrantedApp(ownerId, appCode)
    // ③ 授权命中：该展示应用（而非站点下任一展示应用）被授予此数据应用
    await this.displayFacade.assertCanRead(BigInt(app.appId), { type: 'display', displayId })
    return { ownerId, appCode: app.appCode, displayId: displayId.toString(), appId: app.appId }
  }

  /**
   * 匿名层取数埋点包装（P15 T136 / R135）：成功与**负例**都记一条（`principal = display:{id}`）。
   *
   * 站点解析失败时无法确定属主 → 不记（ARCHITECTURE-P15 §5 注明口径）；
   * 记账统一经 `AccessFacade.writeAudit`（site 域对 access 域的唯一依赖，铁律 3 / R141），异步不阻断取数。
   */
  private async audited<T>(
    params: {
      req: Request
      slug: string
      displayId: string
      appCode: string
      endpoint: string
      table: string | null
      query: Record<string, unknown> | null
    },
    run: (ctx: GrantedContext) => Promise<T>,
    rowsOf: (payload: T) => number,
  ): Promise<T> {
    const started = Date.now()
    let ctx: GrantedContext | null = null
    let rows = 0
    let resultCode = 0
    try {
      ctx = await this.assertGranted(params.slug, params.displayId, params.appCode)
      const payload = await run(ctx)
      rows = rowsOf(payload)
      return payload
    } catch (error) {
      // 限流 42900 / 未授权 40400 / 参数 40001 等负例同样留痕（resultCode 如实记录）
      resultCode = error instanceof BusinessException ? error.code : ErrorCode.InternalError
      throw error
    } finally {
      if (ctx) {
        this.accessFacade.writeAudit({
          principal: `display:${params.displayId}`,
          ownerId: ctx.ownerId,
          appId: BigInt(ctx.appId),
          endpoint: params.endpoint,
          tableName: params.table,
          paramsSummary: this.summarize(params.query),
          rows,
          durationMs: Date.now() - started,
          ip: extractIp(params.req),
          resultCode,
        })
      }
    }
  }

  /** 参数摘要（≤512 字符由审计服务兜底截断；不含返回内容） */
  private summarize(query: Record<string, unknown> | null): string | null {
    if (!query) return null
    const parts = Object.entries(query)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(',') : String(value)}`)
    return parts.length > 0 ? parts.join('&') : null
  }

  /** 取数面独立限流（R106 口径：60 次/分/IP → 42900；与静态桶分离） */
  private async rateLimit(req: Request): Promise<void> {
    await assertRateLimit(
      this.redis,
      'appdata',
      extractIp(req),
      this.config.get<number>('site.siteOpenAppDataRateLimit', 60),
    )
  }

  /**
   * 附件流输出（照开放静态/公开面口径）：MIME 判定与应用侧三道闸（引用索引 / 表·字段暴露）
   * 均在 app 域内完成（`AppFacade.publicAttachment` 返回 contentType 与 inline 标记）；
   * 本层只做 HTTP 语义：ETag/304 → Range（206/416）→ 管道输出。
   */
  private async serveAttachment(
    ownerId: bigint,
    appCode: string,
    fileId: string,
    req: Request,
    res: Response,
    download: boolean,
  ): Promise<void> {
    const meta = await this.appFacade.publicAttachment(ownerId, appCode, fileId)
    const size = Number(meta.size)
    const disposition = download || !meta.inline ? 'attachment' : 'inline'
    const contentType = download ? 'application/octet-stream' : meta.contentType

    const etag = `W/"${meta.size.toString()}-${meta.updateTime.getTime()}"`
    if (req.headers['if-none-match'] === etag) {
      meta.stream.destroy()
      res.status(304).set('ETag', etag).end()
      return
    }

    const parsed = req.headers.range ? this.parseRange(req.headers.range, size) : null
    if (parsed === 'unsatisfiable') {
      meta.stream.destroy()
      res.status(416).set('Content-Range', `bytes */${size}`).end()
      return
    }
    if (parsed) meta.stream.destroy()

    res.set({
      ETag: etag,
      'Last-Modified': meta.updateTime.toUTCString(),
      'Cache-Control': 'no-cache',
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `${disposition}; filename="${this.asciiFallback(meta.name)}"; filename*=UTF-8''${encodeURIComponent(meta.name)}`,
    })
    res.setTimeout(SOCKET_IDLE_TIMEOUT_MS, () => {
      res.destroy()
    })

    const stream = parsed
      ? (
          await this.appFacade.publicAttachment(ownerId, appCode, fileId, {
            start: parsed.start,
            end: parsed.end,
          })
        ).stream
      : meta.stream
    if (parsed) {
      res.status(206).set({
        'Accept-Ranges': 'bytes',
        'Content-Range': `bytes ${parsed.start}-${parsed.end}/${size}`,
        'Content-Length': String(parsed.end - parsed.start + 1),
      })
    } else {
      res.status(200).set({ 'Accept-Ranges': 'bytes', 'Content-Length': String(size) })
    }
    stream.pipe(res)
  }

  /** Range 解析（bytes=start-end / start- / -suffix；语法非法忽略 → 200 全量；越界 416） */
  private parseRange(
    header: string,
    size: number,
  ): { start: number; end: number } | 'unsatisfiable' | null {
    if (size === 0) return 'unsatisfiable'
    const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
    if (!match) return null
    const [, startRaw, endRaw] = match
    if (startRaw === '' && endRaw === '') return null
    let start: number
    let end: number
    if (startRaw === '') {
      const suffix = Number(endRaw)
      if (!Number.isFinite(suffix) || suffix <= 0) return null
      start = Math.max(0, size - suffix)
      end = size - 1
    } else {
      start = Number(startRaw)
      end = endRaw === '' ? size - 1 : Number(endRaw)
    }
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null
    if (start > end || start >= size) return 'unsatisfiable'
    return { start, end: Math.min(end, size - 1) }
  }

  /** Content-Disposition 文件名 ASCII 兜底（防 quoted-string 注入，照 T27 口径） */
  private asciiFallback(name: string): string {
    const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
    return ascii || 'file'
  }
}
