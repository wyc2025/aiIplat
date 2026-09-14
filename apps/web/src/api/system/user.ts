import type { PageQuery, PageResult, UserRow } from '@/types/api'
import { del, get, post, put } from '@/utils/request'

export interface UserQuery extends PageQuery {
  username?: string
  phone?: string
  status?: number
}

export interface CreateUserPayload {
  username: string
  password: string
  nickname: string
  email?: string
  phone?: string
  gender?: number
  deptId?: number
  status?: number
  remark?: string
  roleIds?: number[]
}

export const getUserPage = (params: UserQuery) =>
  get<PageResult<UserRow>>('/system/user/page', params as Record<string, unknown>)

export const createUser = (data: CreateUserPayload) => post<{ id: string }>('/system/user', data)

export const updateUser = (id: string, data: Partial<CreateUserPayload>) =>
  put(`/system/user/${id}`, data)

export const updateUserStatus = (id: string, status: number) =>
  put(`/system/user/${id}/status`, { status })

export const resetUserPassword = (id: string) =>
  put<{ password: string }>(`/system/user/${id}/password`)

export const assignUserRoles = (id: string, roleIds: number[]) =>
  put(`/system/user/${id}/roles`, { roleIds })

export const deleteUser = (id: string) => del(`/system/user/${id}`)

export interface UpdateQuotaPayload {
  userId: string
  quotaLimit: number
  quotaUsed?: number
}

/** 调整用户配额（管理员；quotaLimit 下限=当前已用） */
export const updateUserQuota = (data: UpdateQuotaPayload) => put('/cloud/admin/quota', data)

/** 查询用户配额（含已用容量，作为调整下限参考） */
export const getUserQuota = (userId: string) => get<{ userId: string; quotaLimit: string; quotaUsed: string }>('/cloud/admin/quota', { userId })

export interface UsageReconcilePart {
  count: number
  bytes: string
}

export interface UsageReconcileResult {
  userId: string
  /** 当前存储值（cloud_usage.used） */
  stored: string
  /** 公式应然值 = active + recycled − revertedAvatars */
  expected: string
  /** expected − stored（>0 = used 偏低） */
  diff: string
  parts: {
    /** 未删除行 */
    active: UsageReconcilePart
    /** 回收站行 */
    recycled: UsageReconcilePart
    /** 已回退头像行（parent_id=-1 且已软删，换头像时已回退 used） */
    revertedAvatars: UsageReconcilePart
  }
}

/** 配额对账诊断（P4F T68/R60，只读；diff ≠ 0 才建议修正） */
export const getUsageReconcile = (userId: string) =>
  get<UsageReconcileResult>('/cloud/admin/usage-reconcile', { userId })

/** 配额对账修正（P4F T68/R61）：used = 公式重算值（只写 used，不动文件行） */
export const fixUsageReconcile = (userId: string) =>
  put<{ userId: string; oldUsed: string; newUsed: string; diff: string }>('/cloud/admin/usage-reconcile', {
    userId,
  })
