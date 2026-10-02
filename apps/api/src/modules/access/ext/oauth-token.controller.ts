import { Body, Controller, Post, Req, Res } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Request, Response } from 'express'
import { CREDENTIAL_WWW_AUTHENTICATE } from '../../../common/constants/credential.constant'
import { ErrorCode } from '../../../common/constants/error-code'
import { Public } from '../../../gateway/decorators/public.decorator'
import { SkipTransform } from '../../../gateway/decorators/skip-transform.decorator'
import { AuditService } from '../audit/audit.service'
import { CredentialService, type CredentialPrincipal } from '../credential/credential.service'
import { TokenStore } from '../credential/token-store'
import { QuotaService } from '../quota/quota.service'

/** token 端点审计 event 名（R152/D142；与资源端点路径推断口径区分开） */
const OAUTH_TOKEN_EVENT = 'ext.oauth.token'

/** 唯一支持的授权类型（RFC 6749 §4.4：无交互用户场景） */
const GRANT_TYPE = 'client_credentials'

/**
 * OAuth2 token 端点（P18 T155；D139/D140/D142 / R151 / R152 / R155 / API §25.1）。
 *
 * `POST /api/ext/oauth/token`：客户端用 `client_id`（= keyId）+ `client_secret`（= secret）换
 * **短时效 access token**，再以 `Bearer it_*` 使用既有全部对外端点（REST / MCP 同管线）。
 *
 * **格式刻意分治（D140）**：本端点说 **RFC 6749**（成功 §5.1 三字段、失败 §5.2 `error` 对象），
 * **不用平台 envelope、不用平台业务码**——互操作对象是各语言现成的 OAuth 客户端库；
 * 资源端点（§22 / §23）继续用平台口径（401 + 50019 / 429 + 42900）。故本控制器**自写响应**，
 * 不经全局响应包装，也不经异常过滤器（唯一例外：配额超限 429 仍走平台口径，见下）。
 *
 * **记账（D142）**：签发前计该凭证请求配额 +1（防空转刷令牌；不计行数）；审计 event
 * `ext.oauth.token` **正负例都记**，摘要含 `grant_type` 与 `client_id`，**绝不含 secret 与 token 原文**。
 */
@ApiTags('对外开放-OAuth2')
@Controller('ext/oauth')
export class OAuthTokenController {
  constructor(
    private readonly credentials: CredentialService,
    private readonly tokens: TokenStore,
    private readonly quota: QuotaService,
    private readonly audit: AuditService,
  ) {}

