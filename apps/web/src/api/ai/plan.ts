import type { PageQuery, PageResult } from '@/types/api'
import { del, get, post, put } from '@/utils/request'

// ========== 类型 ==========

/** 套餐信息 */
export interface PlanInfo {
  id: string
  name: string
  code: string
  monthlyCredits: string
  price: string
  description: string | null
  status: number
  sort: number
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

/** 管理端套餐（含生效订阅数） */
export interface PlanAdminItem extends PlanInfo {
  activeSubscribers: number
}

// ========== 用户侧 ==========

/** 启用中的套餐列表 */
export const getPlanList = () => get<PlanInfo[]>('/ai/plan/list')

/** 我的套餐 */
export const getMyPlan = () => get<MyPlanResult>('/ai/plan/mine')

/** 开通/切换套餐 */
export const subscribePlan = (data: { planId: number }) => post('/ai/plan/subscribe', data)

// ========== 管理端 ==========

/** 套餐分页 */
export const getPlanPage = (params: PageQuery & { name?: string }) =>
  get<PageResult<PlanAdminItem>>('/ai/admin/plan', params as Record<string, unknown>)

/** 新增套餐 */
export const createPlan = (data: {
  name: string
  code: string
  monthlyCredits: number
  price?: number
  description?: string
  status?: number
  sort?: number
}) => post('/ai/admin/plan', data)

/** 编辑套餐 */
export const updatePlan = (
  id: string,
  data: {
    name?: string
    monthlyCredits?: number
    price?: number
    description?: string
    status?: number
    sort?: number
  },
) => put(`/ai/admin/plan/${id}`, data)

/** 删除套餐 */
export const deletePlan = (id: string) => del(`/ai/admin/plan/${id}`)

/** 指派用户套餐 */
export const assignPlan = (data: { userId: number; planId: number }) => post('/ai/admin/plan/assign', data)
