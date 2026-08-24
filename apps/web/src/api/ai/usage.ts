import type { PageQuery, PageResult } from '@/types/api'
import { get } from '@/utils/request'

// ========== 类型 ==========

/** 我的用量明细项 */
export interface MyUsageItem {
  id: string
  modelDisplayName: string
  conversationTitle: string
  tokensInput: number
  tokensOutput: number
  credits: number
  createdAt: string
}

/** 管理端用量明细项（含用户名） */
export interface AdminUsageItem extends MyUsageItem {
  username: string
}

/** 用量汇总 */
export interface UsageSummary {
  totalTokensInput: number
  totalTokensOutput: number
  totalCredits: number
}

/** 管理端用量分页（含 summary） */
export interface AdminUsageResult extends PageResult<AdminUsageItem> {
  summary: UsageSummary
}

// ========== API ==========

/** 我的用量明细分页 */
export const getMyUsage = (params: PageQuery & { modelId?: number }) =>
  get<PageResult<MyUsageItem>>('/ai/usage/mine', params as Record<string, unknown>)

/** 管理端全量用量（筛选 + 汇总） */
export const getAdminUsage = (params: PageQuery & { username?: string; modelId?: number; startTime?: string; endTime?: string }) =>
  get<AdminUsageResult>('/ai/admin/usage', params as Record<string, unknown>)
