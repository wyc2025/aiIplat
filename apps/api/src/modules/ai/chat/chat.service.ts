import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Response } from 'express'
import { ErrorCode } from '../../../common/constants/error-code'
import { RedisKey } from '../../../common/constants/redis-key'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { RedisService } from '../../../infra/redis/redis.service'
import type { AuthUser } from '../../../gateway/guards/jwt.strategy'
import { PermissionService } from '../../../gateway/services/permission.service'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import { AI_MAX_TOOL_ROUNDS_DEFAULT, AI_MAX_TOOL_ROUNDS_LIMIT } from '../../../config/ai.config'
import { CreditService } from '../credit/credit.service'
import { ProviderService } from '../engine/provider.service'
import type { EngineChatMessage, EngineTool, EngineToolCall, EngineUsage } from '../engine/engine.types'
import { ToolRegistry } from '../tool/tool.registry'
import type { AiTool } from '../tool/tool.types'
import type { ChatDto } from './dto/chat.dto'
import { SystemPromptService } from './system-prompt.service'

/** 聊天限流：20 次/分/用户 */
const RATE_LIMIT = 20
const RATE_WINDOW_MS = 60_000
/** 单用户并发流 TTL（兜底防进程崩溃残留） */
const CHATTING_TTL_SEC = 300
/** 心跳间隔（无 delta 时发送 : ping） */
const HEARTBEAT_MS = 15_000
/** 输入上下文预算：给输出预留 1/4，按字符数保守估算（1 token ≈ 1 字符） */
const OUTPUT_RESERVE_RATIO = 0.25
/** 历史截取预算下限保护（字符；低于此值仍保底装这么多历史并告警，P5 R67） */
const MIN_HISTORY_CHARS = 2000
/** 历史消息条数上限（截取前先按条数粗筛，防超长会话全量拉取） */
const HISTORY_TAKE = 50
/** write 工具确认单 TTL（10 分钟） */
const CONFIRM_TTL_SEC = 600

/** 模型（含厂商）精简类型 */
interface ChatModel {
  id: bigint
  model: string
  maxContext: number
  supportTool: number
  provider: { baseUrl: string; apiKey: string | null; status: number }
  status: number
}

/** 单轮上游调用结果 */
interface RoundResult {
  content: string
  toolCalls: EngineToolCall[]
  usage: EngineUsage | null
  failed: boolean
  /** DeepSeek 思考模式的 reasoning_content（多轮工具调用回喂需回传） */
  reasoningContent: string
}

