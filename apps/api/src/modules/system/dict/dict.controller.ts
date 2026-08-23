import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { OperationLog } from '../../../gateway/decorators/operation-log.decorator'
import { RequirePermission } from '../../../gateway/decorators/require-permission.decorator'
import { DictService } from './dict.service'
import {
  CreateDictDataDto,
  CreateDictTypeDto,
  DictTypeQueryDto,
  UpdateDictDataDto,
  UpdateDictTypeDto,
} from './dto/dict.dto'

@ApiTags('字典管理')
@ApiBearerAuth()
@Controller('system/dict')
export class DictController {
  constructor(private readonly dictService: DictService) {}

  // ========== 字典类型 ==========

  @Get('type/page')
  @RequirePermission('system:dict:list')
  @ApiOperation({ summary: '字典类型分页列表' })
  typePage(@Query() query: DictTypeQueryDto) {
    return this.dictService.typePage(query)
  }

  @Post('type')
  @RequirePermission('system:dict:create')
  @OperationLog('字典管理', '新增字典类型')
  @ApiOperation({ summary: '新增字典类型' })
  createType(@Body() dto: CreateDictTypeDto) {
    return this.dictService.createType(dto)
  }

  @Put('type/:id')
  @RequirePermission('system:dict:update')
  @OperationLog('字典管理', '编辑字典类型')
  @ApiOperation({ summary: '编辑字典类型' })
  updateType(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateDictTypeDto) {
    return this.dictService.updateType(BigInt(id), dto)
  }

  @Delete('type/:id')
  @RequirePermission('system:dict:delete')
  @OperationLog('字典管理', '删除字典类型')
  @ApiOperation({ summary: '删除字典类型（下有数据禁止）' })
  removeType(@Param('id', ParseIntPipe) id: number) {
    return this.dictService.removeType(BigInt(id))
  }

  // ========== 字典数据 ==========

  @Get('type/:typeId/data')
  @RequirePermission('system:dict:list')
  @ApiOperation({ summary: '某类型下的字典数据列表' })
  dataList(@Param('typeId', ParseIntPipe) typeId: number) {
    return this.dictService.dataList(BigInt(typeId))
  }

  /** 按类型标识取启用数据：所有登录用户可用（下拉/渲染用），不挂管理权限 */
  @Get('data/:type')
  @ApiOperation({ summary: '按类型标识取启用字典数据（前端下拉/渲染）' })
  dataByType(@Param('type') type: string) {
    return this.dictService.dataByType(type)
  }

  @Post('data')
  @RequirePermission('system:dict:create')
  @OperationLog('字典管理', '新增字典数据')
  @ApiOperation({ summary: '新增字典数据' })
  createData(@Body() dto: CreateDictDataDto) {
    return this.dictService.createData(dto)
  }

  @Put('data/:id')
  @RequirePermission('system:dict:update')
  @OperationLog('字典管理', '编辑字典数据')
  @ApiOperation({ summary: '编辑字典数据' })
  updateData(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateDictDataDto) {
    return this.dictService.updateData(BigInt(id), dto)
  }

  @Delete('data/:id')
  @RequirePermission('system:dict:delete')
  @OperationLog('字典管理', '删除字典数据')
  @ApiOperation({ summary: '删除字典数据' })
  removeData(@Param('id', ParseIntPipe) id: number) {
    return this.dictService.removeData(BigInt(id))
  }
}
