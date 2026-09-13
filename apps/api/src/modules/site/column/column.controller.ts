import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../../gateway/decorators/current-user.decorator'
import { OperationLog } from '../../../gateway/decorators/operation-log.decorator'
import { RequirePermission } from '../../../gateway/decorators/require-permission.decorator'
import { ColumnQueryDto, CreateColumnDto, UpdateColumnDto } from './dto/column.dto'
import { SiteColumnService } from './column.service'

/**
 * 栏目管理（site:column:*，API.md §6.2；P4E T61 siteId 作用域化）：
 * 平铺裸数组由前端组树；list/create 必带 siteId；update/delete 按实体反查属主；写操作挂 @OperationLog。
 */
@ApiTags('个人网站-栏目管理')
@ApiBearerAuth()
@Controller('site/column')
export class SiteColumnController {
  constructor(private readonly columnService: SiteColumnService) {}

  @Get('list')
  @RequirePermission('site:column:list')
  @ApiOperation({ summary: '栏目平铺列表（必带 siteId；含 articleCount，前端组树）' })
  list(@CurrentUser('userId') userId: string, @Query() query: ColumnQueryDto) {
    return this.columnService.list(BigInt(userId), BigInt(query.siteId))
  }

  @Post()
  @RequirePermission('site:column:create')
  @OperationLog('个人网站', '新增栏目')
  @ApiOperation({ summary: '新增栏目（body 带 siteId；≤3 级，R6）' })
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

  @Delete(':id')
  @RequirePermission('site:column:delete')
  @OperationLog('个人网站', '删除栏目')
  @ApiOperation({ summary: '删除栏目（有子栏目或文章 → 40107）' })
  remove(@CurrentUser('userId') userId: string, @Param('id', ParseIntPipe) id: number) {
    return this.columnService.remove(BigInt(userId), BigInt(id))
  }
}
