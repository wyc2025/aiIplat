import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common'
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger'
import type { Request, Response } from 'express'
import { Public } from '../../../gateway/decorators/public.decorator'
import { SkipTransform } from '../../../gateway/decorators/skip-transform.decorator'
import { PubDataService } from './pub-data.service'
import { resolveAppPubMime } from './pub-mime'

/** socket 空闲超时（照开放层口径） */
const SOCKET_IDLE_TIMEOUT_MS = 30_000

/**
 * 数据应用公开访问端点（P12 T112，API §19.2 / ARCHITECTURE §28.1）。
 *
 * 前缀 `/api/pub/app/{pubCode}/**`：与 cloud 的 `/api/pub/f|d/{token}` 同前缀、不同**静态段**
 * （f / d / app），顶层无参数段 → 零路由歧义（P4e 遗留 14 教训）。
 * 开放层纪律：@Public 免登录、独立限流 60 次/分/IP（42900）、
 * **资源类失败统一 40400** 防探测（参数越界 40001 为例外）、禁挂 @OperationLog。
 */
@ApiTags('应用平台-公开访问')
@Controller('pub/app')
export class PubAppController {
  constructor(private readonly pubData: PubDataService) {}

  @Public()
  @Get(':pubCode')
  @ApiParam({ name: 'pubCode', description: '应用公开凭证（12 位随机串）' })
  @ApiOperation({ summary: '公开 manifest（应用名 + 公开展示页清单；不存在/未公开 → 40400）' })
  async manifest(@Param('pubCode') pubCode: string, @Req() req: Request) {
    await this.pubData.assertRateLimit(this.extractIp(req))
    return this.pubData.manifest(pubCode)
  }

  @Public()
  @Get(':pubCode/pages/:pageCode/schema')
  @ApiParam({ name: 'pubCode', description: '应用公开凭证' })
  @ApiParam({ name: 'pageCode', description: '展示页 code' })
  @ApiOperation({ summary: '公开展示页 schema（页不存在/未公开 → 40400）' })
  async pageSchema(
    @Param('pubCode') pubCode: string,
    @Param('pageCode') pageCode: string,
    @Req() req: Request,
  ) {
    await this.pubData.assertRateLimit(this.extractIp(req))
    return this.pubData.pageSchema(pubCode, pageCode)
  }

  @Public()
  @Get(':pubCode/data/:table')
  @ApiParam({ name: 'pubCode', description: '应用公开凭证' })
  @ApiParam({ name: 'table', description: '逻辑表名（须已暴露）' })
  @ApiOperation({
    summary: '公开列表（R104 固定参数：page/size/sort/filter/expand；越界 40001，未暴露 40400）',
  })
  async dataList(
    @Param('pubCode') pubCode: string,
    @Param('table') table: string,
    @Query() query: Record<string, unknown>,
    @Req() req: Request,
  ) {
    await this.pubData.assertRateLimit(this.extractIp(req))
    return this.pubData.listRows(pubCode, table, query)
  }

  @Public()
  @Get(':pubCode/data/:table/:rowId')
  @ApiParam({ name: 'pubCode', description: '应用公开凭证' })
  @ApiParam({ name: 'table', description: '逻辑表名（须已暴露）' })
  @ApiParam({ name: 'rowId', description: '行 rowId' })
  @ApiOperation({ summary: '公开单行（行不存在 → 40400；支持 expand）' })
  async dataDetail(
    @Param('pubCode') pubCode: string,
    @Param('table') table: string,
    @Param('rowId') rowId: string,
    @Query() query: Record<string, unknown>,
    @Req() req: Request,
  ) {
    await this.pubData.assertRateLimit(this.extractIp(req))
    return this.pubData.getRow(pubCode, table, rowId, query)
  }

  @Public()
  @SkipTransform()
  @Get(':pubCode/file/:fileId')
  @ApiParam({ name: 'pubCode', description: '应用公开凭证' })
  @ApiParam({ name: 'fileId', description: '云盘文件 id（须被应用数据引用且字段已暴露）' })
  @ApiOperation({ summary: '公开附件流（inline + Range；?download=1 → attachment + 原名）' })
  async file(
    @Param('pubCode') pubCode: string,
    @Param('fileId') fileId: string,
    @Query('download') download: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.pubData.assertRateLimit(this.extractIp(req))
    await this.serveAttachment(pubCode, fileId, req, res, download === '1' || download === 'true')
  }

  // ==================== 内部 ====================

  /**
   * 附件流输出（照公开层口径）：MIME 白名单（R26）→ ETag/304 → Range（206/416）→ 管道输出。
   * 三道闸（引用索引 / 表·字段暴露 / MIME）中的前两道在 PubDataService.attachmentStream。
   */
  private async serveAttachment(
    pubCode: string,
    fileId: string,
    req: Request,
    res: Response,
    download: boolean,
  ): Promise<void> {
    const meta = await this.pubData.attachmentStream(pubCode, fileId)
    const size = Number(meta.size)

    const resolved = resolveAppPubMime(meta.ext)
    const disposition = download || !resolved.inline ? 'attachment' : 'inline'
    const contentType = download ? 'application/octet-stream' : resolved.contentType

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
      ? (await this.pubData.attachmentStream(pubCode, fileId, { start: parsed.start, end: parsed.end }))
          .stream
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

  /** Range 解析：bytes=start-end / start- / -suffix；语法非法忽略（200 全量）；越界 416 */
  private parseRange(
    header: string,
    size: number,
  ): { start: number; end: number } | 'unsatisfiable' | null {
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

  /** Content-Disposition 文件名 ASCII 兜底（防 quoted-string 注入） */
  private asciiFallback(name: string): string {
    return name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  }

  /** IP 取值：X-Forwarded-For 首段，无该头取 socket 地址（R8 口径） */
  private extractIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for']
    if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim()
    return req.ip ?? ''
  }
}
