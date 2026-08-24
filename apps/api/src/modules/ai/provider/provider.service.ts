import { Injectable } from '@nestjs/common'
import type { AiProvider } from '@prisma/client'
import { ErrorCode } from '../../../common/constants/error-code'
import { PageResultDto } from '../../../common/dto/page-result.dto'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import type {
  CreateModelDto,
  CreateProviderDto,
  ModelQueryDto,
  ProviderQueryDto,
  UpdateModelDto,
  UpdateProviderDto,
} from './dto/provider-admin.dto'

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

/** apiKey 掩码：`sk-****` + 后 4 位 */
function maskApiKey(apiKey: string | null): string {
  if (!apiKey) return ''
  if (apiKey.length <= 4) return '****'
  return `****${apiKey.slice(-4)}`
}

/**
 * 厂商/模型业务服务（ai/provider 域）。
 * 负责厂商与模型配置的查询与 CRUD（用户侧模型列表 + 管理端）。
 * 与 engine 的 ProviderService（OpenAI 兼容适配器）职责不同：本类面向数据存取，适配器面向上游调用。
 */
@Injectable()
export class AiProviderService {
  constructor(private readonly prisma: PrismaService) {}

  // ========== 用户侧 ==========

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

  // ========== 管理端：厂商 ==========

  /** 厂商分页（apiKey 掩码返回） */
  async adminPage(query: ProviderQueryDto) {
    const where = { ...(query.name ? { name: { contains: query.name } } : {}) }
    const [list, total] = await Promise.all([
      this.prisma.aiProvider.findMany({
        where,
        orderBy: { sort: 'asc' },
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.aiProvider.count({ where }),
    ])

    const data = list.map((p) => this.toProviderView(p))
    return new PageResultDto(data, total, query)
  }

  /** 新增厂商（code 唯一） */
  async createProvider(dto: CreateProviderDto) {
    await this.assertProviderCodeAvailable(dto.code)
    const provider = await this.prisma.aiProvider.create({
      data: { ...dto, apiKey: dto.apiKey ?? null },
    })
    return { id: provider.id.toString() }
  }

  /** 编辑厂商（apiKey 传空串表示不修改） */
  async updateProvider(id: bigint, dto: UpdateProviderDto) {
    await this.assertProviderExists(id)
    const data: Record<string, unknown> = {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.baseUrl !== undefined ? { baseUrl: dto.baseUrl } : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(dto.sort !== undefined ? { sort: dto.sort } : {}),
      ...(dto.remark !== undefined ? { remark: dto.remark } : {}),
    }
    // apiKey 空串表示不修改；非空才更新
    if (dto.apiKey) {
      data.apiKey = dto.apiKey
    }
    const provider = await this.prisma.aiProvider.update({ where: { id }, data })
    return { id: provider.id.toString() }
  }

  /** 删除厂商（下有模型禁止删除） */
  async removeProvider(id: bigint) {
    await this.assertProviderExists(id)
    const modelCount = await this.prisma.aiModel.count({ where: { providerId: id } })
    if (modelCount > 0) {
      throw new BusinessException(ErrorCode.AiProviderHasModels, '该厂商下存在模型，不可删除')
    }
    await this.prisma.aiProvider.delete({ where: { id } })
    return { success: true }
  }

  // ========== 管理端：模型 ==========

  /** 按厂商查模型列表（不分页） */
  async modelsByProvider(query: ModelQueryDto) {
    await this.assertProviderExists(BigInt(query.providerId))
    const models = await this.prisma.aiModel.findMany({
      where: { providerId: BigInt(query.providerId) },
      orderBy: { sort: 'asc' },
    })
    return models.map((m) => this.toModelView(m))
  }

  /** 新增模型（厂商内 API 模型名唯一） */
  async createModel(dto: CreateModelDto) {
    await this.assertProviderExists(BigInt(dto.providerId))
    await this.assertModelAvailable(BigInt(dto.providerId), dto.model)
    const model = await this.prisma.aiModel.create({
      data: { ...dto, providerId: BigInt(dto.providerId) },
    })
    return { id: model.id.toString() }
  }

  /** 编辑模型 */
  async updateModel(id: bigint, dto: UpdateModelDto) {
    await this.assertModelExists(id)
    const model = await this.prisma.aiModel.update({
      where: { id },
      data: { ...dto },
    })
    return { id: model.id.toString() }
  }

  /** 删除模型（存在引用即禁止删除，仅可停用） */
  async removeModel(id: bigint) {
    await this.assertModelExists(id)
    const [convRef, usageRef, msgRef] = await Promise.all([
      this.prisma.aiConversation.count({ where: { modelId: id } }),
      this.prisma.aiUsageLog.count({ where: { modelId: id } }),
      this.prisma.aiMessage.count({ where: { modelId: id } }),
    ])
    if (convRef + usageRef + msgRef > 0) {
      throw new BusinessException(ErrorCode.AiModelInUse, '该模型存在会话或用量引用，不可删除，仅可停用')
    }
    await this.prisma.aiModel.delete({ where: { id } })
    return { success: true }
  }

  // ========== 私有 ==========

  private async assertProviderExists(id: bigint): Promise<AiProvider> {
    const provider = await this.prisma.aiProvider.findUnique({ where: { id } })
    if (!provider) throw new BusinessException(ErrorCode.NotFound, '厂商不存在')
    return provider
  }

  private async assertProviderCodeAvailable(code: string): Promise<void> {
    const exists = await this.prisma.aiProvider.findUnique({ where: { code } })
    if (exists) throw new BusinessException(ErrorCode.AiProviderCodeExists, '厂商标识已存在')
  }

  private async assertModelExists(id: bigint) {
    const model = await this.prisma.aiModel.findUnique({ where: { id } })
    if (!model) throw new BusinessException(ErrorCode.NotFound, '模型不存在')
    return model
  }

  private async assertModelAvailable(providerId: bigint, model: string): Promise<void> {
    const exists = await this.prisma.aiModel.findUnique({
      where: { providerId_model: { providerId, model } },
    })
    if (exists) throw new BusinessException(ErrorCode.AiModelExists, '该厂商下 API 模型名已存在')
  }

  private toProviderView(p: AiProvider) {
    return {
      id: p.id.toString(),
      name: p.name,
      code: p.code,
      baseUrl: p.baseUrl,
      apiKeyMasked: maskApiKey(p.apiKey),
      status: p.status,
      sort: p.sort,
      remark: p.remark,
    }
  }

  private toModelView(m: {
    id: bigint
    displayName: string
    model: string
    inputPrice: unknown
    outputPrice: unknown
    maxContext: number
    supportTool: number
    status: number
    sort: number
  }) {
    return {
      id: m.id.toString(),
      displayName: m.displayName,
      model: m.model,
      inputPrice: String(m.inputPrice),
      outputPrice: String(m.outputPrice),
      maxContext: m.maxContext,
      supportTool: m.supportTool,
      status: m.status,
      sort: m.sort,
    }
  }
}
