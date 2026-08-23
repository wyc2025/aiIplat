import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Request, Response } from 'express'
import { catchError, tap, throwError, type Observable } from 'rxjs'
import { PrismaService } from '../../infra/prisma/prisma.service'
import { OPERATION_LOG_KEY, type OperationLogMeta } from '../decorators/operation-log.decorator'
import type { AuthUser } from '../guards/jwt.strategy'

/** 操作日志：仅对挂了 @OperationLog 的接口生效；响应后异步写库，不阻塞主流程，失败只记运行日志 */
@Injectable()
export class OperationLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(OperationLogInterceptor.name)

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.getAllAndOverride<OperationLogMeta>(OPERATION_LOG_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (!meta) return next.handle()

    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>()
    const start = Date.now()

    const writeLog = (status: number, errorMsg?: string) => {
      const duration = Date.now() - start
      // 异步落库，写库失败不阻断业务
      void this.prisma.sysOperationLog
        .create({
          data: {
            userId: request.user?.userId ? BigInt(request.user.userId) : null,
            username: request.user?.username ?? null,
            module: meta.module,
            action: meta.action,
            method: request.method,
            url: request.originalUrl,
            params: this.safeStringify(this.collectParams(request)),
            ip: this.extractIp(request),
            status,
            errorMsg: errorMsg ?? null,
            duration,
          },
        })
        .catch((error: unknown) => {
          this.logger.error(`操作日志落库失败: ${error instanceof Error ? error.message : String(error)}`)
        })
    }

    return next.handle().pipe(
      tap(() => {
        const response = context.switchToHttp().getResponse<Response>()
        writeLog(response.statusCode < 400 ? 1 : 0)
      }),
      catchError((error: unknown) => {
        writeLog(0, error instanceof Error ? error.message : String(error))
        return throwError(() => error)
      }),
    )
  }

  /** 收集 query + body（剔除密码等敏感字段） */
  private collectParams(request: Request): Record<string, unknown> {
    const sensitiveKeys = new Set(['password', 'oldPassword', 'newPassword', 'confirmPassword'])
    const sanitize = (obj: unknown): unknown => {
      if (obj === null || typeof obj !== 'object') return obj
      if (Array.isArray(obj)) return obj.map(sanitize)
      return Object.fromEntries(
        Object.entries(obj as Record<string, unknown>)
          .filter(([key]) => !sensitiveKeys.has(key))
          .map(([key, value]) => [key, sanitize(value)]),
      )
    }
    return {
      query: sanitize(request.query),
      body: sanitize(request.body),
    }
  }

  private safeStringify(value: unknown): string | null {
    try {
      return JSON.stringify(value)
    } catch {
      return null
    }
  }

  private extractIp(request: Request): string | null {
    const forwarded = request.headers['x-forwarded-for']
    if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim()
    return request.ip ?? null
  }
}
