import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../../gateway/decorators/current-user.decorator'
import { OperationLog } from '../../../gateway/decorators/operation-log.decorator'
import { RequirePermission } from '../../../gateway/decorators/require-permission.decorator'
import {
  ShareCreateDto,
  ShareExtendDto,
  ShareListQueryDto,
  SharePasswordDto,
  ShareStopDto,
} from './dto/share.dto'
import { ShareService } from './share.service'

/** 分享链接（管理侧，登录；cloud:share:*） */
@ApiTags('云盘-分享链接')
@ApiBearerAuth()
@Controller('cloud/share')
export class ShareController {
  constructor(private readonly shareService: ShareService) {}

  @Post('create')
  @RequirePermission('cloud:share:create')
  @OperationLog('云盘', '创建分享链接')
  @ApiOperation({ summary: '创建分享（文件/文件夹 + 审核门禁 + 可选提取码；重复创建返回现存链接）' })
  create(@CurrentUser('userId') userId: string, @Body() dto: ShareCreateDto) {
    return this.shareService.create(BigInt(userId), dto)
  }

  @Get('list')
  @RequirePermission('cloud:share:list')
  @ApiOperation({ summary: '我的分享（不分页；含 itemType/hasPassword；status 缺省排除已停止）' })
  list(@CurrentUser('userId') userId: string, @Query() query: ShareListQueryDto) {
    return this.shareService.list(BigInt(userId), query)
  }

  @Post('stop')
  @RequirePermission('cloud:share:stop')
  @OperationLog('云盘', '停止分享链接')
  @ApiOperation({ summary: '停止分享（链接即刻失效）' })
  stop(@CurrentUser('userId') userId: string, @Body() dto: ShareStopDto) {
    return this.shareService.stop(BigInt(userId), BigInt(dto.id))
  }

  @Post('extend')
  @RequirePermission('cloud:share:stop')
  @OperationLog('云盘', '延长分享链接')
  @ApiOperation({ summary: '延长时间（从 max(now, expireAt) 续档；已停止不可延长）' })
  extend(@CurrentUser('userId') userId: string, @Body() dto: ShareExtendDto) {
    return this.shareService.extend(BigInt(userId), dto)
  }

  /** 修改/移除提取码（P4d D47）：复用 cloud:share:create 权限（分享内容的创建/编辑一体） */
  @Post(':id/password')
  @RequirePermission('cloud:share:create')
  @OperationLog('云盘', '修改分享提取码')
  @ApiOperation({ summary: '修改 / 移除提取码（body.password 为空 = 移除；旧访问凭证立即失效）' })
  updatePassword(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SharePasswordDto,
  ) {
    return this.shareService.updatePassword(BigInt(userId), BigInt(id), dto)
  }
}
