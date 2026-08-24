import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { OperationLog } from '../../../gateway/decorators/operation-log.decorator'
import { RequirePermission } from '../../../gateway/decorators/require-permission.decorator'
import { PlanService } from './plan.service'
import { AssignPlanDto, CreatePlanDto, PlanQueryDto, UpdatePlanDto } from './dto/plan.dto'

/** 套餐管理（admin，走正常 RBAC ai:plan:*） */
@ApiTags('AI 管理')
@ApiBearerAuth()
@Controller('ai/admin/plan')
export class PlanAdminController {
  constructor(private readonly planService: PlanService) {}

  @Get()
  @RequirePermission('ai:plan:list')
  @ApiOperation({ summary: '套餐分页列表（含生效订阅数）' })
  page(@Query() query: PlanQueryDto) {
    return this.planService.adminPage(query)
  }

  @Post()
  @RequirePermission('ai:plan:create')
  @OperationLog('AI 套餐管理', '新增套餐')
  @ApiOperation({ summary: '新增套餐' })
  create(@Body() dto: CreatePlanDto) {
    return this.planService.create(dto)
  }

  @Put(':id')
  @RequirePermission('ai:plan:update')
  @OperationLog('AI 套餐管理', '编辑套餐')
  @ApiOperation({ summary: '编辑套餐' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdatePlanDto) {
    return this.planService.update(BigInt(id), dto)
  }

  @Delete(':id')
  @RequirePermission('ai:plan:delete')
  @OperationLog('AI 套餐管理', '删除套餐')
  @ApiOperation({ summary: '删除套餐（有生效订阅禁止）' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.planService.remove(BigInt(id))
  }

  @Post('assign')
  @RequirePermission('ai:plan:assign')
  @OperationLog('AI 套餐管理', '指派用户套餐')
  @ApiOperation({ summary: '指派用户套餐（立即生效）' })
  assign(@Body() dto: AssignPlanDto) {
    return this.planService.assign(dto)
  }
}
