import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../../gateway/decorators/current-user.decorator'
import { OperationLog } from '../../../gateway/decorators/operation-log.decorator'
import { AdminService } from './admin.service'
import { CreateAppDto, ListAppQueryDto, UpdateAppDto } from './dto/admin.dto'

/**
 * 数据应用管理（P11 T101，API-P11 §1.1）。
 *
 * 全部登录态（@CurrentUser），属主自服务口径：**无 @RequirePermission**（同云盘），
 * 属主校验统一 50001（应用不存在或无权）；写操作挂 @OperationLog。
 * 路由顺序：`@Get()` 声明在 `@Get(':code')` 之前（控制器内声明顺序确定匹配优先级）。
 */
@ApiTags('应用平台-应用管理')
@ApiBearerAuth()
@Controller('app')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Post()
  @OperationLog('应用中心', '创建应用')
  @ApiOperation({ summary: '创建数据应用（blank=直接 active 占额度；draft=AI 草稿限 3 个）' })
  create(@CurrentUser('userId') userId: string, @Body() dto: CreateAppDto) {
    return this.adminService.create(BigInt(userId), dto)
  }

  @Get()
  @ApiOperation({ summary: '我的应用列表（不分页，附统计数字）；?status=draft 只看草稿' })
  list(@CurrentUser('userId') userId: string, @Query() query: ListAppQueryDto) {
    return this.adminService.list(BigInt(userId), query)
  }

  @Get(':code')
  @ApiParam({ name: 'code', description: '应用 code' })
  @ApiOperation({ summary: '应用详情（含统计数字；无权/不存在 50001）' })
  detail(@CurrentUser('userId') userId: string, @Param('code') code: string) {
    return this.adminService.detail(BigInt(userId), code)
  }

  @Put(':code')
  @OperationLog('应用中心', '编辑应用')
  @ApiParam({ name: 'code', description: '应用 code' })
  @ApiOperation({ summary: '改名称/描述' })
  update(
    @CurrentUser('userId') userId: string,
    @Param('code') code: string,
    @Body() dto: UpdateAppDto,
  ) {
    return this.adminService.update(BigInt(userId), code, dto)
  }

  @Delete(':code')
  @OperationLog('应用中心', '删除应用')
  @ApiParam({ name: 'code', description: '应用 code' })
  @ApiOperation({ summary: '软删应用（级联软删表/字段/页；数据保留 30 天后物理清理）' })
  remove(@CurrentUser('userId') userId: string, @Param('code') code: string) {
    return this.adminService.remove(BigInt(userId), code)
  }

  @Post(':code/confirm')
  @OperationLog('应用中心', '确认应用草稿')
  @ApiParam({ name: 'code', description: '应用 code' })
  @ApiOperation({ summary: 'draft → active（确认入册，查配额；草稿过期/不存在 50008）' })
  confirm(@CurrentUser('userId') userId: string, @Param('code') code: string) {
    return this.adminService.confirm(BigInt(userId), code)
  }
}
