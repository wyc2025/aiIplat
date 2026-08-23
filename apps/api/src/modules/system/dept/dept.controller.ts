import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { OperationLog } from '../../../gateway/decorators/operation-log.decorator'
import { RequirePermission } from '../../../gateway/decorators/require-permission.decorator'
import { DeptService } from './dept.service'
import { CreateDeptDto, UpdateDeptDto } from './dto/dept.dto'

@ApiTags('部门管理')
@ApiBearerAuth()
@Controller('system/dept')
export class DeptController {
  constructor(private readonly deptService: DeptService) {}

  @Get('list')
  @RequirePermission('system:dept:list')
  @ApiOperation({ summary: '部门列表（平铺，前端组树）' })
  list(@Query('status') status?: string) {
    return this.deptService.list(status === undefined ? undefined : Number(status))
  }

  @Post()
  @RequirePermission('system:dept:create')
  @OperationLog('部门管理', '新增部门')
  @ApiOperation({ summary: '新增部门' })
  create(@Body() dto: CreateDeptDto) {
    return this.deptService.create(dto)
  }

  @Put(':id')
  @RequirePermission('system:dept:update')
  @OperationLog('部门管理', '编辑部门')
  @ApiOperation({ summary: '编辑部门' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateDeptDto) {
    return this.deptService.update(BigInt(id), dto)
  }

  @Delete(':id')
  @RequirePermission('system:dept:delete')
  @OperationLog('部门管理', '删除部门')
  @ApiOperation({ summary: '删除部门（有子级或有关联用户禁止）' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.deptService.remove(BigInt(id))
  }
}
