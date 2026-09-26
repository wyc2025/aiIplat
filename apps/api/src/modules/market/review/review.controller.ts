import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../../gateway/decorators/current-user.decorator'
import { OperationLog } from '../../../gateway/decorators/operation-log.decorator'
import { RequirePermission } from '../../../gateway/decorators/require-permission.decorator'
import { ReviewService } from './review.service'
import { ReviewListingDto } from './dto/review.dto'

/**
 * 应用市场审核面（P13 T119，R121，API §20.1 审核侧）。
 *
 * `market:review` 权限（admin 角色内置全权限即可见）+ 全部写动作挂 @OperationLog。
 */
@ApiTags('应用平台-市场审核')
@ApiBearerAuth()
@Controller('market/review')
export class ReviewController {
  constructor(private readonly reviewService: ReviewService) {}

  @Get('list')
  @RequirePermission('market:review')
  @ApiOperation({ summary: '审核列表（含快照摘要）；?status=pending（默认，FIFO）| approved（在架，供下架）' })
  list(@Query('status') status?: string) {
    return this.reviewService.list(status)
  }

  @Post(':id')
  @RequirePermission('market:review')
  @OperationLog('市场审核', '审核市场条目')
  @ApiParam({ name: 'id', description: '市场条目 id' })
  @ApiOperation({ summary: '审核动作（approve / reject 必填 note / delist）' })
  review(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReviewListingDto,
  ) {
    return this.reviewService.review(BigInt(userId), BigInt(id), dto)
  }
}
