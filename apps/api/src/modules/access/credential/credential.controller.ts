import { Body, Controller, Get, Param, ParseIntPipe, Post, Put } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../../gateway/decorators/current-user.decorator'
import { OperationLog } from '../../../gateway/decorators/operation-log.decorator'
import { CredentialService } from './credential.service'
import { CreateCredentialDto, UpdateCredentialDto } from './dto/credential.dto'

/**
 * 接入凭证管理端点（P15 T134，API-P15 §1-1~6）。
 *
 * 登录态 + **属主自服务**（无 `@RequirePermission`，照 display 先例）；写操作挂 `@OperationLog`。
 * 纪律（R140）：`secret` 仅在创建 / 轮换响应出现一次，此后任何端点不返回；**不为 AI 提供凭证工具**
 * ——AI 对话不是安全通道，secret 不进对话、不进 `ai_tool_call` 留痕，AI 文案只教「去应用中心 ▸ 接入凭证」。
 */
@ApiTags('应用平台-接入凭证')
@ApiBearerAuth()
@Controller('access/credentials')
export class CredentialController {
  constructor(private readonly credentialService: CredentialService) {}

  @Post()
  @OperationLog('接入凭证', '创建凭证')
  @ApiOperation({
    summary: '创建凭证（apiKey 仅本次响应返回一次；scope 越界 50021；超上限 50020）',
  })
  create(@CurrentUser('userId') userId: string, @Body() dto: CreateCredentialDto) {
    return this.credentialService.create(BigInt(userId), dto)
  }

  @Get()
  @ApiOperation({ summary: '我的凭证列表（只回显 keyId + secretPrefix，不含 secret）' })
  list(@CurrentUser('userId') userId: string) {
    return this.credentialService.list(BigInt(userId))
  }

  @Get(':id')
  @ApiParam({ name: 'id', description: '凭证 id' })
  @ApiOperation({ summary: '凭证详情（含 scope 全量；不含 secret）' })
  detail(@CurrentUser('userId') userId: string, @Param('id', ParseIntPipe) id: number) {
    return this.credentialService.detail(BigInt(userId), BigInt(id))
  }

  @Put(':id')
  @OperationLog('接入凭证', '编辑凭证')
  @ApiParam({ name: 'id', description: '凭证 id' })
  @ApiOperation({ summary: '编辑备注名 / 授权范围 / 过期时间（密钥不可改，改密钥走轮换）' })
  update(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCredentialDto,
  ) {
    return this.credentialService.update(BigInt(userId), BigInt(id), dto)
  }

  @Post(':id/revoke')
  @OperationLog('接入凭证', '吊销凭证')
  @ApiParam({ name: 'id', description: '凭证 id' })
  @ApiOperation({ summary: '吊销凭证（不可逆；立即生效——校验不缓存）' })
  revoke(@CurrentUser('userId') userId: string, @Param('id', ParseIntPipe) id: number) {
    return this.credentialService.revoke(BigInt(userId), BigInt(id))
  }

  @Post(':id/rotate')
  @OperationLog('接入凭证', '轮换凭证密钥')
  @ApiParam({ name: 'id', description: '凭证 id' })
  @ApiOperation({ summary: '轮换密钥（新 apiKey 仅本次返回；旧 secret 立即失效，keyId 不变）' })
  rotate(@CurrentUser('userId') userId: string, @Param('id', ParseIntPipe) id: number) {
    return this.credentialService.rotate(BigInt(userId), BigInt(id))
  }
}
