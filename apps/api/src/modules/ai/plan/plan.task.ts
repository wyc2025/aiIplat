import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { CreditService } from '../credit/credit.service'

/**
 * 月度额度重置兜底 cron（每日 00:30）。
 * 懒重置（预检时就地重置）已覆盖正常路径，本 cron 用于扫描过期周期兜底，
 * 避免长时间未活跃用户的过期周期残留。
 */
@Injectable()
export class PlanTask {
  private readonly logger = new Logger(PlanTask.name)

  constructor(private readonly creditService: CreditService) {}

  @Cron('0 30 0 * * *')
  async handleMonthlyReset(): Promise<void> {
    const count = await this.creditService.resetExpiredCycles()
    if (count > 0) {
      this.logger.log(`月度额度重置完成，共重置 ${count} 个过期周期`)
    }
  }
}
