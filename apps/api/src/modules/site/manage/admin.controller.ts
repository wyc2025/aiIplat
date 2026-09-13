import { Body, Controller, Get, Put, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { OperationLog } from '../../../gateway/decorators/operation-log.decorator'
import { RequirePermission } from '../../../gateway/decorators/require-permission.decorator'
import { SiteQuotaQueryDto, UpdateSiteQuotaDto } from './dto/site-admin.dto'
import { SiteManageService } from './manage.service'

/**
 * 站点配额管理（admin，API-P4E §10.4）：权限 site:admin:quota（超管 `*` 自动覆盖，common 不授）。
 * 照 cloud 域 cloud/admin 先例；与站点 CRUD 的 `/api/site/manage/*` 分属不同命名空间，互不遮挡。
 */
@ApiTags('个人网站-站点配额（管理员）')
@ApiBearerAuth()
@Controller('site/admin')
export class SiteAdminController {
  constructor(private readonly manageService: SiteManageService) {}

  @Get('quota')
  @RequirePermission('site:admin:quota')
  @ApiOperation({ summary: '查询用户站点配额（limit/used，used = 当前站点数）' })
  getQuota(@Query() query: SiteQuotaQueryDto) {
    return this.manageService.adminGetQuota(query.userId)
  }

  @Put('quota')
  @RequirePermission('site:admin:quota')
  @OperationLog('个人网站', '调整站点配额')
  @ApiOperation({ summary: '调整用户站点配额（下限 = 该用户当前站点数，R48）' })
  updateQuota(@Body() dto: UpdateSiteQuotaDto) {
    return this.manageService.adminUpdateQuota(dto.userId, dto.limit)
  }
}
