import { Controller, Get, Put, Body, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { RequirePermission } from '../../../gateway/decorators/require-permission.decorator'
import { AdminService } from './admin.service'
import { UpdateQuotaDto } from './dto/quota.dto'

@ApiTags('云盘管理-管理员')
@ApiBearerAuth()
@Controller('cloud/admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  /** 调整用户配额（配额下限 = 当前已用容量） */
  @Put('quota')
  @RequirePermission('cloud:admin:quota')
  @ApiOperation({ summary: '调整用户配额（配额下限=当前已用容量）' })
  updateQuota(@Body() dto: UpdateQuotaDto) {
    return this.adminService.updateQuota(dto)
  }

  /** 查询用户配额（含已用容量，作为调整下限参考） */
  @Get('quota')
  @RequirePermission('cloud:admin:quota')
  @ApiOperation({ summary: '查询用户配额（含已用容量）' })
  getQuota(@Query('userId') userId: string) {
    return this.adminService.getQuota(userId)
  }

  /** 云盘全局统计 */
  @Get('stats')
  @RequirePermission('cloud:admin:quota')
  @ApiOperation({ summary: '云盘全局统计：文件数/总容量/活跃用户数' })
  getStats() {
    return this.adminService.getStats()
  }
}
