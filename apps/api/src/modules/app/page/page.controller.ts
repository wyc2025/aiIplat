import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../../gateway/decorators/current-user.decorator'
import { OperationLog } from '../../../gateway/decorators/operation-log.decorator'
import { CreatePageDto, PageActionDto, UpdatePageDto } from './dto/page.dto'
import { PageService } from './page.service'

/**
 * 功能页管理（P11 T104，API-P11 §1.3）。
 * 全部登录态、属主自服务口径；写操作挂 @OperationLog。
 */
@ApiTags('应用平台-功能页')
@ApiBearerAuth()
@Controller('app')
export class PageController {
  constructor(private readonly pageService: PageService) {}

  @Get(':code/pages')
  @ApiParam({ name: 'code', description: '应用 code' })
  @ApiOperation({ summary: '功能页列表（code/name/route/genBy/sort）' })
  list(@CurrentUser('userId') userId: string, @Param('code') code: string) {
    return this.pageService.list(BigInt(userId), code)
  }

  @Post(':code/pages')
  @OperationLog('应用中心', '新建功能页')
  @ApiParam({ name: 'code', description: '应用 code' })
  @ApiOperation({ summary: '新建（schema 过校验，失败 50004；route 重复 50007；超 50 页 50002）' })
  create(
    @CurrentUser('userId') userId: string,
    @Param('code') code: string,
    @Body() dto: CreatePageDto,
  ) {
    return this.pageService.create(BigInt(userId), code, dto)
  }

  @Put(':code/pages/:pid')
  @OperationLog('应用中心', '修改功能页')
  @ApiParam({ name: 'code', description: '应用 code' })
  @ApiOperation({ summary: '更新 schema/name/sort' })
  update(
    @CurrentUser('userId') userId: string,
    @Param('code') code: string,
    @Param('pid', ParseIntPipe) pid: number,
    @Body() dto: UpdatePageDto,
  ) {
    return this.pageService.update(BigInt(userId), code, BigInt(pid), dto)
  }

  @Delete(':code/pages/:pid')
  @OperationLog('应用中心', '删除功能页')
  @ApiParam({ name: 'code', description: '应用 code' })
  @ApiOperation({ summary: '软删功能页' })
  remove(
    @CurrentUser('userId') userId: string,
    @Param('code') code: string,
    @Param('pid', ParseIntPipe) pid: number,
  ) {
    return this.pageService.remove(BigInt(userId), code, BigInt(pid))
  }
}

/**
 * 功能页动作执行（P11 T104，API-P11 §1.4 action）。
 * 与 DataController 同前缀 `/app/data`（路径 `action` 不冲突）：多步写整体事务（R90）。
 */
@ApiTags('应用平台-沙箱数据')
@ApiBearerAuth()
@Controller('app/data')
export class PageActionController {
  constructor(private readonly pageService: PageService) {}

  @Post('action')
  @OperationLog('应用中心', '执行页面动作')
  @ApiOperation({ summary: '执行页面动作（多步 $transaction；action 未声明 50010；失败整体回滚）' })
  action(@CurrentUser('userId') userId: string, @Body() dto: PageActionDto) {
    return this.pageService.executeAction(BigInt(userId), dto)
  }
}
