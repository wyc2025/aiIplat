import { Body, Controller, Delete, Get, Post, Req, Res, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Response } from 'express'
import { ErrorCode } from '../../../common/constants/error-code'
import { Public } from '../../../gateway/decorators/public.decorator'
import { SkipTransform } from '../../../gateway/decorators/skip-transform.decorator'
import { AuditService } from '../audit/audit.service'
import type { CredentialPrincipal } from '../credential/credential.service'
import { QuotaExceededException } from '../quota/quota.interceptor'
import { QuotaService, type QuotaSnapshot } from '../quota/quota.service'
import {
  CredentialUnauthorizedException,
  ExtAuthGuard,
  type ExtRequest,
} from '../ext/ext-auth.guard'
import { McpServerFactory } from './mcp-server.factory'
import { createRequestContext, toolErrorCode, type McpRequestContext } from './tool-errors'

/** 405 响应体（零新错误码：复用 40001「参数/请求非法」，与平台其余方法不允许口径一致） */
const METHOD_NOT_ALLOWED_MESSAGE = 'MCP 端点仅支持 POST（无状态模式不支持 SSE 流与会话终止）'

/**
 * MCP 端点（P15-C T139/T141，D131/R142/R145 / API §23）。
 *
 * `POST /api/ext/mcp`：Streamable HTTP + JSON-RPC 2.0，**无状态**（每请求独立 server+transport，
 * 响应结束即销毁）；`GET`（SSE 流）/ `DELETE`（会话终止）→ **405**（无状态本就不支持，明确拒绝
 * 优于静默 404 造成客户端误判）。
 *
 * **记账口径（R145）**：每个 POST 计 1 次请求配额（含 `initialize` / `tools/list`，防空握手刷接口）
 * → 行数仅在工具执行后事后记账 → 审计 event `mcp.initialize` / `mcp.tools.list` / `mcp.tools.call`
 * （参数摘要含工具名与入参，**不含响应内容、不含 secret**）。
 *
 * **错误分层（R144）**：认证（守卫 401 + `WWW-Authenticate` + 50019）与配额（429 + `Retry-After`）
 * 在 HTTP 层；工具执行期业务错误在 JSON-RPC 结果内（`isError` + 文本含业务码）。
 */
@ApiTags('对外开放-MCP')
@ApiBearerAuth()
@Controller('ext/mcp')
export class McpController {
  constructor(
    private readonly factory: McpServerFactory,
    private readonly quota: QuotaService,
    private readonly audit: AuditService,
  ) {}

  @Public()
  @SkipTransform()
  // 守卫只挂 POST：GET/DELETE 的 405 是**无条件**的（R142「一律 405」）——
  // 若挂类级，未认证的 GET 会先撞 401，405 永远不可达；且 405 不触任何数据与凭证逻辑，无认证必要。
  @UseGuards(ExtAuthGuard)
  @Post()
  @ApiOperation({
    summary: 'MCP（Streamable HTTP 无状态；JSON-RPC 2.0：initialize/tools/list/tools/call）',
  })
  async handle(@Req() req: ExtRequest, @Res() res: Response, @Body() body: unknown): Promise<void> {
    const principal = req.principal
    if (!principal) {
      // 守卫必然已塞入主体；防御性兜底（不应发生，仍给 401 而非 500）
      throw new CredentialUnauthorizedException('凭证缺失')
    }

    const started = Date.now()
    const ctx = createRequestContext()
    const event = this.eventOf(body, ctx)

    // ① 请求配额预检 + 计数（R145：每个 JSON-RPC POST 计 1）
    const snapshot = await this.quota.checkAndCount(principal.credentialId)
    // 剩余量在成功与超限两种响应上都回带（验收 #6：429 亦须带 X-RateLimit-*，客户端据此判断等待策略）
    this.setRateLimitHeaders(res, snapshot)
    if (snapshot.exceeded) {
      res.set('Retry-After', String(snapshot.retryAfterSeconds))
      this.writeAudit(principal, event, body, ctx, req, started, ErrorCode.TooManyRequests)
      throw new QuotaExceededException(
        `已超配额（请求 ${snapshot.dayUsed}/${snapshot.dayLimit} 次/日、${snapshot.minuteUsed}/${snapshot.minuteLimit} 次/分；` +
          `行数 ${snapshot.rowsUsed}/${snapshot.rowsLimit} 行/日）`,
      )
    }

    // ② 无状态装配 + 处理（响应由 transport 直写；结束后销毁并记账）
    const { server, transport } = await this.factory.create(principal, ctx)
    try {
      await transport.handleRequest(req, res, body)
    } catch (error) {
      ctx.resultCode = toolErrorCode(error)
      throw error
    } finally {
      await server.close().catch(() => undefined)
      void this.quota.addRows(principal.credentialId, ctx.rows)
      this.writeAudit(principal, event, body, ctx, req, started, ctx.resultCode)
    }
  }

