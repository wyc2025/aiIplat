import type { PageQuery, PageResult, RoleItem } from '@/types/api'
import { del, get, post, put } from '@/utils/request'

export interface RoleQuery extends PageQuery {
  name?: string
  status?: number
}

export interface RolePayload {
  name?: string
  code?: string
  sort?: number
  status?: number
  remark?: string
}

export const getRolePage = (params: RoleQuery) =>
  get<PageResult<RoleItem>>('/system/role/page', params as Record<string, unknown>)

export const getAllRoles = () => get<RoleItem[]>('/system/role/list')

export const createRole = (data: RolePayload) => post('/system/role', data)

export const updateRole = (id: string, data: RolePayload) => put(`/system/role/${id}`, data)

export const deleteRole = (id: string) => del(`/system/role/${id}`)

export const getRoleMenuIds = (id: string) => get<string[]>(`/system/role/${id}/menus`)

export const assignRoleMenus = (id: string, menuIds: number[]) =>
  put(`/system/role/${id}/menus`, { menuIds })
