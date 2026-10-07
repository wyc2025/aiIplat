import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Prisma } from '@prisma/client'
import type { Response } from 'express'
import { ErrorCode } from '../../../common/constants/error-code'
import { RedisKey } from '../../../common/constants/redis-key'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { RedisService } from '../../../infra/redis/redis.service'
import type { AuthUser } from '../../../gateway/guards/jwt.strategy'
import { PermissionService } from '../../../gateway/services/permission.service'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import { AI_MAX_TOOL_ROUNDS_DEFAULT, AI_MAX_TOOL_ROUNDS_LIMIT } from '../../../config/ai.config'
import { CloudFacade } from '../../cloud/facade/cloud-facade.service'
import { CreditService } from '../credit/credit.service'
import { ProviderService } from '../engine/provider.service'
import type { EngineChatMessage, EngineTool, EngineToolCall, EngineUsage } from '../engine/engine.types'
import { ToolRegistry } from '../tool/tool.registry'
import { groupOfTool, resolveToolGroups, type ToolRoutingResult } from '../tool/tool.groups'
import type { AiTool } from '../tool/tool.types'
import {
  ATTACHMENT_ALLOWED_EXTS,
  ATTACHMENT_MAX_BYTES,
  MANIFEST_MAX_ITEMS,
  buildInjectedBlock,
  buildInvalidBlock,
  decodeAttachmentText,
  estimateInjectedChars,
  looksBinaryContent,
  parseStoredAttachments,
  planAttachmentModes,
  renderAttachmentManifest,
  resolveAttachments,
  type AttachmentMeta,
  type ManifestEntry,
} from './attachment-resolver'
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
/**
 * 收尾轮指令（P10 T100）：轮次或往返预算耗尽后**不携带 tools** 再调一次上游，
 * 强制模型基于已获取的信息作答——否则用户看到的是「AI 读完文件就莫名其妙停了」
 * （旧行为：轮次用尽即 break，模型从未见到最后一批工具结果，也没有机会总结）。
 */
const FINAL_ROUND_INSTRUCTION =
  '（系统提示：本轮工具调用次数已达上限，接下来不再提供任何工具。请立即基于你已经获取到的信息给出结论或阶段性总结；' +
  '若仍有未读完的内容，请明确说明还缺什么、以及建议用户如何继续。）'

/**
 * 工具往返累计字符占 max_context 的比例上限（P10 T100 起；**P21 T173 起仅作观测阈值**，
 * 不再作为硬断依据——旧逻辑在工具结果回喂后才检查，超限内容已不可撤回、收尾轮仍会硬发；
 * 硬约束改为「调用前预估 + 截断」，见 projectedInputChars / truncateToolResultsToFit）。
 */
const TOOL_ROUNDTRIP_BUDGET_RATIO = 0.4
/** 输入硬预算比例（P21 T173）：与历史截取同口径，给输出预留 25%；工具往返后的总输入不得超过 */
const INPUT_BUDGET_RATIO = 1 - OUTPUT_RESERVE_RATIO
/** 工具结果截断占位符（P21 T173）：超预算时替换最旧的 tool 消息 content */
const TOOL_RESULT_TRUNCATED_PLACEHOLDER = '（此结果过长已省略，如需完整内容请重新调用相应工具读取）'
/** 上游瞬时错误重试退避（P21 T174）：1s、2s 各一次（各含 ±30% 抖动） */
const UPSTREAM_RETRY_DELAYS_MS = [1000, 2000]
/** 重试退避抖动比例 */
const UPSTREAM_RETRY_JITTER = 0.3
/** 确认单携带的同批 read 结果容量上限（P21 T175）：单条 / 合计字符，超限截断 */
const PRIOR_RESULT_MAX_CHARS = 20_000
const PRIOR_TOTAL_MAX_CHARS = 50_000

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
  /** 失败时的原始异常（重试判定用，交 engine 层 isRetryableUpstreamError 分类） */
  error: unknown
  /** 失败详情（[status=…] 前缀；P21 T174 落库 ai_message.error_msg 追溯用） */
  errorDetail: string | null
}

/**
 * 确认单携带的同批 read 调用（P21 T175）：write 触发确认卡时，同一批 tool_calls 里
 * 已执行的 read 结果随确认单存 Redis，确认链路重建上下文时回喂——修复「read 在前、
 * write 在后」时 read 结果被丢弃、确认总结缺上下文的问题。
 */
