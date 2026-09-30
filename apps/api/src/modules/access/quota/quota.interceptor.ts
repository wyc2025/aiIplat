import {
  type CallHandler,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common'
import type { Response } from 'express'
import { from, type Observable, switchMap, tap } from 'rxjs'
import { ErrorCode } from '../../../common/constants/error-code'
import type { ExtRequest } from '../ext/ext-auth.guard'
import { QuotaService } from './quota.service'

/** 超限时控制器写入 locals 的行数约定（`res.locals.extAudit`，见 `ExtDataController`） */
interface ExtLocals {
  extAudit?: { rows?: number }
}

/** 配额超限（HTTP 429 + `code=42900` + `Retry-After`；状态码真实化与凭证层 401 同口径） */
export class QuotaExceededException extends HttpException {
  constructor(message: string) {
    super({ code: ErrorCode.TooManyRequests, message }, HttpStatus.TOO_MANY_REQUESTS)
  }
}

/**
 * 对外配额拦截器（P15 T136，D121/R134/R141）。
 *
 * 只挂在 `ExtDataController`（对外四端点）：进入时预检 + 计数请求数（分钟窗 + 日窗），
 * 超限即 HTTP 429 + 42900 + `Retry-After`；响应完成后按**返回行数**记账（`res.locals.extAudit.rows`）。
 * 成功响应头回带剩余量（`X-RateLimit-*`，API-P15 §3.4）。
 *
 * 匿名层既有「60 次/分/IP」限流**保留不动**（防爬，与凭证配额是两层，R134）。
 */
@Injectable()
export class QuotaInterceptor implements NestInterceptor {
  constructor(private readonly quota: QuotaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp()
    const request = http.getRequest<ExtRequest>()
    const response = http.getResponse<Response>()
    const principal = request.principal
    if (!principal) return next.handle()

    return from(this.quota.checkAndCount(principal.credentialId)).pipe(
      switchMap((snapshot) => {
        if (snapshot.exceeded) {
          response.set('Retry-After', String(snapshot.retryAfterSeconds))
          throw new QuotaExceededException(
            `已超配额（请求 ${snapshot.dayUsed}/${snapshot.dayLimit} 次/日、${snapshot.minuteUsed}/${snapshot.minuteLimit} 次/分；` +
              `行数 ${snapshot.rowsUsed}/${snapshot.rowsLimit} 行/日）`,
          )
        }
        response.set('X-RateLimit-Remaining-Minute', String(Math.max(0, snapshot.minuteLimit - snapshot.minuteUsed)))
        response.set('X-RateLimit-Remaining-Day', String(Math.max(0, snapshot.dayLimit - snapshot.dayUsed)))
        response.set('X-RateLimit-Rows-Remaining-Day', String(Math.max(0, snapshot.rowsLimit - snapshot.rowsUsed)))
        return next.handle().pipe(
          tap(() => {
            const rows = (response.locals as ExtLocals).extAudit?.rows ?? 0
            if (rows > 0) {
              void this.quota.addRows(principal.credentialId, rows)
            }
          }),
        )
      }),
    )
  }
}
