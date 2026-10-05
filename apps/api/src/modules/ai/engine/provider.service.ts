import { Injectable } from '@nestjs/common'
import OpenAI, { APIConnectionError, APIError } from 'openai'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions/completions'
import type {
  EngineChatMessage,
  EngineStreamEvent,
  EngineStreamParams,
  EngineToolCall,
} from './engine.types'

/**
 * OpenAI 兼容适配器（引擎层）。
 * 用 openai 官方 SDK，通过 baseURL 指向各家 OpenAI 兼容端点（DeepSeek / Kimi / 通义千问 / 智谱），
 * 禁止为单一厂商引入专属 SDK。
 *
 * 职责（见 ARCHITECTURE §11、§12）：按 provider 配置创建 client、发起流式调用、解析 usage 与 tool_calls。
 * 不感知会话、积分、套餐；上游异常向上抛出，由 chat 层决定如何转 SSE error 事件。
 */
@Injectable()
export class ProviderService {
  /** 按厂商配置创建 OpenAI 兼容 client（不缓存，随用随建，apiKey 变更即时生效） */
  createClient(baseUrl: string, apiKey: string): OpenAI {
    return new OpenAI({ baseURL: baseUrl, apiKey })
  }

  /**
   * 上游瞬时错误判定（P21 T174）：429 / 5xx / 连接层错误（含超时）可安全重试；
   * 400/401/403/404 等参数与鉴权类错误重试无意义。
   * 引擎层是唯一感知 openai SDK 异常类型的地方，chat 层据此决定是否重试。
   */
  isRetryableUpstreamError(error: unknown): boolean {
    if (error instanceof APIConnectionError) return true
    if (error instanceof APIError) {
      return error.status === 429 || (typeof error.status === 'number' && error.status >= 500)
    }
    return false
  }

  /**
   * 把引擎层消息转成 OpenAI 兼容的 ChatCompletionMessageParam。
   * 关键：assistant 消息的 tool_calls 需从扁平结构 { id, name, arguments }
   * 转成嵌套结构 { id, type: 'function', function: { name, arguments } }，
   * 否则上游（DeepSeek 等）解析失败（400）。
   */
  private toOpenAIMessages(messages: EngineChatMessage[]): ChatCompletionMessageParam[] {
    return messages.map((m) => {
      if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
        return {
          role: 'assistant',
          content: m.content || null,
          tool_calls: m.tool_calls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: tc.arguments },
          })),
          // DeepSeek 思考模式：必须回传 reasoning_content，否则多轮工具调用 400
          ...(m.reasoning_content ? { reasoning_content: m.reasoning_content } : {}),
        }
      }
      if (m.role === 'tool') {
        return { role: 'tool', content: m.content, tool_call_id: m.tool_call_id ?? '' }
      }
      if (m.role === 'assistant' && m.reasoning_content) {
        return { role: 'assistant', content: m.content, reasoning_content: m.reasoning_content } as ChatCompletionMessageParam
      }
      return { role: m.role, content: m.content } as ChatCompletionMessageParam
    })
  }

  /**
   * 发起流式对话调用，产出增量文本、工具调用与最终用量。
   * - `stream_options.include_usage = true` 使上游在最后一个 chunk 携带 usage（见 API.md）
   * - 工具调用：tool_calls 在流式 delta 中分片下发（function.arguments 逐段追加），
   *   本方法按 index 累积分片，聚合至 finish_reason=tool_calls 时产出完整的 tool_calls 事件
   * - 上游中断/取消时可能拿不到 usage，此时 done 事件的 usage 为 null，由上层按字符数兜底估算
   * - 上游调用失败抛出异常（openai SDK 抛 APIError），由上层捕获
   */
  async *streamChat(params: EngineStreamParams): AsyncGenerator<EngineStreamEvent> {
    const { baseUrl, apiKey, model, messages, tools, signal } = params
    const client = this.createClient(baseUrl, apiKey)

    const stream = await client.chat.completions.create(
      {
        model,
        messages: this.toOpenAIMessages(messages),
        stream: true,
        stream_options: { include_usage: true },
        // 空 tools 数组会触发部分厂商 400，故仅在非空时携带
        ...(tools && tools.length > 0 ? { tools } : {}),
      },
      { signal },
    )

    // 工具调用分片累积器：index -> { id, name, arguments }
    const toolCallBuffer = new Map<number, { id: string; name: string; arguments: string }>()
    // DeepSeek 思考模式：累积 reasoning_content（分片下发）
    let reasoningContent = ''

    for await (const chunk of stream) {
      const choice = chunk.choices[0]

      // 累积 tool_calls 分片
      const deltaToolCalls = choice?.delta?.tool_calls
      if (deltaToolCalls) {
        for (const tc of deltaToolCalls) {
          const idx = tc.index
          const existing = toolCallBuffer.get(idx) ?? { id: '', name: '', arguments: '' }
          if (tc.id) existing.id = tc.id
          if (tc.function?.name) existing.name = tc.function.name
          if (tc.function?.arguments) existing.arguments += tc.function.arguments
          toolCallBuffer.set(idx, existing)
        }
      }

      // 累积 reasoning_content（DeepSeek 扩展字段）
      const deltaReasoning = (choice?.delta as { reasoning_content?: string } | undefined)?.reasoning_content
      if (deltaReasoning) reasoningContent += deltaReasoning

      const delta = choice?.delta?.content
      if (delta) {
        yield { type: 'delta', content: delta }
      }

      // finish_reason=tool_calls 时聚合产出工具调用事件（此时分片已完整）
      if (choice?.finish_reason === 'tool_calls' && toolCallBuffer.size > 0) {
        const toolCalls: EngineToolCall[] = [...toolCallBuffer.entries()]
          .sort(([a], [b]) => a - b)
          .map(([, v]) => ({ id: v.id, name: v.name, arguments: v.arguments }))
        yield { type: 'tool_calls', toolCalls }
        toolCallBuffer.clear()
      }

      // 最后一个 chunk（choices 为空）携带 usage
      if (chunk.usage) {
        yield {
          type: 'done',
          usage: {
            inputTokens: chunk.usage.prompt_tokens,
            outputTokens: chunk.usage.completion_tokens,
          },
          reasoningContent: reasoningContent || null,
        }
      }
    }
  }
}
