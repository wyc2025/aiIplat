import { createParamDecorator, type ExecutionContext } from '@nestjs/common'
import type { AuthUser } from '../guards/jwt.strategy'

/**
 * 获取当前登录用户：@CurrentUser() 取整个用户对象，@CurrentUser('userId') 取单个字段
 */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{ user?: AuthUser }>()
    const user = request.user
    return data ? user?.[data] : user
  },
)
