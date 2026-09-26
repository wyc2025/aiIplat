import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../../gateway/decorators/current-user.decorator'
import { OperationLog } from '../../../gateway/decorators/operation-log.decorator'
import { ListingService } from './listing.service'
import { ListMarketQueryDto, SubmitListingDto } from './dto/listing.dto'

/**
 * 应用市场（用户侧，P13 T118，API §20.1）。
 *
 * 全部登录态（@CurrentUser），**无 @RequirePermission**（同云盘属主口径，R121）：
 * 提交/浏览/复制 = 普通登录用户；审核端点在 ReviewController（`market:review`）。
 * 路由顺序：`submissions` / `mine` / `list` 声明在 `:code` 之前（控制器内声明顺序确定匹配优先级）。
 */
@ApiTags('应用平台-应用市场')
@ApiBearerAuth()
@Controller('market')
export class MarketController {
  constructor(private readonly listingService: ListingService) {}

  @Post('submissions')
  @OperationLog('应用市场', '提交市场')
  @ApiOperation({
    summary: '提交应用上架（提交即物化结构快照；重复活跃条目 50013；演示数据超限 50015）',
  })
  submit(@CurrentUser('userId') userId: string, @Body() dto: SubmitListingDto) {
    return this.listingService.submit(BigInt(userId), dto)
  }

  @Get('mine')
  @ApiOperation({ summary: '我的提交（pending/approved/rejected/delisted 全状态，时间倒序）' })
  mine(@CurrentUser('userId') userId: string) {
    return this.listingService.listMine(BigInt(userId))
  }

  @Get('list')
  @ApiOperation({ summary: '市场列表（approved 且未下架，按上架时间倒序，分页 ≤50）' })
  list(@Query() query: ListMarketQueryDto) {
    return this.listingService.list(query)
  }

  @Get(':code')
  @ApiParam({ name: 'code', description: '市场条目编号' })
  @ApiOperation({ summary: '条目详情（元数据卡片 + 结构摘要）；不存在/未上架 50014' })
  detail(@Param('code') code: string) {
    return this.listingService.detail(code)
  }

  @Post(':code/copy')
  @OperationLog('应用市场', '复制应用')
  @ApiParam({ name: 'code', description: '市场条目编号' })
  @ApiOperation({ summary: '复制为我的新应用（结构 + 可选演示数据；配额满 50002，不可复制 50014）' })
  copy(@CurrentUser('userId') userId: string, @Param('code') code: string) {
    return this.listingService.copy(BigInt(userId), code)
  }
}
