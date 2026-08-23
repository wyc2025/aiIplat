import { Controller, Get } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { AiProviderService } from './provider.service'

@ApiTags('AI 助手')
@ApiBearerAuth()
@Controller('ai')
export class AiProviderController {
  constructor(private readonly providerService: AiProviderService) {}

  /** 可用模型列表：登录即可，不挂 @RequirePermission（套餐校验仅发生在 /api/ai/chat） */
  @Get('models')
  @ApiOperation({ summary: '可用模型列表（用户侧模型选择器）' })
  availableModels() {
    return this.providerService.availableModels()
  }
}
