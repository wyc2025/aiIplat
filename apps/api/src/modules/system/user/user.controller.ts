import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { OperationLog } from '../../../gateway/decorators/operation-log.decorator'
import { RequirePermission } from '../../../gateway/decorators/require-permission.decorator'
import {
  AssignRoleDto,
  CreateUserDto,
  UpdateStatusDto,
  UpdateUserDto,
  UserQueryDto,
} from './dto/user.dto'
import { UserService } from './user.service'

@ApiTags('用户管理')
@ApiBearerAuth()
@Controller('system/user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('page')
  @RequirePermission('system:user:list')
  @ApiOperation({ summary: '用户分页列表（含部门/角色）' })
  page(@Query() query: UserQueryDto) {
    return this.userService.page(query)
  }

  @Post()
  @RequirePermission('system:user:create')
  @OperationLog('用户管理', '新增用户')
  @ApiOperation({ summary: '新增用户（可同时分配角色）' })
  create(@Body() dto: CreateUserDto) {
    return this.userService.create(dto)
  }

  @Put(':id')
  @RequirePermission('system:user:update')
  @OperationLog('用户管理', '编辑用户')
  @ApiOperation({ summary: '编辑用户基本信息' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateUserDto) {
    return this.userService.update(BigInt(id), dto)
  }

  @Put(':id/status')
  @RequirePermission('system:user:update')
  @OperationLog('用户管理', '启禁用用户')
  @ApiOperation({ summary: '启禁用用户（admin 不可禁用）' })
  updateStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateStatusDto) {
    return this.userService.updateStatus(BigInt(id), dto)
  }

  @Put(':id/password')
  @RequirePermission('system:user:reset-password')
  @OperationLog('用户管理', '重置密码')
  @ApiOperation({ summary: '重置密码（返回随机 8 位明文，仅展示一次）' })
  resetPassword(@Param('id', ParseIntPipe) id: number) {
    return this.userService.resetPassword(BigInt(id))
  }

  @Put(':id/roles')
  @RequirePermission('system:user:assign-role')
  @OperationLog('用户管理', '分配角色')
  @ApiOperation({ summary: '分配角色（admin 不可改角色）' })
  assignRole(@Param('id', ParseIntPipe) id: number, @Body() dto: AssignRoleDto) {
    return this.userService.assignRole(BigInt(id), dto)
  }

  @Delete(':id')
  @RequirePermission('system:user:delete')
  @OperationLog('用户管理', '删除用户')
  @ApiOperation({ summary: '删除用户（admin 不可删除）' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.userService.remove(BigInt(id))
  }
}
