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
