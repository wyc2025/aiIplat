import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../../gateway/decorators/current-user.decorator'
import { OperationLog } from '../../../gateway/decorators/operation-log.decorator'
import {
  CreateFieldDto,
  CreateRelationDto,
  CreateTableDto,
  ShrinkFieldDto,
  UpdateFieldDto,
  UpdateTableDto,
} from './dto/schema.dto'
import { SchemaService } from './schema.service'

/**
 * 结构管理（P11 T102，API-P11 §1.2）：表/字段/关系 CRUD + 结构变更规则。
 * 全部登录态、属主自服务口径（无 @RequirePermission），写操作挂 @OperationLog。
 */
@ApiTags('应用平台-结构管理')
@ApiBearerAuth()
@Controller('app')
export class SchemaController {
  constructor(private readonly schemaService: SchemaService) {}

  @Get(':code/schema')
  @ApiParam({ name: 'code', description: '应用 code' })
  @ApiOperation({ summary: 'schema 全量打包（def+tables+fields+rels+pages；Redis 缓存）' })
  getSchema(@CurrentUser('userId') userId: string, @Param('code') code: string) {
    return this.schemaService.getSchema(BigInt(userId), code)
  }

  @Post(':code/tables')
  @OperationLog('应用中心', '新建逻辑表')
  @ApiParam({ name: 'code', description: '应用 code' })
  @ApiOperation({ summary: '建表（含初始字段；超 20 表 50002；字段类型非法 50005）' })
  createTable(
    @CurrentUser('userId') userId: string,
    @Param('code') code: string,
    @Body() dto: CreateTableDto,
  ) {
    return this.schemaService.createTable(BigInt(userId), code, dto)
  }

  @Put(':code/tables/:tid')
  @OperationLog('应用中心', '修改逻辑表')
  @ApiOperation({ summary: '改表（v1 仅 label）' })
  updateTable(
    @CurrentUser('userId') userId: string,
    @Param('code') code: string,
    @Param('tid', ParseIntPipe) tid: number,
    @Body() dto: UpdateTableDto,
  ) {
    return this.schemaService.updateTable(BigInt(userId), code, BigInt(tid), dto)
  }

  @Delete(':code/tables/:tid')
  @OperationLog('应用中心', '删除逻辑表')
  @ApiOperation({ summary: '软删表（系统表 50001；被引用阻断 50003 并列出引用方）' })
  deleteTable(
    @CurrentUser('userId') userId: string,
    @Param('code') code: string,
    @Param('tid', ParseIntPipe) tid: number,
  ) {
    return this.schemaService.deleteTable(BigInt(userId), code, BigInt(tid))
  }

  @Post(':code/tables/:tid/fields')
  @OperationLog('应用中心', '新增字段')
  @ApiOperation({ summary: '加字段（字段名表内唯一）' })
  addField(
    @CurrentUser('userId') userId: string,
    @Param('code') code: string,
    @Param('tid', ParseIntPipe) tid: number,
    @Body() dto: CreateFieldDto,
  ) {
    return this.schemaService.addField(BigInt(userId), code, BigInt(tid), dto)
  }

  @Put(':code/fields/:fid')
  @OperationLog('应用中心', '修改字段')
  @ApiOperation({ summary: '改字段（label/必填/默认值/枚举选项）' })
  updateField(
    @CurrentUser('userId') userId: string,
    @Param('code') code: string,
    @Param('fid', ParseIntPipe) fid: number,
    @Body() dto: UpdateFieldDto,
  ) {
    return this.schemaService.updateField(BigInt(userId), code, BigInt(fid), dto)
  }

  @Delete(':code/fields/:fid')
  @OperationLog('应用中心', '删除字段')
  @ApiOperation({ summary: '软删字段（D95：is_deleted=1，历史数据保留）' })
  deleteField(
    @CurrentUser('userId') userId: string,
    @Param('code') code: string,
    @Param('fid', ParseIntPipe) fid: number,
  ) {
    return this.schemaService.deleteField(BigInt(userId), code, BigInt(fid))
  }

  @Post(':code/fields/:fid/shrink')
  @OperationLog('应用中心', '字段类型收窄')
  @ApiOperation({ summary: '类型收窄（text/number→enum）：存量校验不合规 50003（带 rowId）' })
  shrinkField(
    @CurrentUser('userId') userId: string,
    @Param('code') code: string,
    @Param('fid', ParseIntPipe) fid: number,
    @Body() dto: ShrinkFieldDto,
  ) {
    return this.schemaService.shrinkField(BigInt(userId), code, BigInt(fid), dto)
  }

  @Post(':code/relations')
  @OperationLog('应用中心', '新建关系')
  @ApiOperation({ summary: '建 n:n（自动生成中间表；幂等返回现存）' })
  createRelation(
    @CurrentUser('userId') userId: string,
    @Param('code') code: string,
    @Body() dto: CreateRelationDto,
  ) {
    return this.schemaService.createRelation(BigInt(userId), code, dto)
  }
}
