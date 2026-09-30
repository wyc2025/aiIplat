import { RedisKey } from '../../../common/constants/redis-key'
import type { RedisService } from '../../../infra/redis/redis.service'

/**
 * 取数面缓存工具（P12 T110 建 → P14 D115 收敛）。
 *
 * 键族 `app:pub:{appId}:schema | data:*`（键名沿用，语义已由「公开面」改为「授权取数面」）：
 * - schema：TTL 600s —— 授权增删、暴露开关、is_public 翻转、结构变更即 DEL；
 * - 数据：TTL 60s —— DataService 写事务提交后按 appId 前缀 SCAN DEL（写后失效）。
 * 结构变更与 P11 既有 `app:schema` 失效同源（一处挂钩两处生效）。
 *
 * Redis 不可用时静默降级（缓存是可选优化，绝不阻断写路径；照 schema.cache 先例）。
 */

/** 失效取数面 schema 缓存（暴露表结构，600s） */
export async function invalidatePubSchema(redis: RedisService, appId: bigint): Promise<void> {
  await redis.client.del(RedisKey.appPubSchema(appId.toString())).catch(() => undefined)
}

/** 失效取数面数据缓存（DataService 写路径事务提交后调用；授权变更亦调用） */
export async function invalidatePubData(redis: RedisService, appId: bigint): Promise<void> {
  await redis.scanDel(`${RedisKey.appPubDataPrefix(appId.toString())}*`).catch(() => 0)
}

/** 失效取数面全部缓存（授权增删 / 发布态与暴露变更 / 结构变更） */
export async function invalidatePubAll(redis: RedisService, appId: bigint): Promise<void> {
  await invalidatePubSchema(redis, appId)
  await invalidatePubData(redis, appId)
}
