import { Body, Controller, Get, Post, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../../gateway/decorators/current-user.decorator'
import { DataQueryDto, RecordQueryDto } from './dto/data.dto'
import { DataService } from './data.service'

/**
 * 沙箱数据出口（P11 T103，API-P11 §1.4）：查询白名单 DSL + 单行取数。
 * 动作执行端点（/app/data/action）在 page 模块（T104），与本控制器同前缀不同路径。
 */
@ApiTags('应用平台-沙箱数据')
@ApiBearerAuth()
@Controller('app/data')
export class DataController {
  constructor(private readonly dataService: DataService) {}

  @Post('query')
  @ApiOperation({ summary: '查询（op=list/get/count；越权表 50001；超护栏 50009）' })
  query(@CurrentUser('userId') userId: string, @Body() dto: DataQueryDto) {
    return this.dataService.query(BigInt(userId), dto)
  }

  @Get('record')
  @ApiOperation({ summary: '单行取数（get 语义糖）' })
  record(@CurrentUser('userId') userId: string, @Query() dto: RecordQueryDto) {
    return this.dataService.getRecord(BigInt(userId), dto)
  }
}
