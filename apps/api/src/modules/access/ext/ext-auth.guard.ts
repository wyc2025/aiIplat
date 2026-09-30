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
import { parseBearerKey } from '../credential/credential.util'
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
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ExtRequest>()
    const started = Date.now()
    const parsed = parseBearerKey(request.headers.authorization)
    if (!parsed) {
      this.recordUnauthorized(request, 'invalid', started)
      throw new CredentialUnauthorizedException(
        '缺少或非法的凭证（需 Authorization: Bearer {keyId}.{secret}）',
      )
    }
    const principal = await this.credentialService.verify(parsed.keyId, parsed.secret)
    if (!principal) {
      this.recordUnauthorized(request, parsed.keyId, started)
      throw new CredentialUnauthorizedException('凭证无效、已吊销或已过期')
    }
    request.principal = principal
    void this.credentialService.touchLastUsed(principal.credentialId)
    return true
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