  @Public()
  @SkipTransform()
  @Post('token')
  @ApiOperation({
    summary: 'OAuth2 token（grant_type=client_credentials；成功 RFC 6749 §5.1、失败 §5.2）',
  })
  async issueToken(
    @Req() req: Request,
    @Res() res: Response,
    @Body() body: unknown,
  ): Promise<void> {
    const started = Date.now()
    const input = this.readParams(body)

    // ① 授权类型（R155：缺失 → invalid_request；不支持 → unsupported_grant_type；均 400）
    if (!input.grantType) {
      this.writeAudit(null, input, req, started, ErrorCode.ParamInvalid)
      this.fail(res, 400, { error: 'invalid_request', error_description: '缺少 grant_type' })
      return
    }
    if (input.grantType !== GRANT_TYPE) {
      this.writeAudit(null, input, req, started, ErrorCode.ParamInvalid)
      this.fail(res, 400, {
        error: 'unsupported_grant_type',
        error_description: `仅支持 grant_type=${GRANT_TYPE}`,
      })
      return
    }

    // ② 客户端凭证校验：与资源端点**同一实现**（不缓存 → 吊销 / 轮换 / 到期即时生效，R154）；
    //    差异仅在 type 准入——token 端点接受两种形态（D141：api_key 型也可换 token，给迁移路径）
    const principal =
      input.clientId && input.clientSecret
        ? await this.credentials.verifyForToken(input.clientId, input.clientSecret)
        : null
    if (!principal) {
      // 不区分「不存在 / 摘要不符 / 已吊销 / 已过期」，也不回显 secret 任何片段（R155）
      this.writeAudit(null, input, req, started, ErrorCode.CredentialInvalid)
      res.set('WWW-Authenticate', CREDENTIAL_WWW_AUTHENTICATE)
      this.fail(res, 401, { error: 'invalid_client' })
      return
    }

    // ③ 请求配额（D142）：仅在客户端已通过校验后计——无效客户端刷不进配额表
    const snapshot = await this.quota.checkAndCount(principal.credentialId)
    res.set(
      'X-RateLimit-Remaining-Minute',
      String(Math.max(0, snapshot.minuteLimit - snapshot.minuteUsed)),
    )
    res.set('X-RateLimit-Remaining-Day', String(Math.max(0, snapshot.dayLimit - snapshot.dayUsed)))
    res.set(
      'X-RateLimit-Rows-Remaining-Day',
      String(Math.max(0, snapshot.rowsLimit - snapshot.rowsUsed)),
    )
    if (snapshot.exceeded) {
      // 配额超限走**平台口径**（API §25.1：42900 + Retry-After + X-RateLimit-*）——
      // RFC 6749 未定义 429，此处按我方配额契约回带，客户端可据此退避重试
      this.writeAudit(principal, input, req, started, ErrorCode.TooManyRequests)
      res.set('Retry-After', String(snapshot.retryAfterSeconds))
      res.status(429).json({
        code: ErrorCode.TooManyRequests,
        message: '令牌签发过于频繁，请稍后重试',
        data: null,
      })
      return
    }

    // ④ 签发（R151）：不透明令牌 + Redis；响应 RFC 6749 §5.1 三字段，**不回带 scope**
    //    （scope 恒以凭证行为准，避免客户端误以为是签发时快照 —— R153）
    const issued = await this.tokens.issue(principal.credentialId)
    this.writeAudit(principal, input, req, started, ErrorCode.Success)
    res.status(200).json({
      access_token: issued.token,
      token_type: 'Bearer',
      expires_in: issued.expiresIn,
    })
  }

  /** 入参归一：form-urlencoded（RFC 要求）与 JSON（宽容）同形取字段，缺失一律空串 */
  private readParams(body: unknown): {
    grantType: string
    clientId: string
    clientSecret: string
  } {
    const raw = (body ?? {}) as Record<string, unknown>
    const pick = (key: string): string => {
      const value = raw[key]
      return typeof value === 'string' ? value : ''
    }
    return {
      grantType: pick('grant_type').trim(),
      clientId: pick('client_id').trim(),
      clientSecret: pick('client_secret'),
    }
  }

  /** RFC 6749 §5.2 错误响应（**不带平台 envelope**，D140） */
  private fail(
    res: Response,
    status: number,
    body: { error: string; error_description?: string },
  ): void {
    res.status(status).json(body)
  }

  /**
   * 审计留痕（D142：正负例都记）。
   *
   * 客户端未通过校验时 `principal = null` → `ownerId = 0` 系统流水、`principal` 记
   * `cred:invalid`（不泄露 keyId 是否存在）；摘要只含 `grant_type` 与 `client_id`。
   */
  private writeAudit(
    principal: CredentialPrincipal | null,
    input: { grantType: string; clientId: string },
    req: Request,
    started: number,
    resultCode: number,
  ): void {
    this.audit.record({
      principal: principal ? `cred:${principal.credentialId.toString()}` : 'cred:invalid',
      ownerId: principal?.ownerId ?? BigInt(0),
      appId: principal?.appId ?? null,
      endpoint: OAUTH_TOKEN_EVENT,
      tableName: null,
      paramsSummary: `grant_type=${input.grantType || '（缺）'} client_id=${input.clientId || '（缺）'}`,
      rows: 0,
      durationMs: Date.now() - started,
      ip: this.extractIp(req),
      resultCode,
    })
  }

  private extractIp(req: Request): string | null {
    const forwarded = req.headers['x-forwarded-for']
    if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim()
    return req.ip ?? null
  }
}
