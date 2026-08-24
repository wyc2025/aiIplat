import { Controller, Get, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { RequirePermission } from '../../../gateway/decorators/require-permission.decorator'
import { UsageService } from './usage.service'
import { AdminUsageQueryDto } from './dto/usage.dto'

/** 用量明细（admin，走正常 RBAC ai:usage:list） */
@ApiTags('AI 管理')
@ApiBearerAuth()
@Controller('ai/admin/usage')
export class UsageAdminController {
  constructor(private readonly usageService: UsageService) {}

  @Get()
  @RequirePermission('ai:usage:list')
  @ApiOperation({ summary: '全量用量明细（含汇总）' })
  page(@Query() query: AdminUsageQueryDto) {
    return this.usageService.adminPage(query)
  }
}
