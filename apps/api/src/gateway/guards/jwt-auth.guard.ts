import { type ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { AuthGuard } from '@nestjs/passport'
import { RedisKey } from '../../common/constants/redis-key'
import { PrismaService } from '../../infra/prisma/prisma.service'
import { RedisService } from '../../infra/redis/redis.service'
import { IS_PUBLIC_KEY } from '../decorators/public.decorator'
import type { AuthUser } from './jwt.strategy'

/** 在线状态滑动过期时间（30 分钟，见 ARCHITECTURE §H） */
const ONLINE_TTL_SECONDS = 1800

/** 全局认证守卫：校验 Bearer token，@Public() 跳过，登出黑名单内的 jti 视为失效；校验通过刷新在线状态 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly reflector: Reflector,
    private readonly redisService: RedisService,
    private readonly prisma: PrismaService,
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

    // 校验通过：刷新在线状态（30 分钟滑动过期）
    if (userId) {
      await this.refreshOnline(request, userId)
    }
    return true
  }

  handleRequest<TUser = AuthUser>(err: unknown, user: TUser | false): TUser {
    if (err || !user) {
      throw new UnauthorizedException('未登录或登录已过期')
    }
    return user
  }

  /**
   * 刷新在线状态：key 存在则更新 lastActiveAt + 续期；
   * 不存在（30 分钟无活动后过期）则查库补写完整字段。
   */
  private async refreshOnline(
    request: { user?: AuthUser; ip?: string },
    userId: string,
  ): Promise<void> {
    const key = RedisKey.online(userId)
    const exists = await this.redisService.client.exists(key)
    const now = new Date().toISOString()

    if (exists) {
      await this.redisService.client.hset(key, 'lastActiveAt', now)
      await this.redisService.client.expire(key, ONLINE_TTL_SECONDS)
      return
    }

    // key 已过期：补写完整字段（nickname 需查库）
    const username = request.user?.username ?? ''
    const ip = this.extractIp(request as unknown as { headers?: Record<string, unknown>; ip?: string })
    const dbUser = await this.prisma.sysUser.findFirst({
      where: { id: BigInt(userId), deletedAt: null },
    })
    await this.redisService.client.hset(
      key,
      'username',
      username,
      'nickname',
      dbUser?.nickname ?? '',
      'ip',
      ip,
      'loginAt',
      now,
      'lastActiveAt',
      now,
    )
    await this.redisService.client.expire(key, ONLINE_TTL_SECONDS)
  }

  private extractIp(request: { headers?: Record<string, unknown>; ip?: string }): string {
    const forwarded = request.headers?.['x-forwarded-for']
    if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim()
    return request.ip ?? ''
  }
}
