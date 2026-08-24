import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Redis } from 'ioredis'

/**
 * 全局 Redis 服务（ioredis）。
 * lazyConnect：首次使用时建立连接，连接失败持续重试，错误只记日志不阻断启动。
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name)

  readonly client: Redis

  constructor(configService: ConfigService) {
    this.client = new Redis(configService.getOrThrow<string>('redis.url'), { lazyConnect: true })
    this.client.on('error', (error) => this.logger.error(error.message))
  }

  async onModuleDestroy() {
    await this.client.quit()
  }

  /** SCAN 匹配 key 并批量删除（用于按前缀清理，如某用户全部 refresh token），返回删除数量 */
  async scanDel(pattern: string): Promise<number> {
    let cursor = '0'
    let deleted = 0
    do {
      const [next, keys] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100)
      cursor = next
      if (keys.length > 0) {
        deleted += await this.client.del(...keys)
      }
    } while (cursor !== '0')
    return deleted
  }
}
