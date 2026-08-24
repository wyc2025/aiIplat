import { Controller, Delete, Get, Param, ParseIntPipe } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../../gateway/decorators/current-user.decorator'
import { OperationLog } from '../../../gateway/decorators/operation-log.decorator'
import { RequirePermission } from '../../../gateway/decorators/require-permission.decorator'
import { OnlineService } from './online.service'

/** 在线用户（admin，走正常 RBAC system:online:*） */
@ApiTags('系统管理')
@ApiBearerAuth()
@Controller('system/online')
export class OnlineController {
  constructor(private readonly onlineService: OnlineService) {}

  @Get()
  @RequirePermission('system:online:list')
  @ApiOperation({ summary: '在线用户列表（Redis 实时观察，不分页）' })
  list() {
    return this.onlineService.list()
  }

  @Delete(':userId')
  @RequirePermission('system:online:kick')
  @OperationLog('在线用户', '踢下线')
  @ApiOperation({ summary: '踢下线（复用改密码全端下线机制）' })
  kick(
    @Param('userId', ParseIntPipe) userId: number,
    @CurrentUser('userId') operatorUserId: string,
  ) {
    return this.onlineService.kick(BigInt(userId), operatorUserId)
  }
}
