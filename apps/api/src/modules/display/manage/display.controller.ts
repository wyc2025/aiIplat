import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../../gateway/decorators/current-user.decorator'
import { OperationLog } from '../../../gateway/decorators/operation-log.decorator'
import { AffiliateDisplayDto, CreateDisplayDto, GrantDisplayDto } from './dto/display.dto'
import { DisplayService } from './display.service'

/**
 * 展示应用后管端点（P14 T128，API-P14 §21.1-1~6）。
 *
 * 登录态 + **属主自服务**（无 `@RequirePermission`，照 P12/P13 同口径）；写操作挂 `@OperationLog`。
 * 管理面最小集：列表 / 创建 / 挂靠·换挂靠 / 软删 / 授权 / 撤权；「按站点批量授权」由前端展开为逐对授权
 * （D114：一个展示应用一个站点，批量 = 对该站点下每个展示应用各调一次授权）。
 */
@ApiTags('应用平台-展示应用')
@ApiBearerAuth()
@Controller('display')
export class DisplayController {
  constructor(private readonly displayService: DisplayService) {}

  @Get()
  @ApiOperation({ summary: '我的展示应用列表（含挂靠站点、开放层入口与授权清单）' })
  list(@CurrentUser('userId') userId: string) {
    return this.displayService.list(BigInt(userId))
  }

  @Post()
  @OperationLog('展示应用', '创建展示应用')
  @ApiOperation({ summary: '创建展示应用（重名 50018；siteSlug 缺省 → 暂存区）' })
  create(@CurrentUser('userId') userId: string, @Body() dto: CreateDisplayDto) {
    return this.displayService.create(BigInt(userId), {
      name: dto.name,
      ...(dto.siteSlug ? { siteSlug: dto.siteSlug } : {}),
    })
  }

  @Put(':id/affiliate')
  @OperationLog('展示应用', '挂靠/换挂靠站点')
  @ApiParam({ name: 'id', description: '展示应用 id' })
  @ApiOperation({ summary: '挂靠 / 换挂靠 / 取消挂靠（目录移动 + 关系更新；中断全回滚，R127）' })
  affiliate(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AffiliateDisplayDto,
  ) {
    return this.displayService.affiliate(BigInt(userId), BigInt(id), dto.siteSlug ?? null)
  }

  @Delete(':id')
  @OperationLog('展示应用', '删除展示应用')
  @ApiParam({ name: 'id', description: '展示应用 id' })
  @ApiOperation({ summary: '软删展示应用（清授权；目录保留于云盘由用户处置）' })
  remove(@CurrentUser('userId') userId: string, @Param('id', ParseIntPipe) id: number) {
    return this.displayService.remove(BigInt(userId), BigInt(id))
  }

  @Post(':id/grants')
  @OperationLog('展示应用', '授权数据应用')
  @ApiParam({ name: 'id', description: '展示应用 id' })
  @ApiOperation({ summary: '授权数据应用（重复 50017；未发布应用返回提示但仍授权）' })
  grant(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: GrantDisplayDto,
  ) {
    return this.displayService.grant(BigInt(userId), BigInt(id), dto.appCode)
  }

  @Delete(':id/grants/:appCode')
  @OperationLog('展示应用', '撤销数据应用授权')
  @ApiParam({ name: 'id', description: '展示应用 id' })
  @ApiParam({ name: 'appCode', description: '数据应用 code' })
  @ApiOperation({ summary: '撤销授权（授权不存在 50017；立即失效取数面缓存）' })
  revoke(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Param('appCode') appCode: string,
  ) {
    return this.displayService.revoke(BigInt(userId), BigInt(id), appCode)
  }
}
