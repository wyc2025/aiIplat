import { Injectable } from '@nestjs/common'
import { ErrorCode } from '../../../common/constants/error-code'
import { PageResultDto } from '../../../common/dto/page-result.dto'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import { ToolRegistry } from '../tool/tool.registry'
import type { ConversationQueryDto, UpdateConversationDto } from './dto/conversation.dto'

@Injectable()
export class ConversationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly toolRegistry: ToolRegistry,
  ) {}

  /** 会话分页列表（按 updatedAt 倒序，含当前模型显示名） */
  async page(userId: bigint, query: ConversationQueryDto) {
    const where = { userId, deletedAt: null }
    const [list, total] = await Promise.all([
      this.prisma.aiConversation.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: query.skip,
        take: query.take,
        include: { model: { select: { displayName: true } } },
      }),
      this.prisma.aiConversation.count({ where }),
    ])

    const data = list.map((c) => ({
      id: c.id.toString(),
      title: c.title,
      modelId: c.modelId?.toString() ?? null,
      modelDisplayName: c.model?.displayName ?? null,
      updatedAt: c.updatedAt,
    }))

    return new PageResultDto(data, total, query)
  }

  /** 重命名 / 切换模型（只能操作本人会话） */
  async update(userId: bigint, id: bigint, dto: UpdateConversationDto) {
    const conversation = await this.assertOwned(userId, id)

    // 切换模型时校验模型存在且启用
    if (dto.modelId !== undefined) {
      const model = await this.prisma.aiModel.findUnique({ where: { id: BigInt(dto.modelId) } })
      if (!model) throw new BusinessException(ErrorCode.NotFound, '模型不存在')
      if (model.status !== 1) throw new BusinessException(ErrorCode.AiModelUnavailable, '模型已停用')
    }

    const updated = await this.prisma.aiConversation.update({
      where: { id: conversation.id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.modelId !== undefined ? { modelId: BigInt(dto.modelId) } : {}),
      },
    })
    return { id: updated.id.toString() }
  }

  /** 删除会话（软删，消息级联软删） */
  async remove(userId: bigint, id: bigint) {
    const conversation = await this.assertOwned(userId, id)
    const now = new Date()
    await this.prisma.$transaction([
      this.prisma.aiMessage.updateMany({
        where: { conversationId: conversation.id, deletedAt: null },
        data: { deletedAt: now },
      }),
      this.prisma.aiConversation.update({
        where: { id: conversation.id },
        data: { deletedAt: now },
      }),
    ])
    return { success: true }
  }

  /** 消息列表（不分页，最近 50 条、按 createdAt 正序，含模型显示名与工具调用记录） */
  async messages(userId: bigint, conversationId: bigint) {
    const conversation = await this.assertOwned(userId, conversationId)

    // 取最近 50 条（按 createdAt 倒序取 50 条后翻转，避免全量扫描）
    const recent = await this.prisma.aiMessage.findMany({
      where: { conversationId: conversation.id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { model: { select: { displayName: true } } },
    })
    const ordered = recent.reverse()

    // 批量查这些消息关联的工具调用记录（按 messageId 分组）
    const toolCalls = await this.prisma.aiToolCall.findMany({
      where: { messageId: { in: ordered.map((m) => m.id) } },
      orderBy: { id: 'asc' },
    })
    const toolCallsByMessage = new Map<string, typeof toolCalls>()
    for (const tc of toolCalls) {
      const key = tc.messageId.toString()
      const list = toolCallsByMessage.get(key) ?? []
      list.push(tc)
      toolCallsByMessage.set(key, list)
    }

    return ordered.map((m) => ({
      id: m.id.toString(),
      role: m.role,
      content: m.content,
      tokensInput: m.tokensInput,
      tokensOutput: m.tokensOutput,
      credits: m.credits,
      modelDisplayName: m.model?.displayName ?? null,
      status: m.status,
      createdAt: m.createdAt,
      toolCalls: (toolCallsByMessage.get(m.id.toString()) ?? []).map((tc) => ({
        toolCallId: tc.id.toString(),
        toolName: tc.toolName,
        title: this.toolRegistry.get(tc.toolName)?.title ?? tc.toolName,
        summary: this.buildToolSummary(tc),
        params: tc.params,
        status: tc.status,
        risk: tc.risk,
      })),
    }))
  }

  /** 工具调用摘要：read 工具用执行结果摘要，write 工具用参数摘要 */
  private buildToolSummary(tc: { risk: string; params: unknown; result: string | null }): string {
    const raw = tc.risk === 'read' ? tc.result : JSON.stringify(tc.params)
    const str = raw ?? ''
    return str.length > 200 ? `${str.slice(0, 200)}…` : str
  }

  /** 校验会话存在且归属当前用户，否则抛 20004 */
  private async assertOwned(userId: bigint, id: bigint) {
    const conversation = await this.prisma.aiConversation.findFirst({
      where: { id, userId, deletedAt: null },
    })
    if (!conversation) {
      throw new BusinessException(ErrorCode.AiConversationNotFound, '会话不存在或无权访问')
    }
    return conversation
  }
}
