import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ErrorCode } from '../../../common/constants/error-code'
import { RedisKey } from '../../../common/constants/redis-key'
import { parseDurationToSeconds } from '../../../common/utils/duration'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import { RedisService } from '../../../infra/redis/redis.service'

/** admin 用户名：不可踢下线 */
const ADMIN_USERNAME = 'admin'

/** 在线用户条目 */
export interface OnlineUser {
  userId: string
  username: string
  nickname: string
  ip: string
  loginAt: string
  lastActiveAt: string
}

/**
 * 在线用户（system 域增量）。
 * 数据来源 Redis `online:{userId}` hash（30 分钟滑动过期），仅作实时观察，不作审计依据。
 */
@Injectable()
export class OnlineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  /** 在线用户列表（SCAN online:* 聚合，按 lastActiveAt 倒序，不分页） */
  async list(): Promise<OnlineUser[]> {
    const users: OnlineUser[] = []
    let cursor = '0'
    do {
      const [next, keys] = await this.redis.client.scan(cursor, 'MATCH', 'online:*', 'COUNT', 100)
      cursor = next
      for (const key of keys) {
        const userId = key.slice('online:'.length)
        const fields = await this.redis.client.hgetall(key)
        if (!fields || Object.keys(fields).length === 0) continue
        users.push({
          userId,
          username: fields.username ?? '',
          nickname: fields.nickname ?? '',
          ip: fields.ip ?? '',
          loginAt: fields.loginAt ?? '',
          lastActiveAt: fields.lastActiveAt ?? '',
        })
      }
    } while (cursor !== '0')

    return users.sort((a, b) => (a.lastActiveAt < b.lastActiveAt ? 1 : -1))
  }

  /** 踢下线：复用改密码全端下线机制（写 pwdChanged 时间戳 + 清 refresh + 清权限缓存）+ 删在线状态 */
  async kick(targetUserId: bigint, operatorUserId: string): Promise<void> {
    const target = await this.prisma.sysUser.findFirst({
      where: { id: targetUserId, deletedAt: null },
    })
    if (!target) throw new BusinessException(ErrorCode.NotFound, '用户不存在')
    if (target.id.toString() === operatorUserId) {
      throw new BusinessException(ErrorCode.ParamInvalid, '不能踢自己下线')
    }
    if (target.username === ADMIN_USERNAME) {
      throw new BusinessException(ErrorCode.AdminProtected, 'admin 用户不可踢下线')
    }

    // 写密码修改时间戳（TTL = access 有效期），JwtAuthGuard 据此拒绝该用户全部已签发 token
    const accessTtl = parseDurationToSeconds(this.config.get<string>('jwt.accessExpires', '2h'))
    await this.redis.client.set(
      RedisKey.pwdChanged(target.id.toString()),
      String(Math.floor(Date.now() / 1000)),
      'EX',
      accessTtl,
    )
    // 删除全部 refresh token + 清权限缓存 + 删在线状态
    await this.redis.scanDel(`refresh:${target.id}:*`)
    await this.redis.client.del(RedisKey.userPerms(target.id.toString()))
    await this.redis.client.del(RedisKey.online(target.id.toString()))
  }
}
