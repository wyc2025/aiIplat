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
import { maskSensitiveQuery } from '../../common/utils/url-mask.util'
import { OPERATION_LOG_KEY, type OperationLogMeta } from '../decorators/operation-log.decorator'
import { SKIP_TRANSFORM_KEY } from '../decorators/skip-transform.decorator'
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

    // SSE 接口（@SkipTransform）跳过统一操作日志，由业务层自定义记录
    const skipTransform = this.reflector.getAllAndOverride<boolean>(SKIP_TRANSFORM_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (skipTransform) return next.handle()

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
            // P4E D56/T64：URL 与 query 均先脱敏（sid / password 等查询参数打码）
            url: maskSensitiveQuery(request.originalUrl),
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

  /** 收集 query + body（剔除密码 / 凭证等敏感字段） */
  private collectParams(request: Request): Record<string, unknown> {
    const sensitiveKeys = new Set(['password', 'oldPassword', 'newPassword', 'confirmPassword', 'sid'])
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

  /** 序列化 params（TEXT 列上限 65535 字节：T43 在线编辑的 content 可达 1MB，超长截断保证日志可落库） */
  private safeStringify(value: unknown): string | null {
    try {
      const str = JSON.stringify(value)
      if (str && str.length > 8000) {
        return `${str.slice(0, 8000)}…(truncated)`
      }
      return str
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
