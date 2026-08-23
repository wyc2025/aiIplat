import { Controller, Get, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { RequirePermission } from '../../../gateway/decorators/require-permission.decorator'
import { LoginLogQueryDto, OperationLogQueryDto } from './dto/log.dto'
import { LogService } from './log.service'

@ApiTags('日志查询')
@ApiBearerAuth()
@Controller('system/log')
export class LogController {
  constructor(private readonly logService: LogService) {}

  @Get('login')
  @RequirePermission('system:log:login')
  @ApiOperation({ summary: '登录日志分页（按用户名/状态/时间）' })
  loginLogPage(@Query() query: LoginLogQueryDto) {
    return this.logService.loginLogPage(query)
  }

  @Get('operation')
  @RequirePermission('system:log:operation')
  @ApiOperation({ summary: '操作日志分页（按用户/模块/状态/时间）' })
  operationLogPage(@Query() query: OperationLogQueryDto) {
    return this.logService.operationLogPage(query)
  }
}
