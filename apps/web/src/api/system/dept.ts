import type { DeptItem } from '@/types/api'
import { del, get, post, put } from '@/utils/request'

export interface DeptPayload {
  parentId?: number
  name?: string
  sort?: number
  status?: number
}

export const getDeptList = (status?: number) =>
  get<DeptItem[]>('/system/dept/list', status !== undefined ? { status } : undefined)

export const createDept = (data: DeptPayload) => post('/system/dept', data)

export const updateDept = (id: string, data: DeptPayload) => put(`/system/dept/${id}`, data)

export const deleteDept = (id: string) => del(`/system/dept/${id}`)
