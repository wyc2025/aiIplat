import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { RedisKey } from '../../../common/constants/redis-key'
import { RedisService } from '../../../infra/redis/redis.service'

/** 配额快照（预检结果 / 响应头回填用） */
export interface QuotaSnapshot {
  minuteUsed: number
  dayUsed: number
  rowsUsed: number
  minuteLimit: number
  dayLimit: number
  rowsLimit: number
  exceeded: boolean
  /** 超限时按窗口重置点计算的等待秒数（`Retry-After`） */
  retryAfterSeconds: number
}

/**
 * 对外配额服务（P15 T136，D121/R134 / ARCHITECTURE-P15 §5）。
 *
 * 双窗按**凭证（principal）**计，不按 IP（MCP / 外部系统会显著放大请求频次，按 IP 既误伤也拦不住）：
 *
 * - 请求数：分钟窗 `access.quotaPerMinute`（默认 120）+ 日窗 `access.quotaPerDay`（默认 50,000）；
 * - 返回行数：日窗 `access.rowsPerDay`（默认 100,000，按**返回行数**累计；schema 端点计 0 行）。
 *
 * 记账口径：**请求数在进入时预检 + 计数，行数在响应后记账**（无法预知行数；单日超额幅度
 * ≤ 一次页大小，可接受——ARCHITECTURE-P15 §5 明示该口径，避免实现层误以为预检含行数）。
 * Redis 计数器首次写入设 TTL（分钟窗 120s / 日窗 48h），过期即自然重置。
 */
@Injectable()
export class QuotaService {
  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  /** 请求进入时预检并计数（超限时调用方回 HTTP 429 + 42900 + `Retry-After`） */
  async checkAndCount(credentialId: bigint): Promise<QuotaSnapshot> {
    const id = credentialId.toString()
    const now = new Date()
    const minuteLimit = this.config.get<number>('access.quotaPerMinute', 120)
    const dayLimit = this.config.get<number>('access.quotaPerDay', 50000)
    const rowsLimit = this.config.get<number>('access.rowsPerDay', 100000)

    const rowsKey = RedisKey.accQuotaRowsDay(id, this.dayWindow(now))
    const [minuteUsed, dayUsed, rowsRaw] = await Promise.all([
      this.incrWithTtl(RedisKey.accQuotaReqMinute(id, this.minuteWindow(now)), 120),
      this.incrWithTtl(RedisKey.accQuotaReqDay(id, this.dayWindow(now)), 48 * 3600),
      this.redis.client.get(rowsKey),
    ])
    const rowsUsed = Number(rowsRaw ?? 0) || 0

    const minuteExceeded = minuteUsed > minuteLimit
    const dayExceeded = dayUsed > dayLimit
    const rowsExceeded = rowsUsed >= rowsLimit
    return {
      minuteUsed,
      dayUsed,
      rowsUsed,
      minuteLimit,
      dayLimit,
      rowsLimit,
      exceeded: minuteExceeded || dayExceeded || rowsExceeded,
      retryAfterSeconds: minuteExceeded
        ? this.secondsToNextMinute(now)
        : dayExceeded || rowsExceeded
          ? this.secondsToNextDay(now)
          : 0,
    }
  }

  /**
   * 响应后按**返回行数**记账（R134 / ARCH §5）：先放行后扣账。
   * `rows <= 0`（schema / 详情失败等）不记账。
   */
  async addRows(credentialId: bigint, rows: number): Promise<void> {
    if (!Number.isFinite(rows) || rows <= 0) return
    const key = RedisKey.accQuotaRowsDay(credentialId.toString(), this.dayWindow(new Date()))
    await this.incrWithTtl(key, 48 * 3600, rows)
  }

  /** 当日用量（凭证列表回填用；无记录 = 0） */
  async usageToday(credentialId: bigint): Promise<{ requests: number; rows: number }> {
    const id = credentialId.toString()
    const now = new Date()
    const [requestsRaw, rowsRaw] = await Promise.all([
      this.redis.client.get(RedisKey.accQuotaReqDay(id, this.dayWindow(now))),
      this.redis.client.get(RedisKey.accQuotaRowsDay(id, this.dayWindow(now))),
    ])
    return {
      requests: Number(requestsRaw ?? 0) || 0,
      rows: Number(rowsRaw ?? 0) || 0,
    }
  }

  // ==================== 内部 ====================

  /** INCRBY + 首次写设 TTL（返回累计值） */
  private async incrWithTtl(key: string, ttlSeconds: number, by = 1): Promise<number> {
    const value = await this.redis.client.incrby(key, by)
    if (value === by) {
      await this.redis.client.expire(key, ttlSeconds)
    }
    return value
  }

  /** 分钟窗标识：yyyyMMddHHmm（本地时区，与审计 created_at 口径一致） */
  private minuteWindow(now: Date): string {
    return `${this.dayWindow(now)}${this.pad(now.getHours())}${this.pad(now.getMinutes())}`
  }

  /** 日窗标识：yyyyMMdd */
  private dayWindow(now: Date): string {
    return `${now.getFullYear()}${this.pad(now.getMonth() + 1)}${this.pad(now.getDate())}`
  }

  private pad(value: number): string {
    return String(value).padStart(2, '0')
  }

  private secondsToNextMinute(now: Date): number {
    return Math.max(1, 60 - now.getSeconds())
  }

  private secondsToNextDay(now: Date): number {
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0)
    return Math.max(1, Math.ceil((next.getTime() - now.getTime()) / 1000))
  }
}
