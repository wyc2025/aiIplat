import { Body, Controller, Get, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../../gateway/decorators/current-user.decorator'
import { OperationLog } from '../../../gateway/decorators/operation-log.decorator'
import { RequirePermission } from '../../../gateway/decorators/require-permission.decorator'
import { ShareCreateDto, ShareExtendDto, ShareStopDto } from './dto/share.dto'
import { ShareService } from './share.service'

/** 公开链接（管理侧，登录；cloud:share:*） */
@ApiTags('云盘-公开链接')
@ApiBearerAuth()
@Controller('cloud/share')
export class ShareController {
  constructor(private readonly shareService: ShareService) {}

  @Post('create')
  @RequirePermission('cloud:share:create')
  @OperationLog('云盘', '创建分享链接')
  @ApiOperation({ summary: '创建分享（仅文件 + 审核门禁，重复创建返回现存链接）' })
  create(@CurrentUser('userId') userId: string, @Body() dto: ShareCreateDto) {
    return this.shareService.create(BigInt(userId), dto)
  }

  @Get('list')
  @RequirePermission('cloud:share:list')
  @ApiOperation({ summary: '我的分享（不分页，创建时间倒序）' })
  list(@CurrentUser('userId') userId: string) {
    return this.shareService.list(BigInt(userId))
  }

  @Post('stop')
  @RequirePermission('cloud:share:stop')
  @OperationLog('云盘', '停止公开链接')
  @ApiOperation({ summary: '停止公开（链接即刻失效）' })
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
}
