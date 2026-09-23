import { get, post, put, del, request } from '@/utils/request'
import type {
  AppCreateResult,
  AppDefItem,
  AppSchemaBundle,
  AppTableItem,
  AppFieldInput,
  DataRowView,
  DataQueryDsl,
  ImportPrepareResult,
  ImportProgress,
  PageActionPayload,
} from '@/types/api'

// ==================== 应用管理（P11 T106，API-P11 §1.1） ====================

export const listApps = (params?: { status?: 'draft' | 'active' }) =>
  get<AppDefItem[]>('/app', params)

export const createApp = (data: { name: string; description?: string; mode?: 'blank' | 'draft' }) =>
  post<AppCreateResult>('/app', data)

export const getApp = (code: string) => get<AppDefItem & { createdAt: string }>(`/app/${code}`)

export const updateApp = (code: string, data: { name?: string; description?: string }) =>
  put(`/app/${code}`, data)

export const deleteApp = (code: string) => del(`/app/${code}`)

export const confirmApp = (code: string) =>
  post<{ appCode: string; status: string; menuHint: string }>(`/app/${code}/confirm`)

// ==================== 结构管理（API-P11 §1.2） ====================

export const getSchema = (code: string) => get<AppSchemaBundle>(`/app/${code}/schema`)

export const createTable = (
  code: string,
  data: { name: string; label: string; fields: AppFieldInput[] },
) => post<{ ok: boolean; table: string; created: string[] }>(`/app/${code}/tables`, data)

export const updateTable = (code: string, tid: string, data: { label: string }) =>
  put(`/app/${code}/tables/${tid}`, data)

export const deleteTable = (code: string, tid: string) => del(`/app/${code}/tables/${tid}`)

export const addField = (code: string, tid: string, data: AppFieldInput) =>
  post<{ ok: boolean; field: string }>(`/app/${code}/tables/${tid}/fields`, data)

export const updateField = (
  code: string,
  fid: string,
  data: { label?: string; required?: number; default?: unknown },
) => put(`/app/${code}/fields/${fid}`, data)

export const deleteField = (code: string, fid: string) => del(`/app/${code}/fields/${fid}`)

export const shrinkField = (
  code: string,
  fid: string,
  data: { type: 'enum'; enumOptions: Array<{ value: string; label: string }> },
) => post(`/app/${code}/fields/${fid}/shrink`, data)

export const createRelation = (
  code: string,
  data: { fromTable: string; fromField: string; toTable: string },
) => post<{ ok: boolean; relation: string; throughTable: string }>(`/app/${code}/relations`, data)

// ==================== 功能页（API-P11 §1.3） ====================

export interface AppPageListItem {
  id: string
  code: string
  name: string
  route: string
  kind: string
  genBy: string
  sort: number
  updatedAt?: string
}

export const listPages = (code: string) => get<AppPageListItem[]>(`/app/${code}/pages`)

export const createPage = (
  code: string,
  data: { name: string; route: string; schema: Record<string, unknown>; genBy?: 'ai' | 'manual' },
) => post<{ ok: boolean; pageCode: string; route: string; blocks: number }>(`/app/${code}/pages`, data)

export const updatePage = (
  code: string,
  pid: string,
  data: { name?: string; schema?: Record<string, unknown>; sort?: number },
) => put(`/app/${code}/pages/${pid}`, data)

export const deletePage = (code: string, pid: string) => del(`/app/${code}/pages/${pid}`)

// ==================== 沙箱数据（API-P11 §1.4） ====================

export const queryData = (dsl: DataQueryDsl) =>
  post<{ op: string; list?: DataRowView[]; total?: number; row?: DataRowView }>('/app/data/query', dsl)

export const runPageAction = (payload: PageActionPayload) =>
  post<{ ok: boolean; results: Array<{ op: string; table: string; rowId: string }> }>(
    '/app/data/action',
    payload,
  )

export const getRecord = (params: { appCode: string; table: string; rowId: string }) =>
  get<{ row: DataRowView }>('/app/data/record', params)

// ==================== 导入导出与附件（API-P11 §1.5） ====================

export const prepareImport = (
  code: string,
  table: string,
  file: File,
  onProgress?: (percent: number) => void,
) => {
  const form = new FormData()
  form.append('file', file)
  return request<ImportPrepareResult>({
    method: 'POST',
    url: `/app/${code}/import`,
    params: { table },
    data: form,
    timeout: 0,
    onUploadProgress: (event) => {
      if (onProgress && event.total) {
        onProgress(Math.round((event.loaded / event.total) * 100))
      }
    },
  })
}

export const confirmImport = (
  code: string,
  taskId: string,
  mapping?: Record<string, string>,
) => post(`/app/${code}/import/${taskId}/confirm`, { mapping })

export const getImportProgress = (taskId: string) =>
  get<ImportProgress>(`/app/import/${taskId}`)

export const exportCsv = (code: string, table: string) =>
  request<Blob>({ method: 'GET', url: `/app/${code}/export`, params: { table }, responseType: 'blob' })

/** 附件字段上传（服务端强制落 /app-attachments/{appCode}/） */
export const uploadAppAttachment = (
  code: string,
  file: File,
  onProgress?: (percent: number) => void,
) => {
  const form = new FormData()
  form.append('file', file)
  return request<{ fileId: string; path: string; name: string; ext: string; size: number }>({
    method: 'POST',
    url: `/app/${code}/attachment`,
    data: form,
    timeout: 0,
    onUploadProgress: (event) => {
      if (onProgress && event.total) {
        onProgress(Math.round((event.loaded / event.total) * 100))
      }
    },
  })
}

// 类型再导出（页面按需引用）
export type { AppDefItem, AppTableItem, AppFieldInput, DataRowView }
