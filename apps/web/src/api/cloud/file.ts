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

/** 移动结果（P4d T52：targetPublic 且未确认时未执行移动，前端弹 R39 警告后带 confirmPublic 重发） */
export interface MoveFileResult {
  id: string
  name: string
  finalName: string
  targetPublic: boolean
}

/**
 * 移动（P4d：剪切/粘贴与拖拽移动共用；批量 = 队列逐条调用 D42）。
 * confirmPublic=true 表示已确认「目标处于公开状态、移入后对外可见」（R39）。
 */
export const moveFile = (id: number, targetParentId: number, confirmPublic = false): Promise<MoveFileResult> =>
  post<MoveFileResult>(`/cloud/file/${id}/move`, { targetParentId, confirmPublic })

/**
 * 批量打包下载（P4d T54）：流式 zip，浏览器原生下载。
 * 走 axios Blob（同预览/下载口径：自动带 token，享受 401 静默刷新）；timeout=0 大包不限时。
 * 后端业务错误为 HTTP 200 + JSON 统一体，此处按 content-type 识别并抛出（否则会被存成 .zip）。
 */
export const packDownloadBlob = async (ids: string[]): Promise<Blob> => {
  const blob = (await instance.post(`/cloud/file/pack-download`, { ids }, {
    responseType: 'blob',
    timeout: 0,
  })) as unknown as Blob
  if (blob.type.includes('application/json')) {
    const text = await blob.text()
    let message = '打包下载失败'
    try {
      const body = JSON.parse(text) as { message?: string }
      if (body.message) message = body.message
    } catch {
      // 非 JSON 体：用默认文案
    }
    throw new Error(message)
  }
  return blob
}

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
  // timeout=0：覆盖实例默认 15s 超时——大文件（如 20MB 视频）上传耗时随体积/带宽线性增长，
  // 15s 内传不完会被 axios 主动中断并报 "timeout of 15000ms exceeded"（后端上限 100MB，Nginx 已放行）。
  return instance.post<CloudFile>(
    `/cloud/file/upload?parentId=${parentId}${overwrite ? '&overwrite=1' : ''}`,
    form,
    {
      timeout: 0,
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

/** 设为公开并获取公开链接（P4c F1：幂等返回既有 token；allowListing 仅文件夹有意义） */
export const createPublicLink = (id: number, allowListing?: boolean) =>
  post<import('@/types/api').PublicLinkResult>(
    `/cloud/file/${id}/public`,
    allowListing === undefined ? {} : { allowListing },
  )

/** 取消公开（P4c R27：token 轮换置空 + is_public 归 0，旧链接立即失效） */
export const cancelPublicLink = (id: number) => del(`/cloud/file/${id}/public`)

/** 在线编辑保存（P4b T43：更新行语义，fileId/URL 不变，开放层立即生效） */
export const updateFileContent = (id: number, content: string) =>
  put<{ id: string; name: string; size: number }>(`/cloud/file/${id}/content`, { content })

/**
 * 在线解压（P4c T49：仅 zip → 同目录包名文件夹，同步执行）。
 * 用原始实例：解压耗时随包体积增长，timeout=0 覆盖实例默认 15s 超时（与上传同口径）。
 */
export const unzipFile = (id: number): Promise<{ folderId: string; folderName: string; fileCount: number; totalSize: number }> =>
  instance.post(`/cloud/file/${id}/unzip`, undefined, { timeout: 0 }) as unknown as Promise<{
    folderId: string
    folderName: string
    fileCount: number
    totalSize: number
  }>

/**
 * 以 Blob 拉取文件流（预览/下载共用）。必须走 axios 而非 <img>/<iframe>/<a> 原生直链：
 * 原生请求无法携带 Authorization 头，会被 JwtAuthGuard 以 401 拒绝（表现为预览空白、
 * 浏览器下载提示"请先尝试登录相应网站"）；走 axios 可自动带 token，且 token 失效时
 * 享受统一的 401 静默刷新与重放。timeout=0：大文件传输不设超时。
 * 响应拦截器对 responseType==='blob' 直接返回 Blob 本体（见 utils/request.ts）。
 */
/** Blob 流传输进度回调（loaded/total 字节；服务端未给 Content-Length 时 total 为 0） */
export type BlobProgress = (loaded: number, total: number) => void

export const previewFileBlob = (id: number, onProgress?: BlobProgress): Promise<Blob> =>
  instance.get<Blob>(`/cloud/file/preview/${id}`, {
    responseType: 'blob',
    timeout: 0,
    // 音视频体积大时给前端一个进度出口（避免用户误以为「卡在转圈」）
    onDownloadProgress: onProgress
      ? (event) => onProgress(event.loaded ?? 0, event.total ?? 0)
      : undefined,
  }) as unknown as Promise<Blob>

export const downloadFileBlob = (id: number): Promise<Blob> =>
  instance.get<Blob>(`/cloud/file/download/${id}`, {
    responseType: 'blob',
    timeout: 0,
  }) as unknown as Promise<Blob>

/**
 * 头像流（P3 端点 `GET /cloud/file/avatar/:id`，仅本人可读）。
 * 与预览/下载同口径：必须走 axios 才能携带 Authorization——头像曾以 `<img src="/api/cloud/file/avatar/86">`
 * 直连，原生请求带不了 token 会被 JwtAuthGuard 判 401，顶栏只能落回昵称首字母（PROGRESS 遗留 18）。
 * userinfo.avatar 存的是「对外完整路径」（含 /api 前缀），而实例自带 baseURL（默认 /api），
 * 故先剥掉前缀，避免拼出 /api/api/...（同 uploadFile 注释口径）。
 */
export const fetchAvatarBlob = (avatarUrl: string): Promise<Blob> =>
  instance.get<Blob>(avatarUrl.replace(/^\/api(?=\/)/, ''), {
    responseType: 'blob',
    timeout: 0,
  }) as unknown as Promise<Blob>
