import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { RedisKey } from '../../../common/constants/redis-key'
import { DEFAULT_TOKEN_TTL_SECONDS } from '../../../common/constants/credential.constant'
import { RedisService } from '../../../infra/redis/redis.service'
import { hashToken, issueAccessToken } from './credential.util'

/**
 * OAuth2 access token 存取（P18 T155 / D139/R151，ARCHITECTURE-P18 §34.2）。
 *
 * 令牌**不落 DB**：`acc:token:{sha256(token)}` → credentialId（TTL = 令牌寿命），
 * 另有每凭证索引集合 `acc:token:idx:{credId}` 支撑「吊销 / 轮换即时级联失效」（R154）。
 *
 * 设计要点：
 * - **键是摘要**：Redis 快照泄露也拿不到可用令牌（原文只在签发响应出现一次）；
 * - **TTL = 令牌寿命**：自然过期即 401，无需清理任务；
 * - **索引不设 TTL**：孤儿成员（已自然过期的摘要）在下次签发时顺带清扫——凭证级基数极低，无需后台任务；
 * - **不设并发令牌数上限**：令牌风暴由请求配额兜底（R142 同口径，D142）。
 *
 * 归属 `credential/` 而非 `ext/`：它操作的是**凭证的令牌**，且 `CredentialModule` 导出后
 * 由 `ExtModule`（守卫）与 `OauthTokenController` 共用——放在 ext 会造成两模块循环依赖。
 */
@Injectable()
export class TokenStore {
  private readonly logger = new Logger(TokenStore.name)

  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  /** 令牌寿命（秒；`ACCESS_TOKEN_TTL_SECONDS`，默认 3600） */
  get ttlSeconds(): number {
    return this.config.get<number>('access.tokenTtlSeconds', DEFAULT_TOKEN_TTL_SECONDS)
  }

  /** 签发并落 Redis；返回 `{ token, expiresIn }`（token 原文仅此一次出现） */
  async issue(credentialId: bigint): Promise<{ token: string; expiresIn: number }> {
    const token = issueAccessToken()
    const digest = hashToken(token)
    const ttl = this.ttlSeconds
    await this.pruneIndex(credentialId)
    await this.redis.client
      .multi()
      .set(RedisKey.accToken(digest), credentialId.toString(), 'EX', ttl)
      .sadd(RedisKey.accTokenIndex(credentialId.toString()), digest)
      .exec()
    return { token, expiresIn: ttl }
  }

  /** 令牌 → credentialId（未命中 / 已过期 → `null`，调用方统一 401） */
  async resolve(token: string): Promise<bigint | null> {
    const value = await this.redis.client.get(RedisKey.accToken(hashToken(token)))
    return value ? BigInt(value) : null
  }

  /**
   * 级联失效（R154）：吊销 / 轮换 secret → 该凭证**已签发的全部令牌即时失效**（不等 TTL）。
   *
   * 失败只记日志不抛：调用方是管理侧写操作（吊销 / 轮换），不应因缓存清理失败而回滚——
   * 且令牌解析时还会**实查凭证行**（R153），即便索引清理失败，失效语义依然成立。
   */
  async revokeAll(credentialId: bigint): Promise<void> {
    try {
      const indexKey = RedisKey.accTokenIndex(credentialId.toString())
      const digests = await this.redis.client.smembers(indexKey)
      if (digests.length === 0) return
      const pipeline = this.redis.client.multi()
      for (const digest of digests) pipeline.del(RedisKey.accToken(digest))
      pipeline.del(indexKey)
      await pipeline.exec()
    } catch (error) {
      this.logger.warn(`清理凭证 ${credentialId.toString()} 的令牌失败：${String(error)}`)
    }
  }

  /** 清扫索引中的孤儿成员（令牌已自然过期、索引仍残留） */
  private async pruneIndex(credentialId: bigint): Promise<void> {
    const indexKey = RedisKey.accTokenIndex(credentialId.toString())
    const digests = await this.redis.client.smembers(indexKey)
    if (digests.length === 0) return
    const orphans: string[] = []
    for (const digest of digests) {
      const alive = await this.redis.client.exists(RedisKey.accToken(digest))
      if (!alive) orphans.push(digest)
    }
    if (orphans.length > 0) await this.redis.client.srem(indexKey, ...orphans)
  }
}
