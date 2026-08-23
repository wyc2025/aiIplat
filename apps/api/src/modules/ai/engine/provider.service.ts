import { Injectable } from '@nestjs/common'
import OpenAI from 'openai'
import type { ChatCompletionChunk } from 'openai/resources/chat/completions/completions'
import type { EngineStreamEvent, EngineStreamParams } from './engine.types'

/**
 * OpenAI 兼容适配器（引擎层）。
 * 用 openai 官方 SDK，通过 baseURL 指向各家 OpenAI 兼容端点（DeepSeek / Kimi / 通义千问 / 智谱），
 * 禁止为单一厂商引入专属 SDK。
 *
 * 职责（见 ARCHITECTURE §11）：按 provider 配置创建 client、发起流式调用、解析 usage。
 * 不感知会话、积分、套餐；上游异常向上抛出，由 chat 层决定如何转 SSE error 事件。
 */
@Injectable()
export class ProviderService {
  /** 按厂商配置创建 OpenAI 兼容 client（不缓存，随用随建，apiKey 变更即时生效） */
  createClient(baseUrl: string, apiKey: string): OpenAI {
    return new OpenAI({ baseURL: baseUrl, apiKey })
  }

  /**
   * 发起流式对话调用，产出增量文本与最终用量。
   * - `stream_options.include_usage = true` 使上游在最后一个 chunk 携带 usage（见 API.md）
   * - 上游中断/取消时可能拿不到 usage，此时 done 事件的 usage 为 null，由上层按字符数兜底估算
   * - 上游调用失败抛出异常（openai SDK 抛 APIError），由上层捕获
   */
  async *streamChat(params: EngineStreamParams): AsyncGenerator<EngineStreamEvent> {
    const { baseUrl, apiKey, model, messages, signal } = params
    const client = this.createClient(baseUrl, apiKey)

    const stream = await client.chat.completions.create(
      {
        model,
        messages,
        stream: true,
        stream_options: { include_usage: true },
      },
      { signal },
    )

    for await (const chunk of stream) {
      const event = this.parseChunk(chunk)
      if (event) yield event
    }
  }

  /** 解析单个 chunk：有文本增量产出 delta，最后一个 chunk 携带 usage 时产出 done */
  private parseChunk(chunk: ChatCompletionChunk): EngineStreamEvent | null {
    const delta = chunk.choices[0]?.delta?.content
    if (delta) {
      return { type: 'delta', content: delta }
    }
    // 最后一个 chunk（choices 为空）携带 usage
    if (chunk.usage) {
      return {
        type: 'done',
        usage: {
          inputTokens: chunk.usage.prompt_tokens,
          outputTokens: chunk.usage.completion_tokens,
        },
      }
    }
    return null
  }
}
