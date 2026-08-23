import { Controller, Get } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { DashboardService } from './dashboard.service'

/** 工作台聚合查询：所有登录用户的落地页（common 角色仅可见 dashboard），不挂权限标识 */
@ApiTags('首页工作台')
@ApiBearerAuth()
@Controller('system/dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('stats')
  @ApiOperation({ summary: '统计卡片（用户总数/角色总数/今日登录/今日操作）' })
  getStats() {
    return this.dashboardService.getStats()
  }

  @Get('login-trend')
  @ApiOperation({ summary: '近 7 天登录趋势（按日计数）' })
  getLoginTrend() {
    return this.dashboardService.getLoginTrend()
  }
}
