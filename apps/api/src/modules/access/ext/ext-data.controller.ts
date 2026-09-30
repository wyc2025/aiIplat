import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger'
import type { Response } from 'express'
import { ErrorCode } from '../../../common/constants/error-code'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { Public } from '../../../gateway/decorators/public.decorator'
import { SkipTransform } from '../../../gateway/decorators/skip-transform.decorator'
import { AppFacade } from '../../app/facade/app-facade.service'
import { AuditInterceptor } from '../audit/audit.interceptor'
import type { CredentialPrincipal } from '../credential/credential.service'
import { QuotaInterceptor } from '../quota/quota.interceptor'
import { CredentialUnauthorizedException, ExtAuthGuard, type ExtRequest } from './ext-auth.guard'
import { ExtContractService } from './ext-contract.service'

/** socket 空闲超时（与开放静态/取数层同口径） */
const SOCKET_IDLE_TIMEOUT_MS = 30_000

/**
 * 对外取数端点（P15 T135，API-P15 §2 / ARCHITECTURE-P15 §4）。
 *
 * 认证：`Authorization: Bearer {keyId}.{secret}`（`ExtAuthGuard` → `request.principal`）。
 * **校验链（R132）**：① 凭证（缺失/无效/吊销/过期 → HTTP 401 + 50019 + `WWW-Authenticate`，守卫完成）
 * → ② `appCode` 与凭证绑定的 `app_id` 匹配（否 40400）→ ③ 应用未软删且 `is_public=1`（否 40400）
 * → ④ 表 ∈ `scope ∩ 暴露`（否 40400；schema 对越权表不输出、不报错）→ ⑤ 配额（T136）
 * → ⑥ 参数（40001）。
 *
 * **契约冻结（D124）**：响应经 `ExtContractService` 改写为 v1 形态（envelope 独立、游标分页、
 * 无 `total`／无 `pageNo`），**不直接透传内部响应形状**；HTTP 状态码语义真实化 —— 401（凭证）/
 * 429（配额）/ 200（成功与业务失败：40400 / 40001 仍走统一体，与平台其余开放面一致）。
 *
 * **单一管道（铁律 5/R139）**：取数全量经 `AppFacade`（内部仍走 `DataService.queryForPublic`），
 * 本域不直读 app 域任何表。
 */
@ApiTags('对外开放-取数（v1）')
@ApiBearerAuth()
@Controller('ext/v1/app')
@UseGuards(ExtAuthGuard)
// 执行顺序：守卫（凭证 401，自行留痕）→ 审计（最外层，覆盖 429/40400 等负例）→ 配额（429 预检）→ handler
@UseInterceptors(AuditInterceptor, QuotaInterceptor)
export class ExtDataController {
  constructor(
    private readonly appFacade: AppFacade,
    private readonly contract: ExtContractService,
  ) {}

  @Public()
  @SkipTransform()
  @Get(':appCode/schema')
  @ApiParam({ name: 'appCode', description: '数据应用 code（须与凭证绑定应用一致）' })
  @ApiOperation({ summary: '暴露表结构（scope ∩ 暴露三开关投影；越权表不出现在结果中）' })
  async schema(
    @Param('appCode') appCode: string,
    @Req() req: ExtRequest,
    @Res() res: Response,
  ): Promise<void> {
    const principal = await this.resolvePrincipal(appCode, req)
    const payload = await this.appFacade.publicSchema(principal.ownerId, principal.appCode)
    this.markAudit(res, 'schema', null, 0, null)
    this.send(res, this.contract.projectSchema(payload, principal.scope))
  }

  @Public()
  @SkipTransform()
  @Get(':appCode/tables/:table/records')
  @ApiParam({ name: 'table', description: '逻辑表名（须 ∈ scope 且已暴露）' })
  @ApiOperation({
    summary:
      '列表（游标分页：size≤50 / after / sort≤2 且自动追加 rowId tiebreaker；无 pageNo/offset）',
  })
  async records(
    @Param('appCode') appCode: string,
    @Param('table') table: string,
    @Query() query: Record<string, unknown>,
    @Req() req: ExtRequest,
    @Res() res: Response,
  ): Promise<void> {
    const principal = await this.resolvePrincipal(appCode, req)
    this.contract.assertTableInScope(table, principal.scope)
    const size = this.contract.resolveSize(query.size)
    const { rows, sort } = await this.appFacade.publicListAll(
      principal.ownerId,
      principal.appCode,
      table,
      query,
    )
    const { keys, signature } = this.contract.resolveSort(sort)
    const cursor = this.contract.decodeCursor(this.str(query.after), signature)
    const page = this.contract.paginate(rows, keys, signature, cursor, size)
    this.markAudit(res, 'records', table, page.data.length, this.summarize(query))
    res.status(200).json({
      code: 0,
      message: 'success',
      data: page.data.map((row) => this.contract.projectRow(row, table, principal.scope)),
      paging: { nextCursor: page.nextCursor, size },
    })
  }