interface PriorToolCallEntry {
  /** 上游返回的 tool_call id（重建 assistant.tool_calls 时保持协议对应） */
  id: string
  name: string
  arguments: string
  /** 工具执行结果（JSON 序列化，含失败兜底形态） */
  result: string
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
    private readonly cloudFacade: CloudFacade,
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
    const confirm = JSON.parse(confirmRaw) as {
      userId: string
      conversationId: string
      toolName: string
      params: Record<string, unknown>
      /** P21 T175：同批 read 上下文与被暂停调用（旧确认单无此字段，按缺省兼容） */
      priorToolCalls?: PriorToolCallEntry[]
      skippedToolCalls?: string[]
    }
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
    // 组路由口径（P6 T77 建单条 user 消息；P21.1 T178 方案 B 升级为阶段感知）：
    // 路由输入 = 最近 user 消息 + 原 assistant 消息文本（多阶段任务「创建应用 → 挂靠 → 写文件」
    // 的语义演进不被首条消息的词根锁死），并锚定本次确认工具与同批已执行 read 工具所在组
    // （确定性并入）——实测会话 #288 中 cloud 组因 user 消息无云盘词根而全程缺席，
    // AI 只能如实说「没有 write_cloud_file」。
    const routingText = await this.lastUserMessageText(conversationId)
    const combinedRoutingText = [routingText, originalMessage.content]
      .filter((t) => t && t.length > 0)
      .join('\n')
    const anchorToolNames = [record.toolName, ...(confirm.priorToolCalls?.map((p) => p.name) ?? [])]
    const { tools, routing } = await this.getAvailableTools(user, model, combinedRoutingText, anchorToolNames)
    const messages = await this.buildConfirmContext(
      user,
      record,
      toolResult,
      model,
      originalMessage,
      tools,
      routing,
      confirm.priorToolCalls ?? [],
      confirm.skippedToolCalls ?? [],
    )

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

    // 10. 多轮上游调用（总结后可能再触发工具；轮次/往返预算耗尽 → 收尾轮，P10 T100）
    const rounds = await this.runToolRounds({
      user,
      userId,
      conversationId,
      assistantMessageId: assistantMessage.id,
      model,
      messages,
      tools,
      res,
      signal,
    })
    const fullContent = rounds.content
    const streamFailed = rounds.failed

    // 11. 结算新消息（R68 兜底估算基数 = 初始 messages + tools schema + tool 往返消息）
    const inputChars =
      messages.reduce((sum, m) => sum + m.content.length, 0) + this.toolsCharsOf(tools) + rounds.roundTripChars
    const { credits, remainingCredits } = await this.finalizeAssistant(
      userId,
      conversationId,
      assistantMessage.id,
      model,
      fullContent,
      inputChars,
      rounds.hasUsage ? { inputTokens: rounds.inputTokens, outputTokens: rounds.outputTokens } : null,
      !streamFailed,
      rounds.reasoningContent,
      streamFailed ? rounds.errorDetail : undefined,
    )

