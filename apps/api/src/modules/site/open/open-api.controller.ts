import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, Req } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'
import { Public } from '../../../gateway/decorators/public.decorator'
import { SiteOpenService } from './open.service'
import { extractIp } from './rate-limit.util'
import { CreateOpenCommentDto, OpenArticlesQueryDto, OpenCommentPageDto } from './dto/open.dto'

/**
 * 开放数据 API v1（API.md §6.3，PRD D10）：/api/open/:slug/api/*，用户站点代码获取数据的唯一契约。
 * 全部 @Public 免登录；除评论提交外只读；资源类失败统一 40400（防探测）；限流 api 桶 60 次/分/IP、
 * 评论提交 10 次/分/IP + 同文章同 IP 60s 一条（40111）；禁挂 @OperationLog（D11）。
 * 路由顺序：本控制器必须先于 OpenStaticController 注册（§14.4），静态通配层首段 api 双保险兜底。
 */
@ApiTags('个人网站-开放数据')
@Controller('open')
export class OpenApiController {
  constructor(private readonly openService: SiteOpenService) {}

  @Public()
  @Get(':slug/api/site')
  @ApiOperation({ summary: '站点信息 { title, description }' })
  async siteInfo(@Param('slug') slug: string, @Req() req: Request) {
    await this.openService.assertApiRateLimit(extractIp(req))
    return this.openService.siteInfo(slug)
  }

  @Public()
  @Get(':slug/api/columns')
  @ApiOperation({ summary: '栏目嵌套树 [{ id, name, sort, children }]' })
  async columns(@Param('slug') slug: string, @Req() req: Request) {
    await this.openService.assertApiRateLimit(extractIp(req))
    return this.openService.columns(slug)
  }

  @Public()
  @Get(':slug/api/tags')
  @ApiOperation({ summary: '标签列表 [{ id, name }]' })
  async tags(@Param('slug') slug: string, @Req() req: Request) {
    await this.openService.assertApiRateLimit(extractIp(req))
    return this.openService.tags(slug)
  }

  @Public()
  @Get(':slug/api/articles')
  @ApiOperation({ summary: '文章分页（仅已发布，publishedAt 倒序；pageSize ≤50）' })
  async articles(@Param('slug') slug: string, @Query() query: OpenArticlesQueryDto, @Req() req: Request) {
    await this.openService.assertApiRateLimit(extractIp(req))
    return this.openService.articles(slug, query)
  }

  @Public()
  @Get(':slug/api/articles/:id')
  @ApiOperation({ summary: '文章详情（含 contentMd；触发查看数 R8 窗口去重）' })
  async articleDetail(
    @Param('slug') slug: string,
    @Param('id', ParseIntPipe) id: number,
    @Req() req: Request,
  ) {
    await this.openService.assertApiRateLimit(extractIp(req))
    return this.openService.articleDetail(slug, BigInt(id), extractIp(req))
  }

  @Public()
  @Get(':slug/api/articles/:id/comments')
  @ApiOperation({ summary: '评论分页（仅已过审，时间正序）' })
  async comments(
    @Param('slug') slug: string,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: OpenCommentPageDto,
    @Req() req: Request,
  ) {
    await this.openService.assertApiRateLimit(extractIp(req))
    return this.openService.comments(slug, BigInt(id), query)
  }

  @Public()
  @Post(':slug/api/articles/:id/comments')
  @ApiOperation({ summary: '提交评论（R9 限流；审核开关开 → 待审；成功统一文案）' })
  async submitComment(
    @Param('slug') slug: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateOpenCommentDto,
    @Req() req: Request,
  ) {
    return this.openService.submitComment(slug, BigInt(id), dto, extractIp(req))
  }
}