  @Public()
  @SkipTransform()
  @Get(':appCode/tables/:table/records/:rowId')
  @ApiParam({ name: 'rowId', description: '行 rowId' })
  @ApiOperation({ summary: '单行详情（行不存在 → 40400；支持 expand）' })
  async detail(
    @Param('appCode') appCode: string,
    @Param('table') table: string,
    @Param('rowId') rowId: string,
    @Query() query: Record<string, unknown>,
    @Req() req: ExtRequest,
    @Res() res: Response,
  ): Promise<void> {
    const principal = await this.resolvePrincipal(appCode, req)
    this.contract.assertTableInScope(table, principal.scope)
    const detail = await this.appFacade.publicDetail(
      principal.ownerId,
      principal.appCode,
      table,
      rowId,
      query,
    )
    this.markAudit(res, 'detail', table, 1, this.summarize(query))
    // 内部 detail 形状为 `{ op, row }`（取数执行器语义），对外契约只出 `row`
    this.send(res, this.contract.projectRow(detail.row, table, principal.scope))
  }

  @Public()
  @SkipTransform()
  @Get(':appCode/files/:fileId/stream')
  @ApiParam({ name: 'fileId', description: '云盘文件 id（须被应用数据引用且字段已暴露）' })
  @ApiOperation({ summary: '附件流（inline + Range；?download=1 → attachment + 原名；R26 MIME）' })
  async file(
    @Param('appCode') appCode: string,
    @Param('fileId') fileId: string,
    @Query('download') download: string | undefined,
    @Req() req: ExtRequest,
    @Res() res: Response,
  ): Promise<void> {
    const principal = await this.resolvePrincipal(appCode, req)
    this.markAudit(res, 'file', null, 0, null)
    await this.serveStream(principal, fileId, download === '1' || download === 'true', req, res)
  }

  // ==================== 内部 ====================

  /**
   * R132 第 2~3 步：`appCode` 与凭证绑定应用一致性 + 应用未软删且 `is_public=1`。
   * 任一不满足 → **40400**（资源层不暴露存在性；凭证错误才走 401）。
   */
  private async resolvePrincipal(
    appCode: string,
    req: ExtRequest,
  ): Promise<CredentialPrincipal & { appCode: string }> {
    const principal = req.principal
    if (!principal) {
      // 守卫必然已塞入主体；防御性兜底（不应发生，仍给 401 而非 500）
      throw new CredentialUnauthorizedException('凭证缺失')
    }
    const apps = await this.appFacade.appBriefByIds(principal.ownerId, [principal.appId])
    const app = apps.find((item) => item.id === principal.appId.toString())
    if (!app || app.code !== appCode || app.isPublic !== 1) {
      throw new BusinessException(ErrorCode.NotFound, '资源不存在')
    }
    return { ...principal, appCode: app.code }
  }

  /** 统一成功体（v1 envelope：data + 可选 paging） */
  private send(res: Response, data: unknown): void {
    res.status(200).json({ code: 0, message: 'success', data })
  }

  /**
   * 登记审计上下文（只报告事实：endpoint / 表名 / 返回行数 / 参数摘要）——
   * 记账由 `AuditInterceptor` 与 `QuotaInterceptor` 集中完成（R141，禁止各端点自行实现）。
   */
  private markAudit(
    res: Response,
    endpoint: string,
    tableName: string | null,
    rows: number,
    paramsSummary: string | null,
  ): void {
    res.locals.extAudit = { endpoint, tableName, rows, paramsSummary }
  }

  /** 参数摘要（≤512 字符由审计服务兜底截断；不含返回内容） */
  private summarize(query: Record<string, unknown> | null): string | null {
    if (!query) return null
    const parts = Object.entries(query)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(',') : String(value)}`)
    return parts.length > 0 ? parts.join('&') : null
  }

  /**
   * 附件流输出（HTTP 语义与开放层取数面一致：ETag/304 → Range(206/416) → 管道输出）。
   * 对外契约层自有实现，不复用 site 域私有方法（D124：对外形状不依赖内部实现）。
   */
  private async serveStream(
    principal: CredentialPrincipal & { appCode: string },
    fileId: string,
    download: boolean,
    req: ExtRequest,
    res: Response,
  ): Promise<void> {
    const meta = await this.appFacade.publicAttachment(
      principal.ownerId,
      principal.appCode,
      fileId,
    )
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
      'Accept-Ranges': 'bytes',
      'Content-Disposition': `${disposition}; filename="${this.asciiFallback(meta.name)}"; filename*=UTF-8''${encodeURIComponent(meta.name)}`,
    })
    res.setTimeout(SOCKET_IDLE_TIMEOUT_MS, () => {
      res.destroy()
    })

    const stream = parsed
      ? (
          await this.appFacade.publicAttachment(principal.ownerId, principal.appCode, fileId, {
            start: parsed.start,
            end: parsed.end,
          })
        ).stream
      : meta.stream
    if (parsed) {
      res.status(206).set({
        'Content-Range': `bytes ${parsed.start}-${parsed.end}/${size}`,
        'Content-Length': String(parsed.end - parsed.start + 1),
      })
    } else {
      res.status(200).set({ 'Content-Length': String(size) })
    }
    stream.pipe(res)
  }

  /** 查询参数取字符串（缺省空串） */
  private str(value: unknown): string {
    if (typeof value === 'string') return value
    if (value === undefined || value === null) return ''
    return String(value)
  }

  /** Range 解析（bytes=start-end / start- / -suffix；非法语法忽略 → 200 全量；越界 416） */
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

  /** filename 的 ASCII 兜底（quoted-string 内非 ASCII/引号/反斜杠替换，口径同平台四处单文件下载） */
  private asciiFallback(name: string): string {
    const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
    return ascii || 'file'
  }
}
