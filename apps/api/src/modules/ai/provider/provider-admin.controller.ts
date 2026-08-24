import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { OperationLog } from '../../../gateway/decorators/operation-log.decorator'
import { RequirePermission } from '../../../gateway/decorators/require-permission.decorator'
import { AiProviderService } from './provider.service'
import {
  CreateModelDto,
  CreateProviderDto,
  ModelQueryDto,
  ProviderQueryDto,
  UpdateModelDto,
  UpdateProviderDto,
} from './dto/provider-admin.dto'

/** 厂商/模型管理（admin，走正常 RBAC ai:provider:* / ai:model:*） */
@ApiTags('AI 管理')
@ApiBearerAuth()
@Controller('ai/admin')
export class AiProviderAdminController {
  constructor(private readonly providerService: AiProviderService) {}

  // ========== 厂商 ==========

  @Get('provider')
  @RequirePermission('ai:provider:list')
  @ApiOperation({ summary: '厂商分页列表（apiKey 掩码）' })
  providerPage(@Query() query: ProviderQueryDto) {
    return this.providerService.adminPage(query)
  }

  @Post('provider')
  @RequirePermission('ai:provider:create')
  @OperationLog('AI 厂商管理', '新增厂商')
  @ApiOperation({ summary: '新增厂商' })
  createProvider(@Body() dto: CreateProviderDto) {
    return this.providerService.createProvider(dto)
  }

  @Put('provider/:id')
  @RequirePermission('ai:provider:update')
  @OperationLog('AI 厂商管理', '编辑厂商')
  @ApiOperation({ summary: '编辑厂商（apiKey 空串不修改）' })
  updateProvider(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateProviderDto) {
    return this.providerService.updateProvider(BigInt(id), dto)
  }

  @Delete('provider/:id')
  @RequirePermission('ai:provider:delete')
  @OperationLog('AI 厂商管理', '删除厂商')
  @ApiOperation({ summary: '删除厂商（下有模型禁止删除）' })
  removeProvider(@Param('id', ParseIntPipe) id: number) {
    return this.providerService.removeProvider(BigInt(id))
  }

  // ========== 模型 ==========

  @Get('model')
  @RequirePermission('ai:model:list')
  @ApiOperation({ summary: '按厂商查模型列表（不分页）' })
  modelList(@Query() query: ModelQueryDto) {
    return this.providerService.modelsByProvider(query)
  }

  @Post('model')
  @RequirePermission('ai:model:create')
  @OperationLog('AI 模型管理', '新增模型')
  @ApiOperation({ summary: '新增模型' })
  createModel(@Body() dto: CreateModelDto) {
    return this.providerService.createModel(dto)
  }

  @Put('model/:id')
  @RequirePermission('ai:model:update')
  @OperationLog('AI 模型管理', '编辑模型')
  @ApiOperation({ summary: '编辑模型' })
  updateModel(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateModelDto) {
    return this.providerService.updateModel(BigInt(id), dto)
  }

  @Delete('model/:id')
  @RequirePermission('ai:model:delete')
  @OperationLog('AI 模型管理', '删除模型')
  @ApiOperation({ summary: '删除模型（有引用禁止删除，仅可停用）' })
  removeModel(@Param('id', ParseIntPipe) id: number) {
    return this.providerService.removeModel(BigInt(id))
  }
}
