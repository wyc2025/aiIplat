import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../../gateway/decorators/current-user.decorator'
import { OperationLog } from '../../../gateway/decorators/operation-log.decorator'
import { RequirePermission } from '../../../gateway/decorators/require-permission.decorator'
import { SiteArticleService, ArticleQueryDto } from './article.service'
import {
  ArticleSitesDto,
  CreateArticleDto,
  UpdateArticleDto,
  UpdateArticleStatusDto,
} from './dto/article.dto'

/** 文章管理（site:article:*，API.md §6.2）；状态变更挂 site:article:publish */
@ApiTags('个人网站-文章管理')
@ApiBearerAuth()
@Controller('site/article')
export class SiteArticleController {
  constructor(private readonly articleService: SiteArticleService) {}

  @Get()
  @RequirePermission('site:article:list')
  @ApiOperation({
    summary: '文章分页列表（P7 用户级内容池；筛选：站点/栏目/标签/状态/标题关键词）',
  })
  list(@CurrentUser('userId') userId: string, @Query() query: ArticleQueryDto) {
    return this.articleService.list(BigInt(userId), query)
  }

  @Get(':id')
  @RequirePermission('site:article:list')
  @ApiOperation({ summary: '文章详情（附加 contentMd）' })
  detail(@CurrentUser('userId') userId: string, @Param('id', ParseIntPipe) id: number) {
    return this.articleService.detail(BigInt(userId), BigInt(id))
  }

  @Post()
  @RequirePermission('site:article:create')
  @OperationLog('个人网站', '新增文章')
  @ApiOperation({
    summary: '新建文章（body 带 siteIds 发表目标；字数 R14 / 摘要自动 / 封面 media/ 校验）',
  })
  create(@CurrentUser('userId') userId: string, @Body() dto: CreateArticleDto) {
    return this.articleService.create(BigInt(userId), dto)
  }

  @Put(':id')
  @RequirePermission('site:article:update')
  @OperationLog('个人网站', '编辑文章')
  @ApiOperation({ summary: '编辑文章（tagIds 整体重建；status 变更走发布状态机）' })
  update(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateArticleDto,
  ) {
    return this.articleService.update(BigInt(userId), BigInt(id), dto)
  }

  @Put(':id/status')
  @RequirePermission('site:article:publish')
  @OperationLog('个人网站', '发布/下架文章')
  @ApiOperation({ summary: '发布/下架（首次发布写发布时间，下架再上架不刷新）' })
  updateStatus(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateArticleStatusDto,
  ) {
    return this.articleService.updateStatus(BigInt(userId), BigInt(id), dto)
  }

  /**
   * 替换式管理「文章 → 发表站点」关联（P7 API §14.2）。
   * 提交集合 = 最终集合；空数组 = 全站下架（文章本体保留在内容池，随时可再发表）。
   */
  @Put(':id/sites')
  @RequirePermission('site:article:update')
  @OperationLog('个人网站', '管理文章发表站点')
  @ApiOperation({ summary: '替换式管理文章发表站点（含每站置顶）' })
  setSites(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ArticleSitesDto,
  ) {
    return this.articleService.setSites(BigInt(userId), BigInt(id), dto)
  }

  @Delete(':id')
  @RequirePermission('site:article:delete')
  @OperationLog('个人网站', '删除文章')
  @ApiOperation({ summary: '物理删除（连带发表关联/标签关联与评论，R7）' })
  remove(@CurrentUser('userId') userId: string, @Param('id', ParseIntPipe) id: number) {
    return this.articleService.remove(BigInt(userId), BigInt(id))
  }
}
