import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Cron } from '@nestjs/schedule'
import { RecycleService } from './recycle.service'

/**
 * 回收站自动清理 cron（P4F T67 / D58 / R58 / R59）：每日 03:30 固定执行（不做表达式配置）。
 *
 * - 总开关 `CLOUD_RECYCLE_CLEAN_ENABLED`（默认开）：关闭时空跑，只记一条日志
 * - 保留天数 `CLOUD_RECYCLE_RETENTION_DAYS`（默认 30）：`deleted_at` 早于 now-N 天的行一律清除
 * - 编排链落在 `RecycleService.cleanExpired`（分值扫描 + 顶层归集 + 复用彻底删除链），
 *   本文件保持薄壳（照 P2a `PlanTask → CreditService.resetExpiredCycles` 先例），
 *   避免把 Prisma 查询与删除逻辑写进 cron 文件。
 */
@Injectable()
export class RecycleCleanTask {
  private readonly logger = new Logger(RecycleCleanTask.name)

  constructor(
    private readonly config: ConfigService,
    private readonly recycleService: RecycleService,
  ) {}

  @Cron('0 30 3 * * *')
  async handleRecycleClean(): Promise<void> {
    if (!this.config.get<boolean>('upload.cloudRecycleCleanEnabled', true)) {
      this.logger.log('回收站自动清理：开关关闭（CLOUD_RECYCLE_CLEAN_ENABLED），本轮跳过')
      return
    }

    const retentionDays = this.config.get<number>('upload.cloudRecycleRetentionDays', 30)
    const stats = await this.recycleService.cleanExpired(retentionDays)
    this.logger.log(
      `回收站自动清理完成（保留 ${retentionDays} 天）：扫描 ${stats.scanned} 行 / 清除 ${stats.purged} 项（含 ${stats.files} 个文件、${stats.bytes.toString()} 字节）/ 失败 ${stats.failed} 项`,
    )
  }
}
