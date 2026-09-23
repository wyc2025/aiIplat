import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { AdminService } from './admin.service'

/**
 * 应用生命周期清理 cron（P11 T101，R91 + 软删 30 天物理清理）：
 * - 04:00 清理过期草稿（draft 超过 APP_DRAFT_TTL_DAYS 未确认 → 软删）
 * - 04:30 物理清理软删超期应用（deleted_at 早于 now-30 天 → 删记录/引用/结构/主档）
 *
 * 薄壳设计（照 RecycleCleanTask / PlanTask 先例）：编排链落在 AdminService，
 * 本文件只负责定时触发与日志。可手动调用 AdminService 同名方法验证。
 */
@Injectable()
export class AppCleanTask {
  private readonly logger = new Logger(AppCleanTask.name)

  constructor(private readonly adminService: AdminService) {}

  @Cron('0 0 4 * * *')
  async handleDraftClean(): Promise<void> {
    const stats = await this.adminService.cleanExpiredDrafts()
    this.logger.log(`应用草稿清理完成：扫描 ${stats.scanned} 个 / 软删 ${stats.cleaned} 个`)
  }

  @Cron('0 30 4 * * *')
  async handleDeletedAppPurge(): Promise<void> {
    const stats = await this.adminService.purgeDeletedApps()
    this.logger.log(`应用数据物理清理完成：${stats.purged} 个软删超期应用`)
  }
}
