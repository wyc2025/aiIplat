import { Body, Controller, Get, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../../gateway/decorators/current-user.decorator'
import { OperationLog } from '../../../gateway/decorators/operation-log.decorator'
import { PlanService } from './plan.service'
import { SubscribePlanDto } from './dto/plan.dto'

/** 套餐（用户侧，登录即可，不挂 @RequirePermission） */
@ApiTags('AI 助手')
@ApiBearerAuth()
@Controller('ai/plan')
export class PlanController {
  constructor(private readonly planService: PlanService) {}

  @Get('list')
  @ApiOperation({ summary: '启用中的套餐列表' })
  list() {
    return this.planService.availablePlans()
  }

  @Get('mine')
  @ApiOperation({ summary: '我的套餐与额度' })
  mine(@CurrentUser('userId') userId: string) {
    return this.planService.myPlan(BigInt(userId))
  }

  @Post('subscribe')
  @OperationLog('AI 套餐', '开通或切换套餐')
  @ApiOperation({ summary: '开通/切换套餐（立即生效，本期无真实支付）' })
  subscribe(@CurrentUser('userId') userId: string, @Body() dto: SubscribePlanDto) {
    return this.planService.subscribe(BigInt(userId), dto)
  }
}
