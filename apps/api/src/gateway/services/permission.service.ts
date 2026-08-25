import { Injectable } from '@nestjs/common'
import { RedisKey } from '../../common/constants/redis-key'
import { RedisService } from '../../infra/redis/redis.service'

/**
 * 权限判定服务（gateway 层共用，P2b 抽出）。
 * PermissionGuard 与 AI 工具层都调用它做权限校验，避免权限判定逻辑复制。
 * 权限标识集合由 auth 模块在登录 / 拉取 userinfo 时写入 Redis（超管为 ['*']）。
 */
@Injectable()
export class PermissionService {
  constructor(private readonly redisService: RedisService) {}

  /** 判断用户是否拥有指定权限标识；超管（'*'）直接放行 */
  async hasPermission(userId: string, perm: string): Promise<boolean> {
    const cached = await this.redisService.client.get(RedisKey.userPerms(userId))
    const perms = new Set<string>(cached ? (JSON.parse(cached) as string[]) : [])
    return perms.has('*') || perms.has(perm)
  }

  /** 判断用户是否拥有指定权限标识之一（任一命中即通过） */
  async hasAnyPermission(userId: string, perms: string[]): Promise<boolean> {
    const cached = await this.redisService.client.get(RedisKey.userPerms(userId))
    const userPerms = new Set<string>(cached ? (JSON.parse(cached) as string[]) : [])
    if (userPerms.has('*')) return true
    return perms.some((perm) => userPerms.has(perm))
  }
}
