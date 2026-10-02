import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common'
import type { Request } from 'express'
import { ErrorCode } from '../../../common/constants/error-code'
import { AuditService } from '../audit/audit.service'
import { CredentialService, type CredentialPrincipal } from '../credential/credential.service'
import { TokenStore } from '../credential/token-store'
import { parseBearerKey, parseBearerToken } from '../credential/credential.util'
import { extEndpointOf } from './ext-path.util'

/** 携带凭证主体的请求（守卫解析结果；控制器与 T136 的配额 / 审计拦截器消费） */
export interface ExtRequest extends Request {
  principal?: CredentialPrincipal
}

/**
 * 凭证层 401（R132 第 1 步）。
 *
 * **HTTP 状态码语义真实化**：对外端点用真实 `401` + `WWW-Authenticate`（经全局过滤器识别
 * 自带业务码的 HttpException 输出 body `code=50019`）——外部系统与下期 MCP 客户端依赖 401 发现
 * 授权要求；这是与**匿名层「HTTP 200 + 40400」防探测口径的刻意分治**：凭证错误不泄露资源信息，
 * 而应用 / 资源层失败仍统一 40400。
 */
export class CredentialUnauthorizedException extends HttpException {
  constructor(message: string) {
    super({ code: ErrorCode.CredentialInvalid, message }, HttpStatus.UNAUTHORIZED)
  }
}

/**
 * 对外取数守卫（P15 T135，R130/R131/R132-1 / ARCHITECTURE-P15 §3）。
 *
 * 解析 `Authorization: Bearer {keyId}.{secret}` → 校验（不存在 / 摘要不匹配 / 已吊销 / 已过期一律 401）
 * → 把主体塞进 `request.principal` → 异步更新 `lastUsedAt`（不阻塞响应）。
 *
 * 校验**不缓存**（每次实查 `uk_cred_keyid`）：吊销 / 轮换立即生效，无失效传播问题。
 */
@Injectable()
export class ExtAuthGuard implements CanActivate {
  constructor(
    private readonly credentialService: CredentialService,
    private readonly tokens: TokenStore,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ExtRequest>()
    const started = Date.now()
    const principal = await this.resolvePrincipal(request, started)
    if (!principal) {
      throw new CredentialUnauthorizedException(
        '凭证无效、已吊销或已过期（需 Authorization: Bearer {keyId}.{secret} 或 Bearer it_...）',
      )
    }
    request.principal = principal
    void this.credentialService.touchLastUsed(principal.credentialId)
    return true
  }

  /**
   * 双形态分派（P18 T156 / R153）：
   *
   * - `Bearer {keyId}.{secret}`（API Key）→ 凭证校验（`type` 须 `api_key`，D141）；
   * - `Bearer it_...`（access token）→ Redis 查凭证 id → **再实查凭证行**校验有效性；
   * - 其余形态 → `null`（统一 401，不区分原因）。
   *
   * **令牌路径为何还要回查 DB**：令牌只证明「持有者曾用正确 secret 换过令牌」，授权事实
   * （scope / 是否吊销 / 是否过期）**永远以凭证行为准**——因此 scope 收窄、吊销、轮换、
   * 凭证到期都对已签发令牌**即时生效**（R153/R154），无需逐令牌传播失效。
   */
  private async resolvePrincipal(
    request: ExtRequest,
    started: number,
  ): Promise<CredentialPrincipal | null> {
    const header = request.headers.authorization
    const parsedKey = parseBearerKey(header)
    if (parsedKey) {
      const principal = await this.credentialService.verify(parsedKey.keyId, parsedKey.secret)
      if (!principal) this.recordUnauthorized(request, parsedKey.keyId, started)
      return principal
    }
    const token = parseBearerToken(header)
    if (token) {
      const credentialId = await this.tokens.resolve(token)
      const principal = credentialId ? await this.credentialService.principalOf(credentialId) : null
      if (!principal) this.recordUnauthorized(request, 'invalid', started)
      return principal
    }
    this.recordUnauthorized(request, 'invalid', started)
    return null
  }

  /**
   * 401 留痕（R135 验收：负例同样落 `acc_audit`）。
   *
   * 守卫在拦截器**之前**执行，故 401 由本方法自行记录（不会与审计拦截器重复）。
   * 凭证未通过时无属主归属 → `ownerId = 0`（系统流水，不进属主检索），
   * `principal = cred:{keyId}`（keyId 未知时记 `cred:invalid`）。
   */
  private recordUnauthorized(request: ExtRequest, keyId: string, started: number): void {
    this.audit.record({
      principal: `cred:${keyId}`,
      ownerId: BigInt(0),
      appId: null,
      endpoint: extEndpointOf(request.path ?? ''),
      tableName: null,
      paramsSummary: null,
      rows: 0,
      durationMs: Date.now() - started,
      ip: this.extractIp(request),
      resultCode: ErrorCode.CredentialInvalid,
    })
  }

  private extractIp(request: ExtRequest): string | null {
    const forwarded = request.headers['x-forwarded-for']
    if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim()
    return request.ip ?? null
  }
}
