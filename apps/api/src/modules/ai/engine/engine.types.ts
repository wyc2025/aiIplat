/**
 * 引擎层类型定义。
 * 引擎层（engine）单向依赖：chat → engine → 上游；引擎不感知会话、积分、套餐。
 */

/** 发送给上游的对话消息（system prompt 由 chat 层拼装后传入） */
export interface EngineChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  /** assistant 消息携带的工具调用（回喂上游时保持原样） */
  tool_calls?: EngineToolCall[]
  /** tool 消息关联的 tool_call_id */
  tool_call_id?: string
}

/** 工具调用（聚合完成后的完整结构） */
export interface EngineToolCall {
  id: string
  name: string
  /** 模型生成的 JSON 参数字符串 */
  arguments: string
}

/** 发送给上游的工具定义（OpenAI tools 格式） */
export interface EngineTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

/** 上游返回的 token 用量 */
export interface EngineUsage {
  /** 输入（prompt）tokens */
  inputTokens: number
  /** 输出（completion）tokens */
  outputTokens: number
}

/** 流式事件：delta = 增量文本；tool_calls = 工具调用（聚合完成）；done = 流结束 */
export type EngineStreamEvent =
  | { type: 'delta'; content: string }
  | { type: 'tool_calls'; toolCalls: EngineToolCall[] }
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
  /** 工具定义（按权限过滤后的子集；空则不携带 tools 字段） */
  tools?: EngineTool[]
  /** 用于「停止生成」中断上游请求 */
  signal?: AbortSignal
}
