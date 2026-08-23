import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../../infra/prisma/prisma.service'

/** 可用模型（用户侧模型选择器） */
export interface AvailableModel {
  id: string
  displayName: string
  model: string
  providerCode: string
  providerName: string
  maxContext: number
  inputPrice: string
  outputPrice: string
}

/**
 * 厂商/模型业务服务（ai/provider 域）。
 * 负责厂商与模型配置的查询（用户侧模型列表 + 管理端 CRUD，管理端随后续任务补齐）。
 * 与 engine 的 ProviderService（OpenAI 兼容适配器）职责不同：本类面向数据存取，适配器面向上游调用。
 */
@Injectable()
export class AiProviderService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 用户侧可用模型列表（GET /api/ai/models）。
   * 仅返回 status=1 且所属厂商 status=1 的模型，按厂商排序、模型排序升序。
   * 不校验套餐（未开通用户也可拉取，便于对话页渲染空态）。
   */
  async availableModels(): Promise<AvailableModel[]> {
    const models = await this.prisma.aiModel.findMany({
      where: { status: 1, provider: { status: 1 } },
      include: { provider: true },
      orderBy: [{ provider: { sort: 'asc' } }, { sort: 'asc' }],
    })

    return models.map((m) => ({
      id: m.id.toString(),
      displayName: m.displayName,
      model: m.model,
      providerCode: m.provider.code,
      providerName: m.provider.name,
      maxContext: m.maxContext,
      inputPrice: m.inputPrice.toString(),
      outputPrice: m.outputPrice.toString(),
    }))
  }
}
