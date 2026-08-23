import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { OperationLog } from '../../../gateway/decorators/operation-log.decorator'
import { RequirePermission } from '../../../gateway/decorators/require-permission.decorator'
import { CreateMenuDto, UpdateMenuDto } from './dto/menu.dto'
import { MenuService } from './menu.service'

@ApiTags('菜单管理')
@ApiBearerAuth()
@Controller('system/menu')
export class MenuController {
  constructor(private readonly menuService: MenuService) {}

  @Get('list')
  @RequirePermission('system:menu:list')
  @ApiOperation({ summary: '菜单列表（平铺，前端组树）' })
  list() {
    return this.menuService.list()
  }

  @Post()
  @RequirePermission('system:menu:create')
  @OperationLog('菜单管理', '新增菜单')
  @ApiOperation({ summary: '新增菜单/按钮' })
  create(@Body() dto: CreateMenuDto) {
    return this.menuService.create(dto)
  }

  @Put(':id')
  @RequirePermission('system:menu:update')
  @OperationLog('菜单管理', '编辑菜单')
  @ApiOperation({ summary: '编辑菜单' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateMenuDto) {
    return this.menuService.update(BigInt(id), dto)
  }

  @Delete(':id')
  @RequirePermission('system:menu:delete')
  @OperationLog('菜单管理', '删除菜单')
  @ApiOperation({ summary: '删除菜单（有子级禁止）' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.menuService.remove(BigInt(id))
  }
}
