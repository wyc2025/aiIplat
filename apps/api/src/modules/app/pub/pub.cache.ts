import { RedisKey } from '../../../common/constants/redis-key'
import type { RedisService } from '../../../infra/redis/redis.service'

/**
 * 公开面缓存工具（P12 T110，R105 / ARCHITECTURE §28.3）。
 *
 * 键族 `app:pub:{appId}:manifest | schema:* | data:*`：
 * - manifest / 页 schema：TTL 600s —— 发布/取消发布、暴露开关、页公开标记、结构变更即 DEL；
 * - 数据：TTL 60s —— DataService 写事务提交后按 appId 前缀 SCAN DEL（写后失效）。
 * 结构变更与 P11 既有 `app:schema` 失效同源（一处挂钩两处生效）。
 *
 * Redis 不可用时静默降级（缓存是可选优化，绝不阻断写路径；照 schema.cache 先例）。
 */

/** 失效 manifest 缓存 */
export async function invalidatePubManifest(redis: RedisService, appId: bigint): Promise<void> {
  await redis.client.del(RedisKey.appPubManifest(appId.toString())).catch(() => undefined)
}

/** 失效公开页 schema 缓存（给 pageCode 精确 DEL，否则按前缀 SCAN 删全部） */
export async function invalidatePubSchema(
  redis: RedisService,
  appId: bigint,
  pageCode?: string,
): Promise<void> {
  if (pageCode) {
    await redis.client
      .del(RedisKey.appPubPageSchema(appId.toString(), pageCode))
      .catch(() => undefined)
    return
  }
  await redis.scanDel(`${RedisKey.appPubSchemaPrefix(appId.toString())}*`).catch(() => 0)
}

/** 失效公开数据缓存（DataService 写路径事务提交后调用） */
export async function invalidatePubData(redis: RedisService, appId: bigint): Promise<void> {
  await redis.scanDel(`${RedisKey.appPubDataPrefix(appId.toString())}*`).catch(() => 0)
}

/** 失效公开面全部缓存（发布/取消发布等整体态变更） */
export async function invalidatePubAll(redis: RedisService, appId: bigint): Promise<void> {
  await invalidatePubManifest(redis, appId)
  await invalidatePubSchema(redis, appId)
  await invalidatePubData(redis, appId)
}
