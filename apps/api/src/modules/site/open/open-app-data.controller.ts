import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger'
import type { Request, Response } from 'express'
import { ErrorCode } from '../../../common/constants/error-code'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { RedisService } from '../../../infra/redis/redis.service'
import { Public } from '../../../gateway/decorators/public.decorator'
import { SkipTransform } from '../../../gateway/decorators/skip-transform.decorator'
import { AppFacade } from '../../app/facade/app-facade.service'
import { DisplayFacade } from '../../display/facade/display-facade.service'
import { SiteResolveService } from './site-resolve.service'
import { assertRateLimit, extractIp } from './rate-limit.util'

/** socket 空闲超时（口径同开放静态层） */
const SOCKET_IDLE_TIMEOUT_MS = 30_000

/**
 * 授权取数面端点（P14 T125，API §21.1-8~11 / ARCHITECTURE §30.4）。
 *
 * 取代退役的匿名公开面（`/api/pub/app/{pubCode}/**`，D115）：**站点展示页**经同源相对路径取数，
 * 服务端按 R125 校验链（① 站点存在 → ② 站点下挂靠展示应用被授予该数据应用 → ③ `is_public=1`
 * 总开关 → ④ 表·字段暴露三开关）逐级放行，任一不满足统一 **40400**（不区分原因，防探测口径沿用）；
 * 参数越界 **40001**、超限 **42900** 为例外。
 *
 * 路由注册顺序（铁律）：本控制器必须排在同前缀的 `OpenStaticController`（`:slug/*path` 通配）**之前**。
 */
@ApiTags('个人网站-开放取数')
@Controller('open')
export class OpenAppDataController {
  constructor(
    private readonly resolveService: SiteResolveService,
    private readonly displayFacade: DisplayFacade,
    private readonly appFacade: AppFacade,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Get(':slug/api/app/:appCode/schema')
  @ApiParam({ name: 'slug', description: '站点 slug' })
  @ApiParam({ name: 'appCode', description: '数据应用 code（须已被该站点下展示应用授权）' })
  @ApiOperation({ summary: '暴露表结构（R125 校验链；未授权/未公开/未挂靠/未暴露一律 40400）' })
  async appSchema(
    @Param('slug') slug: string,
    @Param('appCode') appCode: string,
    @Req() req: Request,
  ) {
    await this.rateLimit(req)
    const ctx = await this.assertGranted(slug, appCode)
    return this.appFacade.publicSchema(ctx.ownerId, ctx.appCode)
  }

  @Public()
  @Get(':slug/api/app/:appCode/tables/:table/records')
  @ApiParam({ name: 'table', description: '逻辑表名（须已暴露）' })
  @ApiOperation({
    summary: '列表（R104 固定口径：size≤50 / sort≤2 / filter≤3 / expand≤1 层；越界 40001）',
  })
  async appList(
    @Param('slug') slug: string,
    @Param('appCode') appCode: string,
    @Param('table') table: string,
    @Query() query: Record<string, unknown>,
    @Req() req: Request,
  ) {
    await this.rateLimit(req)
    const ctx = await this.assertGranted(slug, appCode)
    return this.appFacade.publicList(ctx.ownerId, ctx.appCode, table, query)
  }

  @Public()
  @Get(':slug/api/app/:appCode/tables/:table/records/:rowId')
  @ApiParam({ name: 'rowId', description: '行 rowId' })
  @ApiOperation({ summary: '单行详情（行不存在 → 40400；支持 expand）' })
  async appDetail(
    @Param('slug') slug: string,
    @Param('appCode') appCode: string,
    @Param('table') table: string,
    @Param('rowId') rowId: string,
    @Query() query: Record<string, unknown>,
    @Req() req: Request,
  ) {
    await this.rateLimit(req)
    const ctx = await this.assertGranted(slug, appCode)
    return this.appFacade.publicDetail(ctx.ownerId, ctx.appCode, table, rowId, query)
  }

  @Public()
  @SkipTransform()
  @Get(':slug/api/app/:appCode/files/:fileId/stream')
  @ApiParam({ name: 'fileId', description: '云盘文件 id（须被应用数据引用且字段已暴露）' })
  @ApiOperation({ summary: '附件流（inline + Range；?download=1 → attachment + 原名；R26 MIME）' })
  async appFile(
    @Param('slug') slug: string,
    @Param('appCode') appCode: string,
    @Param('fileId') fileId: string,
    @Query('download') download: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.rateLimit(req)
    const ctx = await this.assertGranted(slug, appCode)
    await this.serveAttachment(ctx.ownerId, ctx.appCode, fileId, req, res, download === '1' || download === 'true')
  }

  // ==================== 内部 ====================

  /**
   * R125 校验链前两级（后两级在 app 域取数方法内）：
   * ① 站点存在（slug 解析，停用/不存在 → 40400）；③ `is_public=1` 总开关（resolveGrantedApp 内校验）；
   * ② 该站点下存在挂靠展示应用被授予此数据应用（DisplayFacade.assertCanRead）。
   * 站点属主即数据应用属主（授权两跳均在本站点属主名下）。
   */
  private async assertGranted(
    slug: string,
    appCode: string,
  ): Promise<{ ownerId: bigint; appCode: string }> {
    const site = await this.resolveService.resolveSite(slug)
    if (!site) {
      throw new BusinessException(ErrorCode.NotFound, '资源不存在')
    }
    const ownerId = BigInt(site.userId)
    const app = await this.appFacade.resolveGrantedApp(ownerId, appCode)
    await this.displayFacade.assertCanRead(BigInt(app.appId), BigInt(site.siteId))
    return { ownerId, appCode: app.appCode }
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
