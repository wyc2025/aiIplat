import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../../../infra/prisma/prisma.service'

/** 审计条目（拦截器与门面组装后交给本服务异步落表） */
export interface AuditEntry {
  /** `display:{id}`（匿名展示应用取数）| `cred:{id}`（对外凭证取数） */
  principal: string
  ownerId: bigint
  appId: bigint | null
  /** schema / records / detail / file */
  endpoint: string
  tableName: string | null
  /** 查询参数摘要（≤512 字符；不含返回内容） */
  paramsSummary: string | null
  rows: number
  durationMs: number
  ip: string | null
  /** 0 / 40001 / 40400 / 42900 / 50019 … */
  resultCode: number
}

/** 检索入参（管理侧 `GET /api/access/audits`） */
export interface AuditQuery {
  credentialId?: bigint
  from?: Date
  to?: Date
  resultCode?: number
  pageNo: number
  pageSize: number
}

/** 审计视图（出域形态；bigint → string，时间为 ISO 串由统一序列化处理） */
export interface AuditView {
  id: string
  principal: string
  appId: string | null
  endpoint: string
  tableName: string | null
  paramsSummary: string | null
  rows: number
  durationMs: number
  ip: string | null
  resultCode: number
  createdAt: Date
}

/** 批量落表阈值（满 100 条即 flush） */
const FLUSH_BATCH = 100
/** 参数摘要截断长度（R135：≤512 字符） */
const SUMMARY_MAX = 512

/**
 * 接入审计服务（P15 T136，D122/R135 / ARCHITECTURE-P15 §5）。
 *
 * **异步缓冲批量落表**：内存队列 + 每 `access.auditFlushMs`（默认 5s）或满 100 条 `createMany`；
 * 进程退出（`onApplicationShutdown`）前 drain；写库失败**只记日志不阻断取数**。
 * 进程崩溃损失 ≤ 一次 flush 窗口的流水（登记为可接受口径，ARCHITECTURE-P15 §5）。
 *
 * 覆盖范围：对外取数（credential 主体，经拦截器）+ 开放层取数（display 主体，经 `AccessFacade.writeAudit`）。
 * 保留 90 天：`AccessCleanTask` 每日清理（本服务提供 `cleanExpired` 编排）。
 */
@Injectable()
export class AuditService implements OnApplicationShutdown {
  private readonly logger = new Logger(AuditService.name)
  private readonly buffer: AuditEntry[] = []
  private timer: NodeJS.Timeout | null = null
  private flushing = false

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** 记一条（非阻塞；失败不影响取数） */
  record(entry: AuditEntry): void {
    this.buffer.push(entry)
    if (this.buffer.length >= FLUSH_BATCH) {
      void this.flush()
      return
    }
    this.ensureTimer()
  }

  /** 退出前 drain（不丢最后一批） */
  async onApplicationShutdown(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    await this.flush()
  }

  /**
   * 审计检索（API-P15 §3.5）：属主隔离——只见自己的凭证流水与自己的展示应用（匿名层）流水。
   * `credentialId` 精确过滤时拼 `cred:{id}`；`display` 主体按 owner_id 归属过滤。
   */
  async search(ownerId: bigint, query: AuditQuery): Promise<{
    list: AuditView[]
    total: number
    pageNo: number
    pageSize: number
  }> {
    const where: Record<string, unknown> = { ownerId }
    if (query.credentialId !== undefined) {
      where.principal = `cred:${query.credentialId.toString()}`
    }
    if (query.resultCode !== undefined) {
      where.resultCode = query.resultCode
    }
    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: query.from } : {}),
        ...(query.to ? { lte: query.to } : {}),
      }
    }
    const [total, rows] = await Promise.all([
      this.prisma.accAudit.count({ where }),
      this.prisma.accAudit.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (query.pageNo - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ])
    return {
      list: rows.map((row) => ({
        id: row.id.toString(),
        principal: row.principal,
        appId: row.appId === null ? null : row.appId.toString(),
        endpoint: row.endpoint,
        tableName: row.tableName,
        paramsSummary: row.paramsSummary,
        rows: row.rows,
        durationMs: row.durationMs,
        ip: row.ip,
        resultCode: row.resultCode,
        createdAt: row.createdAt,
      })),
      total,
      pageNo: query.pageNo,
      pageSize: query.pageSize,
    }
  }

  /** 90 天清理（R135）：分批删除（每批 1000，避免长事务），返回删除总数 */
  async cleanExpired(retentionDays: number): Promise<{ deleted: number }> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 3600 * 1000)
    let deleted = 0
    for (;;) {
      const batch = await this.prisma.accAudit.findMany({
        where: { createdAt: { lt: cutoff } },
        orderBy: { id: 'asc' },
        take: 1000,
        select: { id: true },
      })
      if (batch.length === 0) break
      const result = await this.prisma.accAudit.deleteMany({
        where: { id: { in: batch.map((row) => row.id) } },
      })
      deleted += result.count
      if (batch.length < 1000) break
    }
    return { deleted }
  }

  // ==================== 内部 ====================

  private ensureTimer(): void {
    if (this.timer) return
    const flushMs = this.config.get<number>('access.auditFlushMs', 5000)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, flushMs)
    // 不因定时器阻止进程退出（drain 由 onApplicationShutdown 负责）
    this.timer.unref?.()
  }

  private async flush(): Promise<void> {
    if (this.flushing || this.buffer.length === 0) return
    this.flushing = true
    const batch = this.buffer.splice(0, this.buffer.length)
    try {
      await this.prisma.accAudit.createMany({
        data: batch.map((entry) => ({
          principal: entry.principal,
          ownerId: entry.ownerId,
          appId: entry.appId,
          endpoint: entry.endpoint,
          tableName: entry.tableName,
          paramsSummary: this.truncate(entry.paramsSummary),
          rows: entry.rows,
          durationMs: entry.durationMs,
          ip: entry.ip,
          resultCode: entry.resultCode,
          createdAt: new Date(),
        })),
      })
    } catch (error) {
      this.logger.error(`审计批量落表失败（${batch.length} 条已丢弃）：${String(error)}`)
    } finally {
      this.flushing = false
    }
  }

  private truncate(summary: string | null): string | null {
    if (!summary) return null
    return summary.length > SUMMARY_MAX ? summary.slice(0, SUMMARY_MAX) : summary
  }
}
