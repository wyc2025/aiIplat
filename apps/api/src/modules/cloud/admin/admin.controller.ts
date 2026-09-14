import { Controller, Get, Put, Body, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { RequirePermission } from '../../../gateway/decorators/require-permission.decorator'
import { OperationLog } from '../../../gateway/decorators/operation-log.decorator'
import { AdminService } from './admin.service'
import { ReconcileUsageDto, UpdateQuotaDto } from './dto/quota.dto'

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

  /** 配额对账诊断（只读）：公式三项明细 + 存储值 + 差额（P4F T68/R60） */
  @Get('usage-reconcile')
  @RequirePermission('cloud:admin:quota')
  @ApiOperation({ summary: '配额对账诊断（userId 缺省 = 全用户）' })
  reconcileUsage(@Query('userId') userId?: string) {
    return this.adminService.reconcileUsage(userId)
  }

  /** 配额对账修正：显式把 used 写成公式重算值（P4F T68/R61） */
  @Put('usage-reconcile')
  @RequirePermission('cloud:admin:quota')
  @OperationLog('云盘', '配额对账修正')
  @ApiOperation({ summary: '配额对账修正（used = 公式重算值）' })
  reconcileFix(@Body() dto: ReconcileUsageDto) {
    return this.adminService.reconcileFix(dto)
  }
}
