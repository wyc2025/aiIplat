import { type ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { AuthGuard } from '@nestjs/passport'
import { RedisKey } from '../../common/constants/redis-key'
import { RedisService } from '../../infra/redis/redis.service'
import { IS_PUBLIC_KEY } from '../decorators/public.decorator'
import type { AuthUser } from './jwt.strategy'

/** 全局认证守卫：校验 Bearer token，@Public() 跳过，登出黑名单内的 jti 视为失效 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly reflector: Reflector,
    private readonly redisService: RedisService,
  ) {
    super()
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (isPublic) return true

    const passed = (await super.canActivate(context)) as boolean
    if (!passed) return false

    // 登出黑名单：jti 命中即视为 token 已失效；
    // 密码修改强制下线：token 签发时间早于密码修改时间戳 → 旧 token 全部失效
    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>()
    const { jti, userId, iat } = request.user ?? {}
    const [blacklisted, pwdChangedAt] = await Promise.all([
      jti ? this.redisService.client.exists(RedisKey.tokenBlacklist(jti)) : Promise.resolve(0),
      userId ? this.redisService.client.get(RedisKey.pwdChanged(userId)) : Promise.resolve(null),
    ])
    if (blacklisted) {
      throw new UnauthorizedException('登录状态已失效，请重新登录')
    }
    if (pwdChangedAt && iat !== undefined && Number(pwdChangedAt) > iat) {
      throw new UnauthorizedException('密码已修改，请重新登录')
    }
    return true
  }

  handleRequest<TUser = AuthUser>(err: unknown, user: TUser | false): TUser {
    if (err || !user) {
      throw new UnauthorizedException('未登录或登录已过期')
    }
    return user
  }
}
