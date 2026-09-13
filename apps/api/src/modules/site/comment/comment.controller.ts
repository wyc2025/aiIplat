import { Body, Controller, Delete, Get, Param, ParseIntPipe, Put, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../../gateway/decorators/current-user.decorator'
import { OperationLog } from '../../../gateway/decorators/operation-log.decorator'
import { RequirePermission } from '../../../gateway/decorators/require-permission.decorator'
import { AuditCommentDto, CommentQueryDto } from './dto/comment.dto'
import { SiteCommentService } from './comment.service'

/** 评论管理（site:comment:*，API.md §6.2） */
@ApiTags('个人网站-评论管理')
@ApiBearerAuth()
@Controller('site/comment')
export class SiteCommentController {
  constructor(private readonly commentService: SiteCommentService) {}

  @Get()
  @RequirePermission('site:comment:list')
  @ApiOperation({ summary: '评论分页列表（必带 siteId；筛选：审核状态/文章/昵称关键词）' })
  list(@CurrentUser('userId') userId: string, @Query() query: CommentQueryDto) {
    return this.commentService.list(BigInt(userId), query)
  }

  @Put(':id/audit')
  @RequirePermission('site:comment:audit')
  @OperationLog('个人网站', '审核评论')
  @ApiOperation({ summary: '审核评论（1 通过 / 2 驳回）' })
  audit(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AuditCommentDto,
  ) {
    return this.commentService.audit(BigInt(userId), BigInt(id), dto)
  }

  @Delete(':id')
  @RequirePermission('site:comment:delete')
  @OperationLog('个人网站', '删除评论')
  @ApiOperation({ summary: '物理删除评论' })
  remove(@CurrentUser('userId') userId: string, @Param('id', ParseIntPipe) id: number) {
    return this.commentService.remove(BigInt(userId), BigInt(id))
  }
}
