import { Injectable, Logger } from '@nestjs/common'
import type { Response } from 'express'
import { ErrorCode } from '../../../common/constants/error-code'
import { RedisKey } from '../../../common/constants/redis-key'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { RedisService } from '../../../infra/redis/redis.service'
import type { AuthUser } from '../../../gateway/guards/jwt.strategy'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import { CreditService } from '../credit/credit.service'
import { ProviderService } from '../engine/provider.service'
import type { EngineChatMessage } from '../engine/engine.types'
import type { ChatDto } from './dto/chat.dto'

/** P2a system prompt（简洁的助手设定，见 ARCHITECTURE §11） */
const SYSTEM_PROMPT = '你是 iplat 平台的 AI 助手，请简洁、准确地回答用户的问题。'

/** 聊天限流：20 次/分/用户 */
const RATE_LIMIT = 20
const RATE_WINDOW_MS = 60_000
/** 单用户并发流 TTL（兜底防进程崩溃残留） */
const CHATTING_TTL_SEC = 300
/** 心跳间隔（无 delta 时发送 : ping） */
const HEARTBEAT_MS = 15_000
/** 输入上下文预算：给输出预留 1/4，按字符数保守估算（1 token ≈ 1 字符） */
const OUTPUT_RESERVE_RATIO = 0.25

/** 模型（含厂商）精简类型 */
interface ChatModel {
  id: bigint
  model: string
  maxContext: number
  provider: { baseUrl: string; apiKey: string | null; status: number }
  status: number
}

