import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ErrorCode } from '../../common/constants/error-code'
import { RedisKey } from '../../common/constants/redis-key'
import { BusinessException } from '../../common/exceptions/business.exception'
import { RedisService } from '../../infra/redis/redis.service'
import { PERMISSION_KEY } from '../decorators/require-permission.decorator'
import type { AuthUser } from './jwt.strategy'

/**
 * 全局权限守卫：接口无 @RequirePermission() 则跳过；
 * 权限标识集合由 auth 模块在登录 / 拉取 userinfo 时写入 Redis（超管为 ['*']）
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly redisService: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (!required || required.length === 0) return true

    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>()
    const user = request.user
    if (!user) {
      throw new BusinessException(ErrorCode.Unauthorized, '未登录或登录已过期')
    }

    const cached = await this.redisService.client.get(RedisKey.userPerms(user.userId))
    const perms = new Set<string>(cached ? (JSON.parse(cached) as string[]) : [])

    // 超管标记 '*' 直接放行；多个权限标识满足其一即可
    if (perms.has('*') || required.some((perm) => perms.has(perm))) return true

    throw new BusinessException(ErrorCode.Forbidden, '无权限访问')
  }
}
