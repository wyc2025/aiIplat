import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../../gateway/decorators/current-user.decorator'
import { OperationLog } from '../../../gateway/decorators/operation-log.decorator'
import { RequirePermission } from '../../../gateway/decorators/require-permission.decorator'
import { CreateTagDto, SaveTagDto, TagQueryDto } from './dto/tag.dto'
import { SiteTagService } from './tag.service'

/**
 * 标签管理（site:tag:*，API.md §6.2；P4E T61 siteId 作用域化）：
 * list/create 必带 siteId；update/delete 按实体反查属主。
 */
@ApiTags('个人网站-标签管理')
@ApiBearerAuth()
@Controller('site/tag')
export class SiteTagController {
  constructor(private readonly tagService: SiteTagService) {}

  @Get('list')
  @RequirePermission('site:tag:list')
  @ApiOperation({ summary: '标签列表（必带 siteId；含 articleCount）' })
  list(@CurrentUser('userId') userId: string, @Query() query: TagQueryDto) {
    return this.tagService.list(BigInt(userId), BigInt(query.siteId))
  }

  @Post()
  @RequirePermission('site:tag:create')
  @OperationLog('个人网站', '新增标签')
  @ApiOperation({ summary: '新增标签（body 带 siteId；同站重名 → 40108）' })
  create(@CurrentUser('userId') userId: string, @Body() dto: CreateTagDto) {
    return this.tagService.create(BigInt(userId), dto)
  }

  @Put(':id')
  @RequirePermission('site:tag:update')
  @OperationLog('个人网站', '编辑标签')
  @ApiOperation({ summary: '编辑标签（按实体反查属主）' })
  update(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveTagDto,
  ) {
    return this.tagService.update(BigInt(userId), BigInt(id), dto)
  }

  @Delete(':id')
  @RequirePermission('site:tag:delete')
  @OperationLog('个人网站', '删除标签')
  @ApiOperation({ summary: '删除标签（连带删文章-标签关联）' })
  remove(@CurrentUser('userId') userId: string, @Param('id', ParseIntPipe) id: number) {
    return this.tagService.remove(BigInt(userId), BigInt(id))
  }
}