  /** `GET`（SSE 流）→ 405（无状态模式不支持服务端推送） */
  @Public()
  @SkipTransform()
  @Get()
  @ApiOperation({ summary: '405：无状态模式不支持 SSE 流（仅 POST）' })
  methodNotAllowed(@Res() res: Response): void {
    this.sendMethodNotAllowed(res)
  }

  /** `DELETE`（会话终止）→ 405（无状态模式无会话可终止） */
  @Public()
  @SkipTransform()
  @Delete()
  @ApiOperation({ summary: '405：无状态模式无会话（仅 POST）' })
  methodNotAllowedForDelete(@Res() res: Response): void {
    this.sendMethodNotAllowed(res)
  }

  /** 405 统一响应（`Allow: POST` 按 HTTP 规范回带，避免客户端自行试探） */
  private sendMethodNotAllowed(res: Response): void {
    res
      .status(405)
      .set('Allow', 'POST')
      .json({ code: ErrorCode.ParamInvalid, message: METHOD_NOT_ALLOWED_MESSAGE, data: null })
  }

  /** 配额剩余量响应头（API §23.5；成功与 429 都回带） */
  private setRateLimitHeaders(res: Response, snapshot: QuotaSnapshot): void {
    res.set(
      'X-RateLimit-Remaining-Minute',
      String(Math.max(0, snapshot.minuteLimit - snapshot.minuteUsed)),
    )
    res.set('X-RateLimit-Remaining-Day', String(Math.max(0, snapshot.dayLimit - snapshot.dayUsed)))
    res.set(
      'X-RateLimit-Rows-Remaining-Day',
      String(Math.max(0, snapshot.rowsLimit - snapshot.rowsUsed)),
    )
  }

  /** JSON-RPC 方法 → 审计 event（R145 三个主事件 + 其余 `mcp.{method}` 兜底，仍在 `mcp.` 前缀内） */
  private eventOf(body: unknown, ctx: McpRequestContext): string {
    const method = this.methodOf(body)
    if (!method) return 'mcp.request'
    if (method === 'tools/call') ctx.toolName = this.toolNameOf(body)
    if (method === 'initialize') return 'mcp.initialize'
    if (method === 'tools/list') return 'mcp.tools.list'
    if (method === 'tools/call') return 'mcp.tools.call'
    return `mcp.${method.replace(/\//g, '.')}`
  }

  /**
   * 审计流水（R145）：成功与负例都记（429 在抛异常前记，工具业务失败按 `ctx.resultCode` 记）。
   * 401 由守卫自行留痕（守卫在 controller 之前执行，ownerId=0）。
   */
  private writeAudit(
    principal: CredentialPrincipal,
    event: string,
    body: unknown,
    ctx: McpRequestContext,
    req: ExtRequest,
    started: number,
    resultCode: number,
  ): void {
    this.audit.record({
      principal: `cred:${principal.credentialId.toString()}`,
      ownerId: principal.ownerId,
      appId: principal.appId,
      endpoint: event,
      tableName: ctx.tableName,
      paramsSummary: this.summarize(body, ctx),
      rows: ctx.rows,
      durationMs: Date.now() - started,
      ip: this.extractIp(req),
      resultCode,
    })
  }

  /** 参数摘要（R145：工具名 + 入参，≤512 字由审计服务截断；**不含响应内容与 secret**） */
  private summarize(body: unknown, ctx: McpRequestContext): string | null {
    if (!ctx.toolName) return null
    const args = (body as { params?: { arguments?: unknown } }).params?.arguments
    if (args === undefined || args === null) return ctx.toolName
    return `${ctx.toolName} ${JSON.stringify(args)}`
  }

  private methodOf(body: unknown): string | null {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null
    const method = (body as { method?: unknown }).method
    return typeof method === 'string' && method !== '' ? method : null
  }

  private toolNameOf(body: unknown): string | null {
    const params = (body as { params?: unknown }).params
    if (!params || typeof params !== 'object' || Array.isArray(params)) return null
    const name = (params as { name?: unknown }).name
    return typeof name === 'string' && name !== '' ? name : null
  }

  /** 客户端 IP（信任代理头首段，口径同开放层与 ext 守卫） */
  private extractIp(req: ExtRequest): string | null {
    const forwarded = req.headers['x-forwarded-for']
    if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim()
    return req.ip ?? null
  }
}
