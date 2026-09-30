import {
  type CallHandler,
  type ExecutionContext,
  HttpException,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common'
import type { Response } from 'express'
import { type Observable, tap } from 'rxjs'
import { BusinessException } from '../../../common/exceptions/business.exception'
import type { CredentialPrincipal } from '../credential/credential.service'
import type { ExtRequest } from '../ext/ext-auth.guard'
import { extEndpointOf } from '../ext/ext-path.util'
import { AuditService } from './audit.service'

/** 控制器写入的审计上下文（endpoint / 表名 / 返回行数 / 参数摘要） */
interface ExtAuditLocals {
  extAudit?: {
    endpoint?: string
    tableName?: string | null
    rows?: number
    paramsSummary?: string | null
  }
}

/**
 * 对外取数审计拦截器（P15 T136，D122/R135/R141）。
 *
 * 挂在 `ExtDataController` 上：成功与**负例**（401 由守卫在进入前抛出、40400 / 40001 / 42900 由
 * 控制器或配额拦截器抛出）都记一条——"谁在读、读了多少、结果如何"是外部对接的准入前提。
 * 只读 `request.principal` 与 `res.locals.extAudit`（controller 只报告事实，记账集中在此，R141）。
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp()
    const request = http.getRequest<ExtRequest>()
    const response = http.getResponse<Response>()
    const principal = request.principal
    if (!principal) return next.handle()

    const started = Date.now()
    return next.handle().pipe(
      tap({
        next: () => this.write(principal, response, 0, started),
        error: (error: unknown) => this.write(principal, response, this.errorCode(error), started),
      }),
    )
  }

  /** 组装并投递审计条目（异步；失败只记日志，不阻断取数） */
  private write(
    principal: CredentialPrincipal,
    response: Response,
    resultCode: number,
    started: number,
  ): void {
    const locals = (response.locals as ExtAuditLocals).extAudit
    // locals 缺失（负例在 handler 之前抛出，如配额 429）→ 由路径推断端点（与守卫共用同一实现）
    const endpoint = locals?.endpoint ?? extEndpointOf(response.req.path ?? '')
    this.audit.record({
      principal: `cred:${principal.credentialId.toString()}`,
      ownerId: principal.ownerId,
      appId: principal.appId,
      endpoint,
      tableName: locals?.tableName ?? null,
      paramsSummary: locals?.paramsSummary ?? null,
      rows: locals?.rows ?? 0,
      durationMs: Date.now() - started,
      ip: this.extractIp(response.req),
      resultCode,
    })
  }

  /** 错误码提取（业务异常取业务码；HttpException 取自带业务码；其余按 50000 内部错误） */
  private errorCode(error: unknown): number {
    if (error instanceof BusinessException) return error.code
    if (error instanceof HttpException) {
      const body = error.getResponse()
      if (body && typeof body === 'object' && typeof (body as { code?: unknown }).code === 'number') {
        return (body as { code: number }).code
      }
      return error.getStatus()
    }
    return 50000
  }

  /** 客户端 IP（信任代理头首段，口径同开放层） */
  private extractIp(req: { headers?: Record<string, unknown>; ip?: string }): string | null {
    const forwarded = req.headers?.['x-forwarded-for']
    if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim()
    return req.ip ?? null
  }
}
