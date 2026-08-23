import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { OperationLog } from '../../../gateway/decorators/operation-log.decorator'
import { RequirePermission } from '../../../gateway/decorators/require-permission.decorator'
import { AssignMenuDto, CreateRoleDto, RoleQueryDto, UpdateRoleDto } from './dto/role.dto'
import { RoleService } from './role.service'

@ApiTags('角色管理')
@ApiBearerAuth()
@Controller('system/role')
export class RoleController {
  constructor(private readonly roleService: RoleService) {}

  @Get('page')
  @RequirePermission('system:role:list')
  @ApiOperation({ summary: '角色分页列表' })
  page(@Query() query: RoleQueryDto) {
    return this.roleService.page(query)
  }

  @Get('list')
  @RequirePermission('system:role:list')
  @ApiOperation({ summary: '全部启用角色（下拉用）' })
  listAll() {
    return this.roleService.listAll()
  }

  @Post()
  @RequirePermission('system:role:create')
  @OperationLog('角色管理', '新增角色')
  @ApiOperation({ summary: '新增角色' })
  create(@Body() dto: CreateRoleDto) {
    return this.roleService.create(dto)
  }

  @Put(':id')
  @RequirePermission('system:role:update')
  @OperationLog('角色管理', '编辑角色')
  @ApiOperation({ summary: '编辑角色（admin 角色不可编辑）' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateRoleDto) {
    return this.roleService.update(BigInt(id), dto)
  }

  @Delete(':id')
  @RequirePermission('system:role:delete')
  @OperationLog('角色管理', '删除角色')
  @ApiOperation({ summary: '删除角色（被用户引用禁止）' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.roleService.remove(BigInt(id))
  }

  @Get(':id/menus')
  @RequirePermission('system:role:list')
  @ApiOperation({ summary: '角色已分配菜单 ID 列表（回显）' })
  getMenuIds(@Param('id', ParseIntPipe) id: number) {
    return this.roleService.getMenuIds(BigInt(id))
  }

  @Put(':id/menus')
  @RequirePermission('system:role:assign-menu')
  @OperationLog('角色管理', '分配菜单权限')
  @ApiOperation({ summary: '分配菜单权限（全量覆盖，含按钮）' })
  assignMenu(@Param('id', ParseIntPipe) id: number, @Body() dto: AssignMenuDto) {
    return this.roleService.assignMenu(BigInt(id), dto)
  }
}
