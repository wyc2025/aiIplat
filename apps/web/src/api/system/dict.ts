import type { DictDataItem, DictTypeItem, PageQuery, PageResult } from '@/types/api'
import { del, get, post, put } from '@/utils/request'
import type { DictItem } from '@/hooks/useDict'

export interface DictTypeQuery extends PageQuery {
  name?: string
}

export interface DictTypePayload {
  name?: string
  type?: string
  status?: number
  remark?: string
}

export interface DictDataPayload {
  typeId?: number
  label?: string
  value?: string
  sort?: number
  status?: number
  remark?: string
}

// 类型
export const getDictTypePage = (params: DictTypeQuery) =>
  get<PageResult<DictTypeItem>>('/system/dict/type/page', params as Record<string, unknown>)

export const createDictType = (data: DictTypePayload) => post('/system/dict/type', data)

export const updateDictType = (id: string, data: DictTypePayload) =>
  put(`/system/dict/type/${id}`, data)

export const deleteDictType = (id: string) => del(`/system/dict/type/${id}`)

// 数据
export const getDictDataList = (typeId: string) =>
  get<DictDataItem[]>(`/system/dict/type/${typeId}/data`)

export const createDictData = (data: DictDataPayload) => post('/system/dict/data', data)

export const updateDictData = (id: string, data: DictDataPayload) =>
  put(`/system/dict/data/${id}`, data)

export const deleteDictData = (id: string) => del(`/system/dict/data/${id}`)

// 按类型标识取启用数据（useDict 用）
export const getDictByType = (type: string) => get<DictItem[]>(`/system/dict/data/${type}`)
