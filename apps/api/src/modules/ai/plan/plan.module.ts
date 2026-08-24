import { Module } from '@nestjs/common'
import { CreditModule } from '../credit/credit.module'
import { PlanAdminController } from './plan-admin.controller'
import { PlanController } from './plan.controller'
import { PlanService } from './plan.service'
import { PlanTask } from './plan.task'

@Module({
  imports: [CreditModule],
  controllers: [PlanController, PlanAdminController],
  providers: [PlanService, PlanTask],
  exports: [PlanService],
})
export class PlanModule {}
