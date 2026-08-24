import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { map, type Observable } from 'rxjs'
import { ErrorCode } from '../../common/constants/error-code'
import { SKIP_TRANSFORM_KEY } from '../decorators/skip-transform.decorator'

/** bigint 序列化为字符串（避免 JS number 精度丢失）；Date 交由 JSON 序列化转 ISO 字符串 */
function serialize(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) return value.map(serialize)
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serialize(item)]))
  }
  return value
}

/** 统一响应格式：{ code: 0, message: 'success', data }；SSE 接口（@SkipTransform）跳过 */
@Injectable()
export class TransformInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_TRANSFORM_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (skip) return next.handle()

    return next.handle().pipe(
      map((data: unknown) => ({
        code: ErrorCode.Success,
        message: 'success',
        data: serialize(data) ?? null,
      })),
    )
  }
}
