import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../../gateway/decorators/current-user.decorator'
import { OperationLog } from '../../../gateway/decorators/operation-log.decorator'
import { RequirePermission } from '../../../gateway/decorators/require-permission.decorator'
import { CreateSiteDto, UpdateSiteDto } from './dto/site.dto'
import { SiteManageService } from './manage.service'

/**
 * 站点 CRUD（PRD-P4E F1 / API-P4E §10.2）：权限 site:site:manage，数据按当前用户隔离（R1）。
 * 替代 P4a 的 `/api/site/mine` 单数系列（D52 无兼容期）。
 *
 * **命名空间 `/api/site/manage/*`（T65 后调整）**：站点级资源全部收在这里，
 * 使「GET/PUT/DELETE /api/site/manage/:id」三态对称，且 `/api/site/*` 顶层只剩静态段
 * （templates / column / tag / article / comment / admin）。
 *
 * 背景（为何不用 `GET /api/site/:id`）：Express 按注册顺序匹配，顶层参数段 `:id` 会吞掉所有
 * 「/site/ 下一段」的既有静态路由——`GET /api/site/article`（文章列表）、`/api/site/comment`
 * （评论列表）、`/api/site/templates` 会被 `:id` 命中并因 ParseIntPipe 直接 400，且这些控制器
 * 分布在不同模块、注册顺序不可控（详见 docs/PROGRESS.md 遗留 14）。
 *
 * 路由顺序：同一控制器内 `@Get('list')` 必须声明在 `@Get(':id')` 之前（控制器内声明顺序确定）。
 */
@ApiTags('个人网站-站点管理')
@ApiBearerAuth()
@Controller('site/manage')
export class SiteManageController {
  constructor(private readonly manageService: SiteManageService) {}

  @Get('list')
  @RequirePermission('site:site:manage')
  @ApiOperation({ summary: '我的站点列表（不分页，上限即配额）+ { limit, used }' })
  list(@CurrentUser('userId') userId: string) {
    return this.manageService.list(BigInt(userId))
  }

  @Post()
  @RequirePermission('site:site:manage')
  @OperationLog('个人网站', '创建站点')
  @ApiOperation({ summary: '创建站点（配额 40118 + slug 校验 + 建公开目录/media//模板，一气呵成）' })
  create(@CurrentUser('userId') userId: string, @Body() dto: CreateSiteDto) {
    return this.manageService.create(BigInt(userId), dto)
  }

  @Get(':id')
  @RequirePermission('site:site:manage')
  @ApiParam({ name: 'id', description: '站点 ID' })
  @ApiOperation({ summary: '站点详情（非属主 40119）' })
  detail(@CurrentUser('userId') userId: string, @Param('id', ParseIntPipe) id: number) {
    return this.manageService.detail(BigInt(userId), BigInt(id))
  }

  @Put(':id')
  @RequirePermission('site:site:manage')
  @OperationLog('个人网站', '编辑站点')
  @ApiParam({ name: 'id', description: '站点 ID' })
  @ApiOperation({ summary: '编辑站点（标题/描述/slug/启停/评论开关；改 slug 旧链接立即失效）' })
  update(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSiteDto,
  ) {
    return this.manageService.update(BigInt(userId), BigInt(id), dto)
  }

  @Delete(':id')
  @RequirePermission('site:site:manage')
  @OperationLog('个人网站', '删除站点')
  @ApiParam({ name: 'id', description: '站点 ID' })
  @ApiOperation({ summary: '删站（数据物理删 + 站点根软删进回收站 + slug 释放，R50/R53/R55）' })
  remove(@CurrentUser('userId') userId: string, @Param('id', ParseIntPipe) id: number) {
    return this.manageService.remove(BigInt(userId), BigInt(id))
  }
}