/**
 * SSE 对话编排（chat 域）。
 * 流程：限流 → 并发流限制 → 预检（套餐/模型/会话/内容）→ 懒建会话 → 存 user 消息 →
 * 拼装上下文（截取）→ 建 assistant 占位 → 发 meta → 流式下发 delta → 结算 → done。
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly creditService: CreditService,
    private readonly providerService: ProviderService,
  ) {}

  /** SSE 对话主流程（由 Controller 用 @Res() 传入原生 Response） */
  async handleChat(user: AuthUser, dto: ChatDto, res: Response): Promise<void> {
    const userId = BigInt(user.userId)
    const chatKey = RedisKey.aiChatting(user.userId)

    // 1. 并发流限制：存在进行中的流即拒绝（20007）
    const acquired = await this.redis.client.set(chatKey, '1', 'EX', CHATTING_TTL_SEC, 'NX')
    if (!acquired) {
      throw new BusinessException(ErrorCode.AiChatInProgress, '上一段对话仍在生成中，请稍候')
    }

    const abortController = new AbortController()
    // 客户端断开时中断上游
    res.on('close', () => {
      if (!res.writableEnded) abortController.abort()
    })

    try {
      await this.run(userId, dto, res, abortController.signal)
    } catch (error) {
      if (res.headersSent) {
        // 已进入流式：写 error 事件后自然结束，不再抛给全局过滤器（避免二次写响应）
        await this.emitError(res, error)
      } else {
        // 前置校验失败：抛给 GlobalExceptionFilter 统一 JSON 错误响应
        throw error
      }
    } finally {
      await this.redis.client.del(chatKey)
    }
  }

  /** 主流程实现 */
  private async run(userId: bigint, dto: ChatDto, res: Response, signal: AbortSignal): Promise<void> {
    // 2. 限流：20 次/分/用户
    await this.assertRateLimit(userId)

    // 3. 预检套餐（无套餐 20001 / 余额不足 20002，含懒重置）
    await this.creditService.precheck(userId)

    // 4. 确定会话与模型
    const { conversationId, model } = await this.resolveConversationAndModel(userId, dto)

    // 5. 内容长度校验（超模型上下文 20006）
    const inputBudget = Math.floor(model.maxContext * (1 - OUTPUT_RESERVE_RATIO))
    if (dto.content.length > inputBudget) {
      throw new BusinessException(ErrorCode.AiContentTooLong, '消息内容超出模型上下文长度，请精简后重试')
    }

    // 6. 存 user 消息
    const userMessage = await this.prisma.aiMessage.create({
      data: { conversationId, role: 'user', content: dto.content, status: 1 },
    })

    // 7. 建 assistant 占位消息
    const assistantMessage = await this.prisma.aiMessage.create({
      data: { conversationId, role: 'assistant', content: '', modelId: model.id, status: 1 },
    })

    // 8. 拼装上下文（system prompt + 历史消息按 inputBudget 从最新往回截取）
    const { messages, inputChars } = await this.buildContext(conversationId, userMessage.id, dto.content, inputBudget)

    // 9. 进入流式：设置 SSE 响应头 + 发 meta
    this.setupSseHeaders(res)
    this.writeEvent(res, 'meta', {
      conversationId: conversationId.toString(),
      userMessageId: userMessage.id.toString(),
      assistantMessageId: assistantMessage.id.toString(),
    })

    // 10. 流式调用 + 心跳 + 累积输出
    let fullContent = ''
    let upstreamUsage: { inputTokens: number; outputTokens: number } | null = null
    let heartbeat: NodeJS.Timeout | null = null
    const resetHeartbeat = () => {
      if (heartbeat) clearInterval(heartbeat)
      heartbeat = setInterval(() => this.writeComment(res, 'ping'), HEARTBEAT_MS)
    }
    resetHeartbeat()

    let streamFailed = false
    try {
      for await (const event of this.providerService.streamChat({
        baseUrl: model.provider.baseUrl,
        apiKey: model.provider.apiKey ?? '',
        model: model.model,
        messages,
        signal,
      })) {
        if (event.type === 'delta') {
          fullContent += event.content
          this.writeEvent(res, 'delta', { content: event.content })
          resetHeartbeat()
        } else if (event.type === 'done') {
          upstreamUsage = event.usage
        }
      }
    } catch {
      streamFailed = true
    } finally {
      if (heartbeat) clearInterval(heartbeat)
    }

    // 11. 结算（失败仍结算已产生 tokens）+ 更新 assistant 消息
    const { credits, remainingCredits } = await this.finalizeAssistant(
      userId,
      conversationId,
      assistantMessage.id,
      model,
      fullContent,
      inputChars,
      upstreamUsage,
      !streamFailed,
    )

    // 12. 上游失败 → error 事件；成功 → done 事件
    if (streamFailed) {
      this.writeEvent(res, 'error', { code: ErrorCode.AiUpstreamError, message: '上游模型调用失败' })
    } else {
      this.writeEvent(res, 'done', {
        usage: {
          inputTokens: upstreamUsage?.inputTokens ?? inputChars,
          outputTokens: upstreamUsage?.outputTokens ?? fullContent.length,
          credits,
          remainingCredits: remainingCredits.toString(),
        },
      })
    }
    res.end()
  }

  /** 限流检查：Redis INCR，首次设置 60s 窗口，超 20 次返回 42900 */
  private async assertRateLimit(userId: bigint): Promise<void> {
    const key = RedisKey.aiChatRate(userId.toString())
    const count = await this.redis.client.incr(key)
    if (count === 1) {
      await this.redis.client.pexpire(key, RATE_WINDOW_MS)
    }
    if (count > RATE_LIMIT) {
      throw new BusinessException(ErrorCode.TooManyRequests, '请求过于频繁，请稍后再试')
    }
  }

  /** 确定会话与模型：新会话懒创建（标题取首条消息前 20 字），已有会话用其绑定模型 */
  private async resolveConversationAndModel(
    userId: bigint,
    dto: ChatDto,
  ): Promise<{ conversationId: bigint; model: ChatModel }> {
    if (dto.conversationId) {
      const conversation = await this.prisma.aiConversation.findFirst({
        where: { id: BigInt(dto.conversationId), userId, deletedAt: null },
        include: { model: { include: { provider: true } } },
      })
      if (!conversation) throw new BusinessException(ErrorCode.AiConversationNotFound, '会话不存在或无权访问')
      if (!conversation.model) throw new BusinessException(ErrorCode.AiModelUnavailable, '会话未绑定模型，请先切换模型')
      this.assertModelUsable(conversation.model)
      return { conversationId: conversation.id, model: conversation.model }
    }

    // 新会话：modelId 必填
    if (!dto.modelId) {
      throw new BusinessException(ErrorCode.ParamInvalid, '新会话首条消息需指定模型')
    }
    const model = await this.prisma.aiModel.findUnique({
      where: { id: BigInt(dto.modelId) },
      include: { provider: true },
    })
    if (!model) throw new BusinessException(ErrorCode.NotFound, '模型不存在')
    this.assertModelUsable(model)

    const conversation = await this.prisma.aiConversation.create({
      data: { userId, title: dto.content.slice(0, 20), modelId: model.id },
    })
    return { conversationId: conversation.id, model }
  }

  /** 模型可用性：模型启用且厂商启用，否则 20003 */
  private assertModelUsable(model: { status: number; provider: { status: number } }): void {
    if (model.status !== 1 || model.provider.status !== 1) {
      throw new BusinessException(ErrorCode.AiModelUnavailable, '模型不可用或已停用')
    }
  }

  /**
   * 拼装上下文：system prompt 最前 + 历史消息（按 inputBudget 从最新往回截取，超长老消息丢弃）+ 当前消息。
   * 返回拼装结果与输入总字符数（用于 usage 兜底估算）。
   */
  private async buildContext(
    conversationId: bigint,
    excludeMessageId: bigint,
    currentContent: string,
    inputBudget: number,
  ): Promise<{ messages: EngineChatMessage[]; inputChars: number }> {
    // 历史消息（排除刚写入的当前 user 消息），按 createdAt 倒序取最近 50 条
    const history = await this.prisma.aiMessage.findMany({
      where: { conversationId, deletedAt: null, id: { not: excludeMessageId } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })

    const systemMsg: EngineChatMessage = { role: 'system', content: SYSTEM_PROMPT }
    let used = SYSTEM_PROMPT.length + currentContent.length

    // 从最新往回装，装不下的老消息丢弃
    const picked: EngineChatMessage[] = []
    for (const m of history) {
      const cost = m.content.length
      if (used + cost > inputBudget) break
      picked.push({ role: m.role as 'user' | 'assistant', content: m.content })
      used += cost
    }
    picked.reverse() // 倒序（新→旧）翻转为正序

    const currentMsg: EngineChatMessage = { role: 'user', content: currentContent }
    const messages: EngineChatMessage[] = [systemMsg, ...picked, currentMsg]
    const inputChars = messages.reduce((sum, m) => sum + m.content.length, 0)
    return { messages, inputChars }
  }

  /**
   * 结算并更新 assistant 消息。
   * - 上游未返回 usage 时按字符数估算（estimated=1）：输入=输入消息字符数，输出=回复字符数
   * - 失败时 status=2 但仍结算已产生 tokens
   * 返回 credits 与 remainingCredits。
   */
  private async finalizeAssistant(
    userId: bigint,
    conversationId: bigint,
    assistantMessageId: bigint,
    model: { id: bigint },
    fullContent: string,
    inputChars: number,
    upstreamUsage: { inputTokens: number; outputTokens: number } | null,
    success: boolean,
  ): Promise<{ credits: number; remainingCredits: bigint }> {
    const inputTokens = upstreamUsage?.inputTokens ?? inputChars
    const outputTokens = upstreamUsage?.outputTokens ?? fullContent.length
    const estimated = upstreamUsage ? 0 : 1

    // 结算（幂等）
    const { credits, remainingCredits } = await this.creditService.settle({
      userId,
      conversationId,
      messageId: assistantMessageId,
      modelId: model.id,
      inputTokens,
      outputTokens,
      estimated,
    })

    // 更新 assistant 消息
    await this.prisma.aiMessage.update({
      where: { id: assistantMessageId },
      data: {
        content: fullContent,
        tokensInput: inputTokens,
        tokensOutput: outputTokens,
        credits,
        status: success ? 1 : 2,
      },
    })

    return { credits, remainingCredits }
  }

  private setupSseHeaders(res: Response): void {
    res.status(200)
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders?.()
  }

  private writeEvent(res: Response, type: string, payload: Record<string, unknown>): void {
    res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`)
  }

  private writeComment(res: Response, comment: string): void {
    res.write(`: ${comment}\n\n`)
  }

  private async emitError(res: Response, error: unknown): Promise<void> {
    if (res.headersSent && !res.writableEnded) {
      const code = error instanceof BusinessException ? error.code : ErrorCode.InternalError
      const message = error instanceof Error ? error.message : '服务器内部错误'
      this.writeEvent(res, 'error', { code, message })
      res.end()
    }
  }
}
