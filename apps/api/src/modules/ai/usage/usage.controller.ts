import { Controller, Get, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../../gateway/decorators/current-user.decorator'
import { UsageService } from './usage.service'
import { MyUsageQueryDto } from './dto/usage.dto'

/** 用量（用户侧，登录即可） */
@ApiTags('AI 助手')
@ApiBearerAuth()
@Controller('ai/usage')
export class UsageController {
  constructor(private readonly usageService: UsageService) {}

  @Get('mine')
  @ApiOperation({ summary: '我的用量明细' })
  mine(@CurrentUser('userId') userId: string, @Query() query: MyUsageQueryDto) {
    return this.usageService.mine(BigInt(userId), query)
  }
}
