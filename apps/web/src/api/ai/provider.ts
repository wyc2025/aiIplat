import type { PageQuery, PageResult } from '@/types/api'
import { del, get, post, put } from '@/utils/request'

// ========== 类型 ==========

/** 厂商项 */
export interface ProviderItem {
  id: string
  name: string
  code: string
  baseUrl: string
  apiKeyMasked: string
  status: number
  sort: number
  remark: string | null
}

/** 模型项 */
export interface ModelItem {
  id: string
  displayName: string
  model: string
  inputPrice: string
  outputPrice: string
  maxContext: number
  supportTool: number
  status: number
  sort: number
}

// ========== 厂商 ==========

/** 厂商分页 */
export const getProviderPage = (params: PageQuery) =>
  get<PageResult<ProviderItem>>('/ai/admin/provider', params as Record<string, unknown>)

/** 新增厂商 */
export const createProvider = (data: {
  name: string
  code: string
  baseUrl: string
  apiKey?: string
  status?: number
  sort?: number
  remark?: string
}) => post('/ai/admin/provider', data)

/** 编辑厂商 */
export const updateProvider = (
  id: string,
  data: {
    name?: string
    baseUrl?: string
    apiKey?: string
    status?: number
    sort?: number
    remark?: string
  },
) => put(`/ai/admin/provider/${id}`, data)

/** 删除厂商 */
export const deleteProvider = (id: string) => del(`/ai/admin/provider/${id}`)

// ========== 模型 ==========

/** 模型分页（按厂商） */
export const getModelPage = (providerId: number, params: PageQuery) =>
  get<PageResult<ModelItem>>('/ai/admin/model', { ...params, providerId })

/** 新增模型 */
export const createModel = (data: {
  providerId: number
  displayName: string
  model: string
  inputPrice: number
  outputPrice: number
  maxContext: number
  supportTool?: number
  status?: number
  sort?: number
}) => post('/ai/admin/model', data)

/** 编辑模型 */
export const updateModel = (
  id: string,
  data: {
    displayName?: string
    inputPrice?: number
    outputPrice?: number
    maxContext?: number
    supportTool?: number
    status?: number
    sort?: number
  },
) => put(`/ai/admin/model/${id}`, data)

/** 删除模型 */
export const deleteModel = (id: string) => del(`/ai/admin/model/${id}`)