    if (streamFailed) {
      this.writeEvent(res, 'error', { code: ErrorCode.AiUpstreamError, message: '上游模型调用失败' })
    } else {
      this.writeEvent(res, 'done', {
        usage: {
          inputTokens: rounds.hasUsage ? rounds.inputTokens : inputChars,
          outputTokens: rounds.hasUsage ? rounds.outputTokens : fullContent.length,
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
   *
   * P21 T175：原 assistant 消息带**整批** tool_calls（同批 read + 本次 write，id 分别用上游
   * tool_call id 与消息 id），后跟同序 tool 消息——修复「read 在前、write 在后」的混合调用中
   * read 结果被丢弃、确认总结缺上下文的问题；write 之后被暂停的调用以系统提示告知（防误以为已完成）。
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
    routing: ToolRoutingResult,
    priorToolCalls: PriorToolCallEntry[],
    skippedToolCalls: string[],
  ): Promise<EngineChatMessage[]> {
    // 历史消息（正序，排除原 assistant 占位消息）
    const history = await this.prisma.aiMessage.findMany({
      where: { conversationId: record.conversationId, deletedAt: null, id: { not: record.messageId } },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_TAKE,
    })

    const paramsObj = (record.params ?? {}) as Record<string, unknown>
    // P20 R161（能力同源）：system prompt 的能力清单按本轮**实发**工具集收窄
    const systemPrompt = await this.systemPromptService.build(
      user,
      new Set(tools.map((tool) => tool.function.name)),
    )
    // P10 R84：会话可读清单随每轮组装刷新（确认回填链路同样注入；附件正文按最新文件内容重读，§26.7）
    const manifest = await this.buildAttachmentManifest(BigInt(user.userId), record.conversationId)
    const systemContent = manifest ? `${systemPrompt}\n\n${manifest}` : systemPrompt
    // P21 T175：本轮必然回喂的 tool 结果 = write 结果 + 同批 read 结果合计 + 暂停告知
    const skippedNote =
      skippedToolCalls.length > 0
        ? `\n（系统提示：以下工具调用因需逐一确认已暂停、本轮未执行：${skippedToolCalls.join('、')}；如仍需要请在总结后再次提出。）`
        : ''
    const fedToolChars =
      toolResult.length + priorToolCalls.reduce((sum, p) => sum + p.result.length, 0) + skippedNote.length
    const picked = await this.pickHistoryWithAttachments(
      BigInt(user.userId),
      history,
      this.computeHistoryBudget(
        model,
        systemContent.length,
        this.toolsCharsOf(tools),
        fedToolChars,
        tools.length,
        routing,
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
      { role: 'system', content: systemContent },
      ...picked,
      // 原 assistant 消息带整批 tool_calls（同批 read 用上游 tool_call id、write 用消息 id）
      // + reasoning_content 回传；tool 消息与 tool_calls 一一保持同序
      {
        role: 'assistant',
        content: originalContent,
        tool_calls: [
          ...priorToolCalls.map((p) => ({ id: p.id, name: p.name, arguments: p.arguments })),
          {
            id: record.messageId.toString(),
            name: record.toolName,
            arguments: JSON.stringify(paramsObj),
          },
        ],
        ...(originalMessage.reasoningContent ? { reasoning_content: originalMessage.reasoningContent } : {}),
      },
      ...priorToolCalls.map((p) => ({ role: 'tool' as const, tool_call_id: p.id, content: p.result })),
      { role: 'tool', tool_call_id: record.messageId.toString(), content: toolResult + skippedNote },
    ]
  }

  /** 会话最近一条 user 消息文本（确认回填链路的组路由输入；无则 undefined = 全量兜底） */
  private async lastUserMessageText(conversationId: bigint): Promise<string | undefined> {
    const message = await this.prisma.aiMessage.findFirst({
      where: { conversationId, role: 'user', deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { content: true },
    })
    return message?.content
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

    // 6. 附件解析链（P10 D82/R82/R83）：校验（30001/30012/30013）→ 读字节 → 编码探测 → inject/listed 分流
    const resolvedAttachments = await resolveAttachments(this.cloudFacade, userId, dto.attachments ?? [])
    const { metas: attachmentMetas, injectedText } = planAttachmentModes(resolvedAttachments)

    // 7. 存 user 消息（附件**只落元信息**，内容不冗余，D82）
    const userMessage = await this.prisma.aiMessage.create({
      data: {
        conversationId,
        role: 'user',
        content: dto.content,
        status: 1,
        ...(attachmentMetas.length > 0
          ? { attachments: attachmentMetas as unknown as Prisma.InputJsonValue }
          : {}),
      },
    })

    // 8. 建 assistant 占位消息
    const assistantMessage = await this.prisma.aiMessage.create({
      data: { conversationId, role: 'assistant', content: '', modelId: model.id, status: 1 },
    })

    // 9. 确定可用工具（模型支持 + 权限过滤 + 组路由，P6 T77）——先定工具子集，再按其 schema 实测占用扣减历史预算（R67）
    const { tools, routing } = await this.getAvailableTools(user, model, dto.content)

    // 10. 拼装上下文（system + tools 恒完整，历史从最早丢弃；P10 附件注入与清单随组装进行）
    const { messages, inputChars } = await this.buildContext(
      user,
      conversationId,
      userMessage.id,
      dto.content,
      model,
      tools,
      routing,
      { metas: attachmentMetas, injectedText },
    )

    // 11. 进入流式（P10：meta 附本次附件元信息，前端据此渲染气泡模式标签，R86/R87）
    this.setupSseHeaders(res)
    this.writeEvent(res, 'meta', {
      conversationId: conversationId.toString(),
      userMessageId: userMessage.id.toString(),
      assistantMessageId: assistantMessage.id.toString(),
      ...(attachmentMetas.length > 0 ? { attachments: attachmentMetas } : {}),
    })

    // 12. 多轮上游调用（工具调用循环 + 轮次/往返预算耗尽后的收尾轮，P10 T100）
    const rounds = await this.runToolRounds({
      user,
      userId,
      conversationId,
      assistantMessageId: assistantMessage.id,
      model,
      messages,
      tools,
      res,
      signal,
    })
    const fullContent = rounds.content
    const streamFailed = rounds.failed

    // 13. 结算（合并计费）+ 更新 assistant 消息
    // R68：兜底估算基数 = messages（含 tool 往返）+ tools schema（无上游 usage 时才真正生效）
    const estimatedInputChars = inputChars + rounds.roundTripChars
    const { credits, remainingCredits } = await this.finalizeAssistant(
      userId,
      conversationId,
      assistantMessage.id,
      model,
      fullContent,
      estimatedInputChars,
      rounds.hasUsage ? { inputTokens: rounds.inputTokens, outputTokens: rounds.outputTokens } : null,
      !streamFailed,
      rounds.reasoningContent,
      streamFailed ? rounds.errorDetail : undefined,
    )

    // 14. 收尾事件
    if (streamFailed) {
      this.writeEvent(res, 'error', { code: ErrorCode.AiUpstreamError, message: '上游模型调用失败' })
    } else {
      this.writeEvent(res, 'done', {
        usage: {
          inputTokens: rounds.hasUsage ? rounds.inputTokens : estimatedInputChars,
          outputTokens: rounds.hasUsage ? rounds.outputTokens : fullContent.length,
          credits,
          remainingCredits: remainingCredits.toString(),
        },
      })
    }
    res.end()
  }

  /** 多轮工具调用循环的产出（P10 T100 抽出，chat 与 confirm 两条链共用） */
  private async runToolRounds(params: {
    user: AuthUser
    userId: bigint
    conversationId: bigint
    assistantMessageId: bigint
    model: ChatModel
    messages: EngineChatMessage[]
    tools: EngineTool[]
    res: Response
    signal: AbortSignal
  }): Promise<{
    content: string
    reasoningContent: string
    inputTokens: number
    outputTokens: number
    hasUsage: boolean
    roundTripChars: number
    failed: boolean
    /** 由 write 工具确认卡终止（后续交由 /ai/tool/confirm 链路接管） */
    awaitingConfirm: boolean
    /** 最终失败轮的上游错误详情（P21 T174：随结算落 ai_message.error_msg） */
    errorDetail: string | null
  }> {
    const { user, userId, conversationId, assistantMessageId, model, res, signal } = params
    const toolRoundTripBudget = Math.floor(model.maxContext * TOOL_ROUNDTRIP_BUDGET_RATIO)
    // P21 T173：输入硬预算（与历史截取同口径）——每次调上游**前**预估，超限先截断再发，
    // 取代旧「回喂后才发现超预算」的检查（旧逻辑下历史 75% + 往返 40% 可叠加到 115%，
    // admin 会话 #377 tokens_input 118,865/128,000 即此路径逼近上限的实证）
    const inputBudget = Math.floor(model.maxContext * INPUT_BUDGET_RATIO)

    let content = ''
    let reasoningContent = ''
    let inputTokens = 0
    let outputTokens = 0
    let hasUsage = false
    let roundTripChars = 0
    let roundMessages = params.messages
    let needFinale = false
    let awaitingConfirm = false
    let errorDetail: string | null = null

    for (let round = 0; round < this.maxToolRounds; round++) {
      // P21 T173：调用前预估（content + reasoning_content + tools schema 全口径）
      if (this.projectedInputChars(roundMessages, params.tools) > inputBudget) {
        const removed = this.truncateToolResultsToFit(roundMessages, inputBudget, params.tools)
        roundTripChars = Math.max(0, roundTripChars - removed)
        this.logger.warn(
          `工具往返超出输入预算 ${inputBudget}（maxContext ${model.maxContext}），已截断 ${removed} 字符的旧工具结果`,
        )
        if (removed > 0) {
          // 已动过刀：不再允许继续调工具，防下一轮再次膨胀——直接进收尾轮
          needFinale = true
          break
        }
        // 无可截断（如首轮即超限的 MIN_HISTORY 保底场景）：维持现状硬发，交由上游裁决
      }

      const roundResult = await this.callUpstream(model, roundMessages, params.tools, res, signal)
      if (roundResult.failed) {
        errorDetail = roundResult.errorDetail
        return { content, reasoningContent, inputTokens, outputTokens, hasUsage, roundTripChars, failed: true, awaitingConfirm, errorDetail }
      }

      content += roundResult.content
      if (roundResult.reasoningContent) reasoningContent = roundResult.reasoningContent
      if (roundResult.usage) {
        inputTokens += roundResult.usage.inputTokens
        outputTokens += roundResult.usage.outputTokens
        hasUsage = true
      }

      // 无工具调用：模型已给出终答，正常结束
      if (roundResult.toolCalls.length === 0) break

      const processed = await this.processToolCalls(
        user,
        userId,
        conversationId,
        assistantMessageId,
        roundResult.toolCalls,
        res,
      )
      if (processed.stop) {
        awaitingConfirm = true
        break
      }

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

      // 轮次用尽 → 收尾轮（不再允许调工具，强制给结论）；
      // 往返观测阈值（P21 T173 起仅告警不再硬断，硬约束已前移到调用前预估）
      if (round === this.maxToolRounds - 1) {
        needFinale = true
      }
      if (roundTripChars > toolRoundTripBudget) {
        this.logger.debug(
          `工具往返字符 ${roundTripChars} 超过观测阈值 ${toolRoundTripBudget}（maxContext ${model.maxContext} × ${TOOL_ROUNDTRIP_BUDGET_RATIO}，硬约束已改为调用前预估截断）`,
        )
      }
      if (needFinale) break
    }

    if (needFinale) {
      this.logger.warn(
        `工具轮次/往返预算耗尽 → 追加收尾轮（上限 ${this.maxToolRounds} 轮，往返 ${roundTripChars} 字符）`,
      )
      // P21 T173：收尾轮同样先预估（不带 tools，schema 占用已释放但仍可能超）
      if (this.projectedInputChars(roundMessages, []) > inputBudget) {
        const removed = this.truncateToolResultsToFit(roundMessages, inputBudget, [])
        roundTripChars = Math.max(0, roundTripChars - removed)
        this.logger.warn(`收尾轮输入仍超预算 ${inputBudget}，已再截断 ${removed} 字符的旧工具结果`)
      }
      const finale = await this.callUpstream(
        model,
        [...roundMessages, { role: 'user', content: FINAL_ROUND_INSTRUCTION }],
        [],
        res,
        signal,
      )
      if (finale.failed) {
        errorDetail = finale.errorDetail
        return { content, reasoningContent, inputTokens, outputTokens, hasUsage, roundTripChars, failed: true, awaitingConfirm, errorDetail }
      }
      content += finale.content
      if (finale.reasoningContent) reasoningContent = finale.reasoningContent
      if (finale.usage) {
        inputTokens += finale.usage.inputTokens
        outputTokens += finale.usage.outputTokens
        hasUsage = true
      }
      roundTripChars += finale.content.length
    }

    return { content, reasoningContent, inputTokens, outputTokens, hasUsage, roundTripChars, failed: false, awaitingConfirm, errorDetail: null }
  }

  /**
   * 单轮上游调用（P21 T174 加固外壳）：瞬时错误（429/5xx/连接层）自动重试退避。
   * 重试安全前提（硬约束）：本轮尚无任何 delta 下发且未收到 tool_calls——否则客户端会看到
   * 重复文本；参数/鉴权类 4xx 重试无意义；客户端已断开（signal.aborted）不重试。
   */
  private async callUpstream(
    model: ChatModel,
    messages: EngineChatMessage[],
    tools: EngineTool[],
    res: Response,
    signal: AbortSignal,
  ): Promise<RoundResult> {
    let result: RoundResult | null = null
    for (let attempt = 0; ; attempt++) {
      result = await this.callUpstreamOnce(model, messages, tools, res, signal)
      if (!result.failed) break
      const delay = UPSTREAM_RETRY_DELAYS_MS[attempt]
      if (
        delay === undefined ||
        result.content.length > 0 ||
        result.toolCalls.length > 0 ||
        signal.aborted ||
        !this.providerService.isRetryableUpstreamError(result.error)
      ) {
        break
      }
      const jittered = delay * (1 + (Math.random() * 2 - 1) * UPSTREAM_RETRY_JITTER)
      this.logger.warn(
        `上游瞬时错误（模型 ${model.model}，第 ${attempt + 1}/${UPSTREAM_RETRY_DELAYS_MS.length + 1} 次尝试），` +
          `${Math.round(jittered)}ms 后重试：${result.errorDetail ?? ''}`,
      )
      await new Promise((resolve) => setTimeout(resolve, jittered))
    }
    return result
  }

  /** 单次上游尝试：累积 delta 下发、tool_calls 收集、usage 返回（原 callUpstream 主体） */
  private async callUpstreamOnce(
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
    let caughtError: unknown = null

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
      caughtError = error
      this.logger.error(`上游调用失败（模型 ${model.model}）：${this.describeError(error)}`)
    } finally {
      if (heartbeat) clearInterval(heartbeat)
    }

    return {
      content,
      toolCalls,
      usage,
      failed,
      reasoningContent,
      error: caughtError,
      errorDetail: failed ? this.describeError(caughtError) : null,
    }
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
   *
   * P21 T175：同批 write 之前已执行的 read 结果（priorToolCalls）与 write 之后被暂停的调用
   * （skippedToolCalls）一并收集——随确认单存 Redis，确认链路重建上下文时回喂；旧逻辑直接
   * break 丢弃（read 结果无法进入确认总结、被暂停的调用模型也不知情，会误以为已完成）。
   */
  private async processToolCalls(
    user: AuthUser,
    userId: bigint,
    conversationId: bigint,
    assistantMessageId: bigint,
    toolCalls: EngineToolCall[],
    res: Response,
  ): Promise<{
    stop: boolean
    toolMessages: EngineChatMessage[]
    /** 同批 write 之前已执行的 read 调用（含失败兜底形态） */
    priorToolCalls: PriorToolCallEntry[]
    /** write 之后被暂停未执行的调用名（回喂告知模型） */
    skippedToolCalls: string[]
  }> {
    const toolMessages: EngineChatMessage[] = []
    const priorToolCalls: PriorToolCallEntry[] = []
    const skippedToolCalls: string[] = []
    let stop = false

    for (let i = 0; i < toolCalls.length; i++) {
      const tc = toolCalls[i]
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
        const resultJson = JSON.stringify(result)
        toolMessages.push({ role: 'tool', content: resultJson, tool_call_id: tc.id })
        priorToolCalls.push({ id: tc.id, name: tool.name, arguments: tc.arguments, result: resultJson })
      } else {
        // write：留痕 pending + 确认单 + tool_confirm 事件，本轮结束；
        // 同批后续调用一并暂停（记录名称，随确认单回喂告知模型）
        skippedToolCalls.push(...toolCalls.slice(i + 1).map((t) => t.name))
        await this.emitWriteToolConfirm(
          user,
          userId,
          conversationId,
          assistantMessageId,
          tool,
          tc,
          params,
          res,
          priorToolCalls,
          skippedToolCalls,
        )
        stop = true
        break
      }
    }

    return { stop, toolMessages, priorToolCalls, skippedToolCalls }
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
    priorToolCalls: PriorToolCallEntry[],
    skippedToolCalls: string[],
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

    // P21 T175：同批 read 上下文随确认单带回（单条 2 万 / 合计 5 万字符上限，超限截断）
    let remaining = PRIOR_TOTAL_MAX_CHARS
    const priorForTicket = priorToolCalls
      .map((p) => {
        const cap = Math.max(0, Math.min(PRIOR_RESULT_MAX_CHARS, remaining))
        const result = p.result.length > cap ? `${p.result.slice(0, cap)}…` : p.result
        remaining -= result.length
        return { id: p.id, name: p.name, arguments: p.arguments, result }
      })
      .filter((p) => p.result.length > 0)

    // 写确认单（TTL 10 分钟，含 summary：过期前刷新页面恢复卡片用）
    await this.redis.client.set(
      RedisKey.aiConfirm(record.id.toString()),
      JSON.stringify({
        userId: userId.toString(),
        conversationId: conversationId.toString(),
        toolName: tool.name,
        params,
        summary,
        // P21 T175：确认链路重建上下文所需（旧确认单无此字段，确认链路按缺省兼容）
        priorToolCalls: priorForTicket,
        skippedToolCalls,
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

  /**
   * 确定可用工具：模型 support_tool=1 → 权限过滤（现状）→ 组路由（P6 T77 / D68 / R70）。
   * 两道串联顺序固定：先权限过滤、再组路由（路由不改变权限语义）。
   * 无命中 = 全量兜底；未归组工具（孤儿，启动已告警）出于安全一律保留。
   * routingText = 当前用户消息（不含历史），确认回填链路取最近一条 user 消息
   * **+ 原 assistant 消息文本**（P21.1 T178 方案 B：阶段感知，见 runToolConfirm）。
   * anchorToolNames（P21.1 T178）：锚定工具所在组强制并入下发集合——正在确认 / 刚执行过的
   * 工具必须仍可达，确定性并入、不依赖词根。
   */
  private async getAvailableTools(
    user: AuthUser,
    model: ChatModel,
    routingText?: string,
    anchorToolNames?: readonly string[],
  ): Promise<{ tools: EngineTool[]; routing: ToolRoutingResult; injected: number; total: number }> {
    const all = this.toolRegistry.getAll()
    const total = all.length
    if (model.supportTool !== 1) {
      return {
        tools: [],
        routing: { matchedKeywords: [], groups: [], fallback: false },
        injected: 0,
        total,
      }
    }

    // 第一道：权限过滤
    const permitted: AiTool[] = []
    for (const tool of all) {
      if (!tool.perms || (await this.permissionService.hasPermission(user.userId, tool.perms))) {
        permitted.push(tool)
      }
    }

    // 第二道：组路由（无命中全量兜底；孤儿工具恒保留）+ 锚定组并入（P21.1 T178）
    const routing = resolveToolGroups(routingText)
    const groups = new Set(routing.groups)
    for (const name of anchorToolNames ?? []) {
      const anchorGroup = groupOfTool(name)
      if (anchorGroup) groups.add(anchorGroup)
    }
    routing.groups = [...groups]
    const available = permitted.filter((t) => {
      const group = groupOfTool(t.name)
      return routing.fallback || group === null || groups.has(group)
    })

    this.logger.log(
      `[AI] tools injected: groups=${routing.fallback ? 'all(no-match)' : routing.groups.join(',')} ` +
        `count=${available.length}/${total}`,
    )
    if (this.debugAi) {
      this.logger.debug(
        `[AI] 工具路由明细：命中关键字=[${routing.matchedKeywords.join(',')}] ` +
          `权限内=${permitted.length}/${total} 下发=${available.length}`,
      )
    }

    const tools: EngineTool[] = available.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }))
    return { tools, routing, injected: available.length, total }
  }

  /** 路由明细日志开关（env DEBUG_AI=1；默认关） */
  private get debugAi(): boolean {
    return this.config.get<boolean>('ai.debugAi', false)
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
   * 拼装上下文（P5 R67 实测预算 + P10 §26.3 附件阶段）：
   * system（助手设定 + 手册 + 能力清单 + **会话可读清单**）→ 历史（含 inject 附件重读）→ 当前 user 消息。
   * 预算顺序：实测 system + tools 之后，**再扣 attachments（inject 实算字符）**，剩余为 history 预算（§26.4）。
   * inputChars 含 tools schema（R68 兜底估算基数）。
   */
  private async buildContext(
    user: AuthUser,
    conversationId: bigint,
    excludeMessageId: bigint,
    currentContent: string,
    model: ChatModel,
    tools: EngineTool[],
    routing: ToolRoutingResult | undefined,
    attachments: { metas: AttachmentMeta[]; injectedText: string },
  ): Promise<{ messages: EngineChatMessage[]; inputChars: number }> {
    const history = await this.prisma.aiMessage.findMany({
      where: { conversationId, deletedAt: null, id: { not: excludeMessageId } },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_TAKE,
    })

    // P20 R161（能力同源）：能力清单按本轮实发工具集收窄——与 tools 永远同源
    const systemPrompt = await this.systemPromptService.build(
      user,
      new Set(tools.map((tool) => tool.function.name)),
    )
    // P10 R84：会话可读清单（动态段，不计手册 2000 字帽）
    const manifest = await this.buildAttachmentManifest(BigInt(user.userId), conversationId)
    const systemContent = manifest ? `${systemPrompt}\n\n${manifest}` : systemPrompt

    const toolsChars = this.toolsCharsOf(tools)
    const systemMsg: EngineChatMessage = { role: 'system', content: systemContent }
    const picked = await this.pickHistoryWithAttachments(
      BigInt(user.userId),
      history,
      this.computeHistoryBudget(
        model,
        systemContent.length,
        toolsChars,
        currentContent.length,
        tools.length,
        routing,
        attachments.injectedText.length,
      ),
    )

    // P10 D83/R83：inject 附件全文拼进该条 user 消息**前部**（多附件按用户选择顺序）
    const currentMsg: EngineChatMessage = {
      role: 'user',
      content: attachments.injectedText
        ? `${attachments.injectedText}\n\n${currentContent}`
        : currentContent,
    }
    const messages: EngineChatMessage[] = [systemMsg, ...picked, currentMsg]
    const inputChars = messages.reduce((sum, m) => sum + m.content.length, 0) + toolsChars
    return { messages, inputChars }
  }

  /**
   * 会话可读清单（P10 R84）：本会话**所有 user 消息附件的并集**（去重按最近优先、失效标注、上限 20）。
   * 无附件 → 空串（system 不追加）。失效判定经云盘门面批量查（不读盘，零成本）。
   */
  private async buildAttachmentManifest(userId: bigint, conversationId: bigint): Promise<string> {
    const rows = await this.prisma.aiMessage.findMany({
      where: { conversationId, deletedAt: null, role: 'user' },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_TAKE,
      select: { attachments: true },
    })

    const entries: ManifestEntry[] = []
    const seen = new Set<string>()
    for (const row of rows) {
      for (const meta of parseStoredAttachments(row.attachments)) {
        if (seen.has(meta.fileId)) continue
        seen.add(meta.fileId)
        entries.push({ fileId: meta.fileId, name: meta.name, path: meta.path, chars: meta.chars, invalid: false })
        if (entries.length >= MANIFEST_MAX_ITEMS) break
      }
      if (entries.length >= MANIFEST_MAX_ITEMS) break
    }
    if (entries.length === 0) return ''

    const ids = entries.filter((entry) => /^\d+$/.test(entry.fileId)).map((entry) => BigInt(entry.fileId))
    const alive = await this.cloudFacade.filterAliveFileIds(userId, ids)
    for (const entry of entries) entry.invalid = !alive.has(entry.fileId)
    return renderAttachmentManifest(entries)
  }

  /**
   * 历史消息装配（P10 D82/R83 / §26.3）：与 pickHistory 同口径（按预算从最新往回装、装不下即停），
   * 差异：历史 user 消息中 **mode=inject** 的附件按 fileId **重读云盘**并拼回正文前部；
   * listed 附件不重读（清单已随 system 注入，模型按需自读）。
   * 容器纪律：**先按元信息判定预算、再决定是否读盘**——装不下的消息零文件读取。
   * 源文件被删/无权/超限 → 占位「（附件已失效）」降级（不报错、不阻断对话）。
   *
   * 2026-09-29 修复（思考模式多轮工具调用 400，PROGRESS 遗留 30 定案）：
   * ① **折叠相邻 assistant**——一次提问内多次工具/确认各自落一条 assistant 消息，历史里形成"AI 连着说"，
   *    上游（DeepSeek thinking 模式）会以 400 拒绝（文案 `The reasoning_content in the thinking mode
   *    must be passed back to the API` **误导**指向 reasoning，实为消息形态）→ 相邻 assistant 合并为一条（旧内容在前）；
   * ② **回传 `reasoning_content`**——DB 早已持久化该列，此前装配时被丢弃，一并带上；
   * ③ **跳过空正文 assistant**（失败残留 / 纯工具轮中间态），既是噪音也是非法形态来源。
   * 受控实验（会话 #148 真实数据直调）：折叠 → 200、补 reasoning → 200、仅丢空 → 仍 400 → 故 ①② 为充分修法，③ 作冗余加固。
   */
  private async pickHistoryWithAttachments(
    userId: bigint,
    historyNewestFirst: Array<{
      role: string
      content: string
      attachments: unknown
      reasoningContent?: string | null
    }>,
    budget: number,
  ): Promise<EngineChatMessage[]> {
    const picked: EngineChatMessage[] = []
    let used = 0
    for (const message of historyNewestFirst) {
      // ③ 空正文 assistant（失败残留/工具轮中间态）：跳过，不计入预算
      if (message.role === 'assistant' && !message.content.trim()) continue

      const injectMetas = parseStoredAttachments(message.attachments).filter((meta) => meta.mode === 'inject')
      const attachmentCost = injectMetas.reduce((sum, meta) => sum + estimateInjectedChars(meta), 0)
      if (used + message.content.length + attachmentCost > budget) break

      const blocks: string[] = []
      for (const meta of injectMetas) {
        const text = await this.readAttachmentText(userId, meta)
        blocks.push(text === null ? buildInvalidBlock(meta.name) : buildInjectedBlock(meta.name, text))
      }
      const content = blocks.length > 0 ? `${blocks.join('\n\n')}\n\n${message.content}` : message.content

      // ① 相邻 assistant 折叠（倒序遍历：picked 末尾是更"新"的那条，旧内容拼在其前，保持时间顺序）
      const prev = picked[picked.length - 1]
      if (message.role === 'assistant' && prev?.role === 'assistant') {
        prev.content = [content, prev.content].filter((text) => text && text.length > 0).join('\n\n')
        if (!prev.reasoning_content && message.reasoningContent) prev.reasoning_content = message.reasoningContent
        used += content.length
        continue
      }

      picked.push({
        role: message.role as 'user' | 'assistant',
        content,
        // ② 思考模式：assistant 历史消息的 reasoning_content 需原样回传
        ...(message.role === 'assistant' && message.reasoningContent
          ? { reasoning_content: message.reasoningContent }
          : {}),
      })
      used += content.length
    }
    picked.reverse()
    return picked
  }

  /** 按元信息重读附件正文（历史装配用）；已删/无权/超限/非文本/二进制 → null（失效降级，D82） */
  private async readAttachmentText(userId: bigint, meta: AttachmentMeta): Promise<string | null> {
    if (!/^\d+$/.test(meta.fileId)) return null
    try {
      const file = await this.cloudFacade.readTextFileById(userId, BigInt(meta.fileId), {
        exts: ATTACHMENT_ALLOWED_EXTS,
        maxBytes: ATTACHMENT_MAX_BYTES,
        purpose: '作为对话附件读取',
      })
      if (looksBinaryContent(file.content)) return null
      return decodeAttachmentText(file.content)
    } catch {
      return null
    }
  }

  /** tools schema 实测占用（字符口径：1 token ≈ 1 字符；过滤后子集，各人因权限不同而不同，D65） */
  private toolsCharsOf(tools: EngineTool[]): number {
    return tools.length === 0 ? 0 : JSON.stringify(tools).length
  }

  /**
   * 预估一次上游调用的输入字符（P21 T173）：消息 content + **reasoning_content**（思考模式
   * 回传占输入，旧预算口径漏算）+ tools schema。字符口径与历史截取一致（1 token ≈ 1 字符，保守）。
   */
  private projectedInputChars(messages: EngineChatMessage[], tools: EngineTool[]): number {
    const messageChars = messages.reduce(
      (sum, m) => sum + m.content.length + (m.reasoning_content?.length ?? 0),
      0,
    )
    return messageChars + this.toolsCharsOf(tools)
  }

  /**
   * 超限截断（P21 T173）：只缩短 tool 消息的 content（从最旧开始换占位符），
   **不动** assistant.tool_calls 结构——保证「tool 消息与 tool_calls 一一对应」的上游协议
   * 不被破坏。算法必然终止（占位符极短）；全部截完仍超预算则交由上游裁决（保留告警）。
   * @returns 被移除的字符数（供结算基数与往返观测修正）
   */
  private truncateToolResultsToFit(
    messages: EngineChatMessage[],
    budget: number,
    tools: EngineTool[],
  ): number {
    const placeholder = TOOL_RESULT_TRUNCATED_PLACEHOLDER
    let removed = 0
    while (this.projectedInputChars(messages, tools) > budget) {
      const idx = messages.findIndex((m) => m.role === 'tool' && m.content.length > placeholder.length * 2)
      if (idx === -1) break
      removed += messages[idx].content.length - placeholder.length
      messages[idx].content = placeholder
    }
    return removed
  }

  /**
   * 历史截取预算（P5 R67）：max_context − 输出预留(25%) − system prompt 实测 − tools schema 实测
   * − 当前消息（本轮必然入参，故同样先从预算中扣除）。
   * 不足下限（MIN_HISTORY_CHARS）时保底并告警（提示调大模型上下文或精简工具/手册）。
   * 另于每轮对话开头记 debug 日志（实算值 + P6 T77 路由明细：命中组/下发数/toolsBudget/historyBudget），便于调优。
   */
  private computeHistoryBudget(
    model: ChatModel,
    systemChars: number,
    toolsChars: number,
    currentChars: number,
    toolsCount: number,
    routing?: ToolRoutingResult,
    attachmentsChars = 0,
  ): number {
    const outputReserve = Math.floor(model.maxContext * OUTPUT_RESERVE_RATIO)
    const budget = model.maxContext - outputReserve - systemChars - toolsChars - currentChars - attachmentsChars
    const routeLabel = routing
      ? `groups=${routing.fallback ? 'all(no-match)' : routing.groups.join(',')} `
      : ''
    if (budget < MIN_HISTORY_CHARS) {
      this.logger.warn(
        `上下文预算不足：maxContext=${model.maxContext} 输出预留=${outputReserve} system=${systemChars} ` +
          `${routeLabel}tools=${toolsCount}(${toolsChars} 字符) 当前消息=${currentChars} 附件=${attachmentsChars} → 历史预算 ${budget} < ${MIN_HISTORY_CHARS}，` +
          '已按下限保底截取（建议调大模型 max_context 或精简工具/手册字数）',
      )
      return MIN_HISTORY_CHARS
    }
    this.logger.debug(
      `上下文预算：model maxContext=${model.maxContext} ${routeLabel}tools=${toolsCount} toolsBudget=${toolsChars} ` +
        `systemBudget=${systemChars} attachmentsBudget=${attachmentsChars} historyBudget=${budget}`,
    )
    return budget
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
    /** 失败详情（P21 T174：status=2 时落 ai_message.error_msg，[status=…] 前缀可判 429/400） */
    errorMsg?: string | null,
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
        // P21 T174：失败详情落库（此前只进终端日志，事后无法从库里判定 429 还是 400）
        ...(errorMsg ? { errorMsg: this.truncate(errorMsg, 500) } : {}),
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
