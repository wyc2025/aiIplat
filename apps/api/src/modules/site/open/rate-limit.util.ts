import type { Request } from 'express'
import { ErrorCode } from '../../../common/constants/error-code'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { RedisKey } from '../../../common/constants/redis-key'
import type { RedisService } from '../../../infra/redis/redis.service'

/** 开放层限流窗口（秒）：独立限流桶，60 次/窗口（D11） */
const RATE_WINDOW_SEC = 60

/** IP 取值：X-Forwarded-For 首段，无该头取 socket 地址（R8 口径，与 JwtAuthGuard 一致） */
export function extractIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim()
  return req.ip ?? ''
}

/**
 * 开放层独立限流（D11：Redis 计数，site 配置组可配；与 ai/chat 同款模式）。
 * bucket：static（120/分）| api（60/分）| comment（10/分）。
 * 超限 → 42900（PRD 验收：评论连发触发 42900；开放层"统一 40400"不含限流，见 R15 例外）。
 */
export async function assertRateLimit(
  redis: RedisService,
  bucket: string,
  ip: string,
  limit: number,
): Promise<void> {
  const key = RedisKey.siteRate(bucket, ip)
  const count = await redis.client.incr(key)
  if (count === 1) {
    await redis.client.expire(key, RATE_WINDOW_SEC).catch(() => undefined)
  }
  if (count > limit) {
    throw new BusinessException(ErrorCode.TooManyRequests, '请求过于频繁')
  }
}
