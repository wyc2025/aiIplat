import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../../gateway/decorators/current-user.decorator'
import { OperationLog } from '../../../gateway/decorators/operation-log.decorator'
import { RequirePermission } from '../../../gateway/decorators/require-permission.decorator'
import { ColumnQueryDto, ColumnSitesDto, CreateColumnDto, UpdateColumnDto } from './dto/column.dto'
import { SiteColumnService } from './column.service'

/**
 * 栏目管理（site:column:*，API.md §6.2；P7 D73 内容池化）：
 * 平铺裸数组由前端组树；list/create 为用户级（不再带 siteId），栏目在哪些站展示由 :id/sites 控制；
 * update/delete 按实体反查 user_id；写操作挂 @OperationLog。
 */
@ApiTags('个人网站-栏目管理')
@ApiBearerAuth()
@Controller('site/column')
export class SiteColumnController {
  constructor(private readonly columnService: SiteColumnService) {}

  @Get('list')
  @RequirePermission('site:column:list')
  @ApiOperation({
    summary: '栏目平铺列表（P7 用户级；含 articleCount 与可见站点 sites，前端组树）',
  })
  list(@CurrentUser('userId') userId: string, @Query() _query: ColumnQueryDto) {
    return this.columnService.list(BigInt(userId))
  }

  @Post()
  @RequirePermission('site:column:create')
  @OperationLog('个人网站', '新增栏目')
  @ApiOperation({ summary: '新增栏目（body siteIds 缺省 = 全部站点可见；≤3 级，R6）' })
  create(@CurrentUser('userId') userId: string, @Body() dto: CreateColumnDto) {
    return this.columnService.create(BigInt(userId), dto)
  }

  @Put(':id')
  @RequirePermission('site:column:update')
  @OperationLog('个人网站', '编辑栏目')
  @ApiOperation({ summary: '编辑栏目（换父级禁止指向自身/后代，且不得超 3 级）' })
  update(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateColumnDto,
  ) {
    return this.columnService.update(BigInt(userId), BigInt(id), dto)
  }

  /** 替换式管理「栏目 → 站点显隐」（P7 API §14.2）：提交集合 = 最终集合；空数组 = 全站不展示 */
  @Put(':id/sites')
  @RequirePermission('site:column:update')
  @OperationLog('个人网站', '管理栏目站点显隐')
  @ApiOperation({ summary: '替换式管理栏目在哪些站点展示' })
  setSites(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ColumnSitesDto,
  ) {
    return this.columnService.setSites(BigInt(userId), BigInt(id), dto)
  }

  @Delete(':id')
  @RequirePermission('site:column:delete')
  @OperationLog('个人网站', '删除栏目')
  @ApiOperation({ summary: '删除栏目（有子栏目或文章 → 40107）' })
  remove(@CurrentUser('userId') userId: string, @Param('id', ParseIntPipe) id: number) {
    return this.columnService.remove(BigInt(userId), BigInt(id))
  }
}
