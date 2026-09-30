import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Cron } from '@nestjs/schedule'
import { AuditService } from './audit.service'

/**
 * 接入审计清理 cron（P15 T136，D122/R135）：每日 05:00 清除超保留期（默认 90 天）的流水。
 *
 * 薄壳设计（照 `RecycleCleanTask` / `AppCleanTask` 先例）：编排（分批删除）落在 `AuditService.cleanExpired`，
 * 本文件只负责定时触发与日志；可手动调用同名方法验证。
 */
@Injectable()
export class AccessCleanTask {
  private readonly logger = new Logger(AccessCleanTask.name)

  constructor(
    private readonly config: ConfigService,
    private readonly auditService: AuditService,
  ) {}

  @Cron('0 0 5 * * *')
  async handleAuditClean(): Promise<void> {
    const retentionDays = this.config.get<number>('access.auditRetentionDays', 90)
    const stats = await this.auditService.cleanExpired(retentionDays)
    this.logger.log(`接入审计清理完成（保留 ${retentionDays} 天）：清除 ${stats.deleted} 行`)
  }
}
