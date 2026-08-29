import instance, { get, post, put, del } from '@/utils/request'
import { getAccessToken } from '@/utils/token'
import type { CloudFile, CloudQuota, CloudFileList, BreadcrumbItem } from '@/types/api'

/** 目录内容（文件夹在前，文件按修改时间倒序）+ 配额联动 */
export const listFiles = (parentId: number) =>
  get<CloudFileList>('/cloud/file/list', { parentId })

/** 面包屑链（从根到当前目录） */
export const filePath = (id: number) =>
  get<BreadcrumbItem[]>('/cloud/file/path', { id })

/** 我的配额 */
export const getQuota = () => get<CloudQuota>('/cloud/file/quota')

/** 新建文件夹（同名自动加 (1)） */
export const mkdir = (parentId: number, name: string) =>
  post<CloudFile>('/cloud/file/mkdir', { parentId, name })

/** 重命名（同名冲突阻止） */
export const renameFile = (id: number, name: string) =>
  post<CloudFile>('/cloud/file/rename', { id, name })

/** 删除（软删入回收站） */
export const removeFile = (id: number) => del(`/cloud/file/${id}`)

/**
 * 上传文件（multipart/form-data，全程流式，配额校验）。
 * overwrite=1 且同目录存在同名文件时物理替换（URL 不变）；缺省同名自动 (1)。
 * onProgress 回调用于展示上传进度（0~100）。
 * 注意：request 响应拦截器已对 code===0 解包为业务 data，故此处直接返回 CloudFile。
 */
export const uploadFile = (
  parentId: number,
  file: File,
  onProgress?: (percent: number) => void,
  overwrite?: boolean,
): Promise<CloudFile> => {
  const form = new FormData()
  form.append('file', file)
  const token = getAccessToken()
  // 用原始 axios 实例：request 的 post 封装不接受第 3 个 config 参数（无法透传 onUploadProgress），
  // 且实例自带 baseURL（/api），此处用相对路径，避免拼出 /api/api/... 双前缀。
  return instance.post<CloudFile>(
    `/cloud/file/upload?parentId=${parentId}${overwrite ? '&overwrite=1' : ''}`,
    form,
    {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      onUploadProgress: (e: { loaded: number; total?: number }) => {
        if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100))
      },
    },
  ) as unknown as Promise<CloudFile>
}

/** 设为公开 / 取消公开（P4a：仅标记自身，子树语义由上溯判定承担） */
export const setFilePublic = (id: number, isPublic: boolean) =>
  post<{ id: string; isPublic: boolean }>('/cloud/file/set-public', { id, isPublic: isPublic ? 1 : 0 })

/** 在线编辑保存（P4b T43：更新行语义，fileId/URL 不变，开放层立即生效） */
export const updateFileContent = (id: number, content: string) =>
  put<{ id: string; name: string; size: number }>(`/cloud/file/${id}/content`, { content })

/**
 * 以 Blob 拉取文件流（预览/下载共用）。必须走 axios 而非 <img>/<iframe>/<a> 原生直链：
 * 原生请求无法携带 Authorization 头，会被 JwtAuthGuard 以 401 拒绝（表现为预览空白、
 * 浏览器下载提示"请先尝试登录相应网站"）；走 axios 可自动带 token，且 token 失效时
 * 享受统一的 401 静默刷新与重放。timeout=0：大文件传输不设超时。
 * 响应拦截器对 responseType==='blob' 直接返回 Blob 本体（见 utils/request.ts）。
 */
export const previewFileBlob = (id: number): Promise<Blob> =>
  instance.get<Blob>(`/cloud/file/preview/${id}`, {
    responseType: 'blob',
    timeout: 0,
  }) as unknown as Promise<Blob>

export const downloadFileBlob = (id: number): Promise<Blob> =>
  instance.get<Blob>(`/cloud/file/download/${id}`, {
    responseType: 'blob',
    timeout: 0,
  }) as unknown as Promise<Blob>
