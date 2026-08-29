import { Body, Controller, Get, Post, Put } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../../gateway/decorators/current-user.decorator'
import { OperationLog } from '../../../gateway/decorators/operation-log.decorator'
import { RequirePermission } from '../../../gateway/decorators/require-permission.decorator'
import { CreateSiteDto, UpdateSiteDto } from './dto/site.dto'
import { SiteManageService } from './manage.service'

/**
 * 站点设置（PRD F1 / API.md §6.2）：权限 site:site:manage，数据按当前用户隔离（R1）。
 * GET 未开通返回 data:null 引导创建；POST/PUT 挂 @OperationLog。
 */
@ApiTags('个人网站-站点设置')
@ApiBearerAuth()
@Controller('site')
export class SiteManageController {
  constructor(private readonly manageService: SiteManageService) {}

  @Get('mine')
  @RequirePermission('site:site:manage')
  @ApiOperation({ summary: '我的站点（未开通返回 null）' })
  getMine(@CurrentUser('userId') userId: string) {
    return this.manageService.getMine(BigInt(userId))
  }

  @Post('mine')
  @RequirePermission('site:site:manage')
  @OperationLog('个人网站', '创建站点')
  @ApiOperation({ summary: '创建站点（slug 校验 + 建公开目录 + media/ + 模板复制，一气呵成）' })
  create(@CurrentUser('userId') userId: string, @Body() dto: CreateSiteDto) {
    return this.manageService.create(BigInt(userId), dto)
  }

  @Put('mine')
  @RequirePermission('site:site:manage')
  @OperationLog('个人网站', '编辑站点')
  @ApiOperation({ summary: '编辑站点（标题/描述/slug/启停/评论开关；改 slug 旧链接立即失效）' })
  update(@CurrentUser('userId') userId: string, @Body() dto: UpdateSiteDto) {
    return this.manageService.update(BigInt(userId), dto)
  }
}