/**
 * SSE 对话编排（chat 域）。
 * 流程：限流 → 并发流限制 → 预检 → 懒建会话 → 存 user 消息 → 拼装上下文 →
 * 建 assistant 占位 → 发 meta → 多轮上游调用（工具调用，最多 3 轮）→ 结算 → done。
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly creditService: CreditService,
    private readonly providerService: ProviderService,
    private readonly toolRegistry: ToolRegistry,
    private readonly permissionService: PermissionService,
    private readonly systemPromptService: SystemPromptService,
    private readonly config: ConfigService,
  ) {}

  /**
   * 工具调用轮次上限（P5 D65）：`ai.maxToolRounds`（env AI_MAX_TOOL_ROUNDS，默认 3、上限 10）。
   * 每次现读（配置热改无需重启），越界回退默认值。
   */
  private get maxToolRounds(): number {
    const value = this.config.get<number>('ai.maxToolRounds', AI_MAX_TOOL_ROUNDS_DEFAULT)
    if (!Number.isFinite(value) || value <= 0) return AI_MAX_TOOL_ROUNDS_DEFAULT
    return Math.min(Math.floor(value), AI_MAX_TOOL_ROUNDS_LIMIT)
  }

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
      await this.run(user, userId, dto, res, abortController.signal)
    } catch (error) {
      if (res.headersSent) {
        await this.emitError(res, error)
      } else {
        throw error
      }
    } finally {
      await this.redis.client.del(chatKey)
    }
  }

  /** write 工具确认链路（POST /api/ai/tool/confirm）：执行/取消工具 → 回喂上游 → SSE 流式返回总结 */
  async handleToolConfirm(user: AuthUser, dto: { toolCallId: number; approved: boolean }, res: Response): Promise<void> {
    const userId = BigInt(user.userId)
    const chatKey = RedisKey.aiChatting(user.userId)

    // 1. 并发流锁（与 /ai/chat 共用）
    const acquired = await this.redis.client.set(chatKey, '1', 'EX', CHATTING_TTL_SEC, 'NX')
    if (!acquired) {
      throw new BusinessException(ErrorCode.AiChatInProgress, '上一段对话仍在生成中，请稍候')
    }

    const abortController = new AbortController()
    res.on('close', () => {
      if (!res.writableEnded) abortController.abort()
    })

    try {
      await this.runToolConfirm(user, userId, dto, res, abortController.signal)
    } catch (error) {
      if (res.headersSent) {
        await this.emitError(res, error)
      } else {
        throw error
      }
    } finally {
      await this.redis.client.del(chatKey)
    }
  }

  /** 确认链路实现 */
  private async runToolConfirm(
    user: AuthUser,
    userId: bigint,
    dto: { toolCallId: number; approved: boolean },
    res: Response,
    signal: AbortSignal,
  ): Promise<void> {
    // 2. 套餐预检
    await this.creditService.precheck(userId)

    const toolCallId = dto.toolCallId

    // 3. 查确认单（一次性：取到即失效，防重放）
    const confirmKey = RedisKey.aiConfirm(toolCallId.toString())
    const confirmRaw = await this.redis.client.get(confirmKey)
    if (!confirmRaw) {
      throw new BusinessException(ErrorCode.AiToolConfirmExpired, '确认单不存在或已过期')
    }
    const confirm = JSON.parse(confirmRaw) as { userId: string; conversationId: string; toolName: string; params: Record<string, unknown> }
    if (confirm.userId !== user.userId) {
      throw new BusinessException(ErrorCode.AiToolConfirmExpired, '确认单不存在或已过期')
    }
    await this.redis.client.del(confirmKey)

    // 4. 查留痕记录（pending 才可确认）
    const record = await this.prisma.aiToolCall.findUnique({ where: { id: BigInt(toolCallId) } })
    if (!record || record.status !== 'pending') {
      throw new BusinessException(ErrorCode.AiToolConfirmExpired, '确认单不存在或已过期')
    }

    // 5. 工具权限二次校验
    const tool = this.toolRegistry.get(record.toolName)
    if (!tool) {
      throw new BusinessException(ErrorCode.AiToolNotFound, '工具不存在或未启用')
    }
    if (tool.perms && !(await this.permissionService.hasPermission(user.userId, tool.perms))) {
      throw new BusinessException(ErrorCode.AiToolNoPermission, '无权限使用该工具')
    }

    // 6. 执行或拒绝
    let toolResult: string
    if (dto.approved) {
      try {
        const result = await tool.handler({ user }, record.params as Record<string, unknown>)
        toolResult = JSON.stringify(result)
        await this.prisma.aiToolCall.update({
          where: { id: record.id },
          data: { status: 'executed', result: this.truncate(toolResult, 2000) },
        })
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : '工具执行失败'
        this.logger.error(`write 工具 ${tool.name} 执行失败：${errMsg}`)
        toolResult = JSON.stringify({ error: '工具执行失败', message: errMsg })
        await this.prisma.aiToolCall.update({
          where: { id: record.id },
          data: { status: 'failed', errorMsg: errMsg },
        })
      }
    } else {
      toolResult = JSON.stringify({ status: 'cancelled', message: '用户已取消操作' })
      await this.prisma.aiToolCall.update({
        where: { id: record.id },
        data: { status: 'rejected' },
      })
    }

    // 7. 解析目标（原 assistant 消息 + 会话模型）→ 过滤后工具子集 → 重建上下文（实测预算截取，R67）
    const { conversationId, model, originalMessage } = await this.resolveConfirmTarget(record)
    const { tools } = await this.getAvailableTools(user, model)
    const messages = await this.buildConfirmContext(user, record, toolResult, model, originalMessage, tools)

    // 8. 建新 assistant 消息（总结独立落库 + 独立结算）
    const assistantMessage = await this.prisma.aiMessage.create({
      data: { conversationId, role: 'assistant', content: '', modelId: model.id, status: 1 },
    })

    // 9. SSE 响应头 + meta
    this.setupSseHeaders(res)
    this.writeEvent(res, 'meta', {
      conversationId: conversationId.toString(),
      assistantMessageId: assistantMessage.id.toString(),
    })

    // 10. 多轮上游调用（总结后可能再触发工具）
    let fullContent = ''
    let totalInputTokens = 0
    let totalOutputTokens = 0
    let hasUpstreamUsage = false
    let streamFailed = false
    let reasoningContent = ''

    let roundMessages = messages
    for (let round = 0; round < this.maxToolRounds; round++) {
      const roundResult = await this.callUpstream(model, roundMessages, tools, res, signal)
      if (roundResult.failed) {
        streamFailed = true
        break
      }

      fullContent += roundResult.content
      if (roundResult.reasoningContent) reasoningContent = roundResult.reasoningContent
      if (roundResult.usage) {
        totalInputTokens += roundResult.usage.inputTokens
        totalOutputTokens += roundResult.usage.outputTokens
        hasUpstreamUsage = true
      }

      if (roundResult.toolCalls.length === 0) break

      const processed = await this.processToolCalls(user, userId, conversationId, assistantMessage.id, roundResult.toolCalls, res)
      if (processed.stop) break
      roundMessages = [
        ...roundMessages,
        {
          role: 'assistant' as const,
          content: roundResult.content,
          tool_calls: roundResult.toolCalls,
          ...(roundResult.reasoningContent ? { reasoning_content: roundResult.reasoningContent } : {}),
        },
        ...processed.toolMessages,
      ]
    }

    // 11. 结算新消息（R68 兜底估算基数 = 全部 messages + tools schema + tool 往返消息）
    const inputChars = roundMessages.reduce((sum, m) => sum + m.content.length, 0) + this.toolsCharsOf(tools)
    const { credits, remainingCredits } = await this.finalizeAssistant(
      userId,
      conversationId,
      assistantMessage.id,
      model,
      fullContent,
      inputChars,
      hasUpstreamUsage ? { inputTokens: totalInputTokens, outputTokens: totalOutputTokens } : null,
      !streamFailed,
      reasoningContent,
    )

    if (streamFailed) {
      this.writeEvent(res, 'error', { code: ErrorCode.AiUpstreamError, message: '上游模型调用失败' })
    } else {
      this.writeEvent(res, 'done', {
        usage: {
          inputTokens: hasUpstreamUsage ? totalInputTokens : inputChars,
          outputTokens: hasUpstreamUsage ? totalOutputTokens : fullContent.length,
          credits,
          remainingCredits: remainingCredits.toString(),
        },
      })
    }
    res.end()
  }

  /**
   * 确认链路目标解析（P5 T71 拆分，供「先算工具子集再拼上下文」用）：
   * 原 assistant 消息（触发 write 工具的那条）+ 会话与模型（优先会话绑定模型，回退原消息模型）。
   */
  private async resolveConfirmTarget(record: { conversationId: bigint; messageId: bigint }): Promise<{
    conversationId: bigint
    model: ChatModel
    originalMessage: { content: string; reasoningContent: string | null }
  }> {
    // 原 assistant 消息（触发 write 工具的那条）
    const originalMessage = await this.prisma.aiMessage.findUnique({ where: { id: record.messageId } })
    if (!originalMessage) {
      throw new BusinessException(ErrorCode.AiToolConfirmExpired, '原会话消息不存在')
    }

    // 会话与模型（优先会话绑定模型，回退原消息模型）
    const conversation = await this.prisma.aiConversation.findUnique({
      where: { id: record.conversationId },
      include: { model: { include: { provider: true } } },
    })
    let model: ChatModel | null = conversation?.model ?? null
    if (!model && originalMessage.modelId) {
      model = await this.loadModel(originalMessage.modelId)
    }
    if (!model) {
      throw new BusinessException(ErrorCode.AiModelUnavailable, '会话未绑定模型')
    }
    return {
      conversationId: record.conversationId,
      model,
      originalMessage: {
        content: originalMessage.content,
        reasoningContent: originalMessage.reasoningContent,
      },
    }
  }

  /**
   * 重建确认回喂上下文：system prompt + 历史（按实测预算从最早丢弃，R67）+
   * 原 assistant 消息带 tool_calls + tool 结果消息。
   */
  private async buildConfirmContext(
    user: AuthUser,
    record: {
      conversationId: bigint
      messageId: bigint
      toolName: string
      params: unknown
    },
    toolResult: string,
    model: ChatModel,
    originalMessage: { content: string; reasoningContent: string | null },
    tools: EngineTool[],
  ): Promise<EngineChatMessage[]> {
    // 历史消息（正序，排除原 assistant 占位消息）
    const history = await this.prisma.aiMessage.findMany({
      where: { conversationId: record.conversationId, deletedAt: null, id: { not: record.messageId } },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_TAKE,
    })

    const paramsObj = (record.params ?? {}) as Record<string, unknown>
    const systemPrompt = await this.systemPromptService.build(user)
    const picked = this.pickHistory(
      history,
      this.computeHistoryBudget(
        model,
        systemPrompt.length,
        this.toolsCharsOf(tools),
        toolResult.length,
        tools.length,
      ),
    )

    // P5 真机验证修复：**禁止「文本 assistant」后紧跟「带 tool_calls 的 assistant」**——
    // 上游（DeepSeek 思考模式）会以 400「The `reasoning_content` in the thinking mode must be passed
    // back to the API」拒绝（受控实验 C7；C5/C6/C8 通过）。确认链路中历史最后一条可能是上一次确认的
    // 总结 assistant 消息（确认总结落库为独立 assistant 消息，与上一轮答复形成连续 assistant），
    // 故把紧邻的 assistant 文本并入原始消息，合并为单条 assistant（content + tool_calls，实验 C8 通过）。
    let originalContent = originalMessage.content
    const last = picked[picked.length - 1]
    if (last && last.role === 'assistant') {
      picked.pop()
      originalContent = [last.content, originalContent].filter((t) => t && t.length > 0).join('\n\n')
    }

    return [
      { role: 'system', content: systemPrompt },
      ...picked,
      // 原 assistant 消息带 tool_calls（用 ai_tool_call.id 作为 tool_call_id）+ reasoning_content 回传
      {
        role: 'assistant',
        content: originalContent,
        tool_calls: [
          {
            id: record.messageId.toString(),
            name: record.toolName,
            arguments: JSON.stringify(paramsObj),
          },
        ],
        ...(originalMessage.reasoningContent ? { reasoning_content: originalMessage.reasoningContent } : {}),
      },
      { role: 'tool', tool_call_id: record.messageId.toString(), content: toolResult },
    ]
  }

  /** 按 id 加载模型（含厂商） */
  private async loadModel(modelId: bigint): Promise<ChatModel | null> {
    const model = await this.prisma.aiModel.findUnique({
      where: { id: modelId },
      include: { provider: true },
    })
    return model
  }

  /** 主流程实现 */
  private async run(
    user: AuthUser,
    userId: bigint,
    dto: ChatDto,
    res: Response,
    signal: AbortSignal,
  ): Promise<void> {
    // 2. 限流
    await this.assertRateLimit(userId)
    // 3. 预检套餐
    await this.creditService.precheck(userId)
    // 4. 确定会话与模型
    const { conversationId, model } = await this.resolveConversationAndModel(userId, dto)

    // 5. 内容长度校验
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

    // 8. 确定可用工具（模型支持 + 按权限过滤）——先定工具子集，再按其 schema 实测占用扣减历史预算（R67）
    const { tools } = await this.getAvailableTools(user, model)

    // 9. 拼装上下文（system + tools 恒完整，历史从最早丢弃）
    const { messages, inputChars } = await this.buildContext(
      user,
      conversationId,
      userMessage.id,
      dto.content,
      model,
      tools,
    )

    // 10. 进入流式
    this.setupSseHeaders(res)
    this.writeEvent(res, 'meta', {
      conversationId: conversationId.toString(),
      userMessageId: userMessage.id.toString(),
      assistantMessageId: assistantMessage.id.toString(),
    })

    // 11. 多轮上游调用（工具调用循环，轮次上限取 ai.maxToolRounds）
    let fullContent = ''
    let totalInputTokens = 0
    let totalOutputTokens = 0
    let hasUpstreamUsage = false
    let streamFailed = false
    let reasoningContent = ''
    /** tool 往返消息累计字符（R68 兜底估算基数的一部分） */
    let roundTripChars = 0

    let roundMessages = messages
    for (let round = 0; round < this.maxToolRounds; round++) {
      const roundResult = await this.callUpstream(model, roundMessages, tools, res, signal)
      if (roundResult.failed) {
        streamFailed = true
        break
      }

      fullContent += roundResult.content
      if (roundResult.reasoningContent) reasoningContent = roundResult.reasoningContent
      if (roundResult.usage) {
        totalInputTokens += roundResult.usage.inputTokens
        totalOutputTokens += roundResult.usage.outputTokens
        hasUpstreamUsage = true
      }

      // 无工具调用：正常结束
      if (roundResult.toolCalls.length === 0) break

      // 处理工具调用
      const processed = await this.processToolCalls(
        user,
        userId,
        conversationId,
        assistantMessage.id,
        roundResult.toolCalls,
        res,
      )

      // write 工具：发确认卡片后本轮结束
      if (processed.stop) break

      // read 工具结果回喂：追加 assistant（含 tool_calls + reasoning）+ tool 消息，进入下一轮
      roundMessages = [
        ...roundMessages,
        {
          role: 'assistant' as const,
          content: roundResult.content,
          tool_calls: roundResult.toolCalls,
          ...(roundResult.reasoningContent ? { reasoning_content: roundResult.reasoningContent } : {}),
        },
        ...processed.toolMessages,
      ]
      roundTripChars +=
        roundResult.content.length + processed.toolMessages.reduce((sum, m) => sum + m.content.length, 0)
    }

    // 12. 结算（合并计费）+ 更新 assistant 消息
    // R68：兜底估算基数 = messages（含 tool 往返）+ tools schema（无上游 usage 时才真正生效）
    const estimatedInputChars = inputChars + roundTripChars
    const { credits, remainingCredits } = await this.finalizeAssistant(
      userId,
      conversationId,
      assistantMessage.id,
      model,
      fullContent,
      estimatedInputChars,
      hasUpstreamUsage ? { inputTokens: totalInputTokens, outputTokens: totalOutputTokens } : null,
      !streamFailed,
      reasoningContent,
    )

    // 13. 收尾事件
    if (streamFailed) {
      this.writeEvent(res, 'error', { code: ErrorCode.AiUpstreamError, message: '上游模型调用失败' })
    } else {
      this.writeEvent(res, 'done', {
        usage: {
          inputTokens: hasUpstreamUsage ? totalInputTokens : estimatedInputChars,
          outputTokens: hasUpstreamUsage ? totalOutputTokens : fullContent.length,
          credits,
          remainingCredits: remainingCredits.toString(),
        },
      })
    }
    res.end()
  }

  /** 单轮上游调用：累积 delta 下发、tool_calls 收集、usage 返回 */
  private async callUpstream(
    model: ChatModel,
    messages: EngineChatMessage[],
    tools: EngineTool[],
    res: Response,
    signal: AbortSignal,
  ): Promise<RoundResult> {
    let content = ''
    const toolCalls: EngineToolCall[] = []
    let usage: EngineUsage | null = null
    let failed = false
    let reasoningContent = ''

    let heartbeat: NodeJS.Timeout | null = null
    const resetHeartbeat = () => {
      if (heartbeat) clearInterval(heartbeat)
      heartbeat = setInterval(() => this.writeComment(res, 'ping'), HEARTBEAT_MS)
    }
    resetHeartbeat()

    try {
      for await (const event of this.providerService.streamChat({
        baseUrl: model.provider.baseUrl,
        apiKey: model.provider.apiKey ?? '',
        model: model.model,
        messages,
        tools,
        signal,
      })) {
        if (event.type === 'delta') {
          content += event.content
          this.writeEvent(res, 'delta', { content: event.content })
          resetHeartbeat()
        } else if (event.type === 'tool_calls') {
          toolCalls.push(...event.toolCalls)
        } else if (event.type === 'done') {
          usage = event.usage
          if (event.reasoningContent) reasoningContent = event.reasoningContent
        }
      }
    } catch (error) {
      failed = true
      this.logger.error(`上游调用失败（模型 ${model.model}）：${this.describeError(error)}`)
    } finally {
      if (heartbeat) clearInterval(heartbeat)
    }

    return { content, toolCalls, usage, failed, reasoningContent }
  }

  /** 提取上游错误的关键信息（便于日志定位） */
  private describeError(error: unknown): string {
    if (error && typeof error === 'object') {
      const e = error as { status?: number; message?: string; error?: unknown }
      const detail = e.error ? JSON.stringify(e.error).slice(0, 500) : ''
      return `[status=${e.status ?? '?'}] ${e.message ?? '未知错误'} ${detail}`
    }
    return String(error)
  }

  /**
   * 处理工具调用：
   * - read 工具：执行 handler → 留痕 → 发 tool_result 事件 → 结果回喂
   * - write 工具：留痕 pending → 写确认单 → 发 tool_confirm 事件 → 标记 stop 结束本轮
   */
  private async processToolCalls(
    user: AuthUser,
    userId: bigint,
    conversationId: bigint,
    assistantMessageId: bigint,
    toolCalls: EngineToolCall[],
    res: Response,
  ): Promise<{ stop: boolean; toolMessages: EngineChatMessage[] }> {
    const toolMessages: EngineChatMessage[] = []
    let stop = false

    for (const tc of toolCalls) {
      const tool = this.toolRegistry.get(tc.name)
      // 工具不存在
      if (!tool) {
        toolMessages.push({ role: 'tool', content: '工具不存在或未启用', tool_call_id: tc.id })
        continue
      }
      // 权限二次校验（防缓存间隙）
      if (tool.perms && !(await this.permissionService.hasPermission(user.userId, tool.perms))) {
        toolMessages.push({ role: 'tool', content: '无权限使用该工具', tool_call_id: tc.id })
        continue
      }

      const params = this.parseToolArguments(tc.arguments)

      if (tool.risk === 'read') {
        // read 自动执行
        const result = await this.executeReadTool(user, userId, conversationId, assistantMessageId, tool, tc, params, res)
        toolMessages.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: tc.id })
      } else {
        // write：留痕 pending + 确认单 + tool_confirm 事件，本轮结束
        await this.emitWriteToolConfirm(user, userId, conversationId, assistantMessageId, tool, tc, params, res)
        stop = true
        break
      }
    }

    return { stop, toolMessages }
  }

  /** 执行 read 工具：handler + 留痕 + tool_result 事件；返回结果（含失败兜底） */
  private async executeReadTool(
    user: AuthUser,
    userId: bigint,
    conversationId: bigint,
    assistantMessageId: bigint,
    tool: AiTool,
    tc: EngineToolCall,
    params: Record<string, unknown>,
    res: Response,
  ): Promise<unknown> {
    try {
      const result = await tool.handler({ user }, params)
      await this.prisma.aiToolCall.create({
        data: {
          conversationId,
          messageId: assistantMessageId,
          userId,
          toolName: tool.name,
          params: params as object,
          risk: 'read',
          status: 'executed',
          result: this.truncate(JSON.stringify(result), 2000),
        },
      })
      this.writeEvent(res, 'tool_result', {
        toolCallId: tc.id,
        toolName: tool.name,
        title: tool.title,
        status: 'executed',
        summary: this.truncate(JSON.stringify(result), 200),
      })
      return result
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : '工具执行失败'
      this.logger.error(`read 工具 ${tool.name} 执行失败：${errMsg}`)
      await this.prisma.aiToolCall.create({
        data: {
          conversationId,
          messageId: assistantMessageId,
          userId,
          toolName: tool.name,
          params: params as object,
          risk: 'read',
          status: 'failed',
          errorMsg: errMsg,
        },
      })
      this.writeEvent(res, 'tool_result', {
        toolCallId: tc.id,
        toolName: tool.name,
        title: tool.title,
        status: 'failed',
        summary: '工具执行失败',
      })
      return { error: '工具执行失败', message: errMsg }
    }
  }

  /** write 工具：留痕 pending + 写确认单 + 发 tool_confirm 事件 */
  private async emitWriteToolConfirm(
    user: AuthUser,
    userId: bigint,
    conversationId: bigint,
    assistantMessageId: bigint,
    tool: AiTool,
    tc: EngineToolCall,
    params: Record<string, unknown>,
    res: Response,
  ): Promise<void> {
    // P4b §15.6：工具有 summarize → 结构化确认卡摘要（返回 null/抛错则回退 P2b 现状字符串）；
    // 既有 7 个工具未实现钩子，走现状分支，零改动。params 始终存原始参数（content 全文）留痕，摘要只进确认单与事件。
    let structuredSummary: unknown
    try {
      structuredSummary = tool.summarize ? await tool.summarize(params, { user }) : undefined
    } catch {
      structuredSummary = undefined
    }
    const summary = structuredSummary ?? this.truncate(JSON.stringify(params), 200)

    // 留痕 pending（id 即确认单 ID）
    const record = await this.prisma.aiToolCall.create({
      data: {
        conversationId,
        messageId: assistantMessageId,
        userId,
        toolName: tool.name,
        params: params as object,
        risk: 'write',
        status: 'pending',
      },
    })

    // 写确认单（TTL 10 分钟，含 summary：过期前刷新页面恢复卡片用）
    await this.redis.client.set(
      RedisKey.aiConfirm(record.id.toString()),
      JSON.stringify({
        userId: userId.toString(),
        conversationId: conversationId.toString(),
        toolName: tool.name,
        params,
        summary,
      }),
      'EX',
      CONFIRM_TTL_SEC,
    )

    this.writeEvent(res, 'tool_confirm', {
      toolCallId: record.id.toString(),
      toolName: tool.name,
      title: tool.title,
      summary,
      params,
    })
  }

  /** 解析模型生成的 JSON 参数字符串，非法则返回空对象 */
  private parseToolArguments(argumentsStr: string): Record<string, unknown> {
    try {
      const parsed = JSON.parse(argumentsStr || '{}')
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }

  /** 截断字符串到指定长度 */
  private truncate(str: string, max: number): string {
    return str.length > max ? `${str.slice(0, max)}…` : str
  }

  /** 确定可用工具：模型 support_tool=1 且按当前用户权限过滤；过滤后为空则不携带 tools */
  private async getAvailableTools(
    user: AuthUser,
    model: ChatModel,
  ): Promise<{ tools: EngineTool[] }> {
    if (model.supportTool !== 1) return { tools: [] }

    const available: AiTool[] = []
    for (const tool of this.toolRegistry.getAll()) {
      if (!tool.perms || (await this.permissionService.hasPermission(user.userId, tool.perms))) {
        available.push(tool)
      }
    }

    const tools: EngineTool[] = available.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }))
    return { tools }
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
   * 拼装上下文（P5 R67 实测预算）：system prompt 最前（恒完整）+ 历史消息（按实测预算从最早丢弃）
   * + 当前消息；tools schema 占用由调用方以过滤后子集实测传入。
   * inputChars 含 tools schema（R68 兜底估算基数）。
   */
  private async buildContext(
    user: AuthUser,
    conversationId: bigint,
    excludeMessageId: bigint,
    currentContent: string,
    model: ChatModel,
    tools: EngineTool[],
  ): Promise<{ messages: EngineChatMessage[]; inputChars: number }> {
    const history = await this.prisma.aiMessage.findMany({
      where: { conversationId, deletedAt: null, id: { not: excludeMessageId } },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_TAKE,
    })

    const systemPrompt = await this.systemPromptService.build(user)
    const toolsChars = this.toolsCharsOf(tools)
    const systemMsg: EngineChatMessage = { role: 'system', content: systemPrompt }
    const picked = this.pickHistory(
      history,
      this.computeHistoryBudget(model, systemPrompt.length, toolsChars, currentContent.length, tools.length),
    )

    const currentMsg: EngineChatMessage = { role: 'user', content: currentContent }
    const messages: EngineChatMessage[] = [systemMsg, ...picked, currentMsg]
    const inputChars = messages.reduce((sum, m) => sum + m.content.length, 0) + toolsChars
    return { messages, inputChars }
  }

  /** tools schema 实测占用（字符口径：1 token ≈ 1 字符；过滤后子集，各人因权限不同而不同，D65） */
  private toolsCharsOf(tools: EngineTool[]): number {
    return tools.length === 0 ? 0 : JSON.stringify(tools).length
  }

  /**
   * 历史截取预算（P5 R67）：max_context − 输出预留(25%) − system prompt 实测 − tools schema 实测
   * − 当前消息（本轮必然入参，故同样先从预算中扣除）。
   * 不足下限（MIN_HISTORY_CHARS）时保底并告警（提示调大模型上下文或精简工具/手册）。
   * 另于每轮对话开头记 debug 日志（实算值），便于调优。
   */
  private computeHistoryBudget(
    model: ChatModel,
    systemChars: number,
    toolsChars: number,
    currentChars: number,
    toolsCount: number,
  ): number {
    const outputReserve = Math.floor(model.maxContext * OUTPUT_RESERVE_RATIO)
    const budget = model.maxContext - outputReserve - systemChars - toolsChars - currentChars
    if (budget < MIN_HISTORY_CHARS) {
      this.logger.warn(
        `上下文预算不足：maxContext=${model.maxContext} 输出预留=${outputReserve} system=${systemChars} ` +
          `tools=${toolsCount}(${toolsChars} 字符) 当前消息=${currentChars} → 历史预算 ${budget} < ${MIN_HISTORY_CHARS}，` +
          '已按下限保底截取（建议调大模型 max_context 或精简工具/手册字数）',
      )
      return MIN_HISTORY_CHARS
    }
    this.logger.debug(
      `上下文预算：model maxContext=${model.maxContext} tools=${toolsCount} toolsBudget=${toolsChars} ` +
        `systemBudget=${systemChars} historyBudget=${budget}`,
    )
    return budget
  }

  /**
   * 历史消息截取（从最新往回装，装不下即停——等价于「装不下时继续从最早历史消息丢弃」）：
   * 返回正序消息数组；system prompt 与 tools schema 恒完整（不受本函数影响）。
   * @param historyNewestFirst 必须按**时间倒序**传入（最新在前），与查询 orderBy desc 一致
   */
  private pickHistory(
    historyNewestFirst: Array<{ role: string; content: string }>,
    budget: number,
  ): EngineChatMessage[] {
    const picked: EngineChatMessage[] = []
    let used = 0
    for (const m of historyNewestFirst) {
      const cost = m.content.length
      if (used + cost > budget) break
      picked.push({ role: m.role as 'user' | 'assistant', content: m.content })
      used += cost
    }
    picked.reverse()
    return picked
  }

  /** 结算并更新 assistant 消息 */
  private async finalizeAssistant(
    userId: bigint,
    conversationId: bigint,
    assistantMessageId: bigint,
    model: { id: bigint },
    fullContent: string,
    inputChars: number,
    upstreamUsage: { inputTokens: number; outputTokens: number } | null,
    success: boolean,
    reasoningContent = '',
  ): Promise<{ credits: number; remainingCredits: bigint }> {
    const inputTokens = upstreamUsage?.inputTokens ?? inputChars
    const outputTokens = upstreamUsage?.outputTokens ?? fullContent.length
    const estimated = upstreamUsage ? 0 : 1

    const { credits, remainingCredits } = await this.creditService.settle({
      userId,
      conversationId,
      messageId: assistantMessageId,
      modelId: model.id,
      inputTokens,
      outputTokens,
      estimated,
    })

    await this.prisma.aiMessage.update({
      where: { id: assistantMessageId },
      data: {
        content: fullContent,
        tokensInput: inputTokens,
        tokensOutput: outputTokens,
        credits,
        status: success ? 1 : 2,
        ...(reasoningContent ? { reasoningContent } : {}),
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
