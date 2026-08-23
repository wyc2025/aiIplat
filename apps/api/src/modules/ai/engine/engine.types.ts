/**
 * 引擎层类型定义。
 * 引擎层（engine）单向依赖：chat → engine → 上游；引擎不感知会话、积分、套餐。
 */

/** 发送给上游的对话消息（system prompt 由 chat 层拼装后传入） */
export interface EngineChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** 上游返回的 token 用量 */
export interface EngineUsage {
  /** 输入（prompt）tokens */
  inputTokens: number
  /** 输出（completion）tokens */
  outputTokens: number
}

/** 流式事件：delta = 增量文本；done = 流结束（usage 为 null 表示上游未返回，需上层兜底估算） */
export type EngineStreamEvent =
  | { type: 'delta'; content: string }
  | { type: 'done'; usage: EngineUsage | null }

/** 流式调用参数 */
export interface EngineStreamParams {
  /** OpenAI 兼容端点 */
  baseUrl: string
  /** 厂商 API Key */
  apiKey: string
  /** API 模型名，如 deepseek-chat */
  model: string
  /** 消息列表（含 system prompt，已按上下文截取） */
  messages: EngineChatMessage[]
  /** 用于「停止生成」中断上游请求 */
  signal?: AbortSignal
}
