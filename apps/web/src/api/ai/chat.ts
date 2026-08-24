import type { PageQuery, PageResult } from '@/types/api'
import { del, get, put } from '@/utils/request'
import { sseRequest, type SseCallbacks, type SseSession } from '@/views/ai/utils/sse'

export type { SseSession }

// ========== 类型 ==========

/** 可用模型（模型选择器） */
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

/** 会话列表项 */
export interface ConversationItem {
  id: string
  title: string
  modelId: string | null
  modelDisplayName: string | null
  updatedAt: string
}

/** 消息项 */
export interface MessageItem {
  id: string
  role: 'user' | 'assistant'
  content: string
  tokensInput: number | null
  tokensOutput: number | null
  credits: number
  modelDisplayName: string | null
  status: number
  createdAt: string
}

/** 发送消息入参 */
export interface ChatPayload {
  conversationId?: number
  modelId?: number
  content: string
}

/** SSE done 事件的 usage */
export interface ChatDoneUsage {
  inputTokens: number
  outputTokens: number
  credits: number
  remainingCredits: string
}

// ========== API ==========

/** 可用模型列表 */
export const getModels = () => get<AvailableModel[]>('/ai/models')

/** 会话分页列表 */
export const getConversationPage = (params: PageQuery) =>
  get<PageResult<ConversationItem>>('/ai/conversation', params as Record<string, unknown>)

/** 重命名 / 切换模型 */
export const updateConversation = (id: string, data: { title?: string; modelId?: number }) =>
  put(`/ai/conversation/${id}`, data)

/** 删除会话 */
export const deleteConversation = (id: string) => del(`/ai/conversation/${id}`)

/** 消息列表（最近 50 条正序） */
export const getMessages = (id: string) => get<MessageItem[]>(`/ai/conversation/${id}/messages`)

/** 发送消息（SSE 流式），返回会话句柄供停止生成 */
export const sendChatMessage = (payload: ChatPayload, callbacks: SseCallbacks): SseSession =>
  sseRequest('/ai/chat', payload, callbacks)

/** 套餐信息（我的套餐） */
export interface PlanInfo {
  id: string
  name: string
  code: string
  monthlyCredits: string
  price: string
  description: string | null
}

/** 我的套餐与额度（plan 为 null 表示未开通） */
export interface MyPlanResult {
  plan: PlanInfo | null
  cycleStart: string | null
  cycleEnd: string | null
  totalCredits: string
  usedCredits: string
  remainingCredits: string
}

/** 我的套餐（检测是否开通，用于对话页开通引导） */
export const getMyPlan = () => get<MyPlanResult>('/ai/plan/mine')
