import { RedisKey } from '../../../common/constants/redis-key'
import type { RedisService } from '../../../infra/redis/redis.service'

/**
 * 失效应用 schema 全量打包缓存（R99：结构/页面/应用变更即 DEL）。
 * Redis 不可用时静默降级（缓存本就是可选优化，不能阻断写路径）。
 */
export async function invalidateAppSchema(redis: RedisService, appId: bigint): Promise<void> {
  await redis.client.del(RedisKey.appSchema(appId.toString())).catch(() => undefined)
}

/** schema 缓存 TTL（秒） */
export const APP_SCHEMA_CACHE_TTL_SEC = 600
