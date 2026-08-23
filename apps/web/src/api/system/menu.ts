import type { MenuItem } from '@/types/api'
import { del, get, post, put } from '@/utils/request'

export interface MenuPayload {
  parentId?: number
  name?: string
  type?: number
  path?: string
  component?: string
  perms?: string
  icon?: string
  sort?: number
  visible?: number
  status?: number
}

export const getMenuList = () => get<MenuItem[]>('/system/menu/list')

export const createMenu = (data: MenuPayload) => post('/system/menu', data)

export const updateMenu = (id: string, data: MenuPayload) => put(`/system/menu/${id}`, data)

export const deleteMenu = (id: string) => del(`/system/menu/${id}`)
