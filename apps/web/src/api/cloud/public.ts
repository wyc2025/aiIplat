import type { PubFileInfo, PubFolderList } from '@/types/api'

/**
 * 云盘公开访问 API（P4c T47，访客侧免登录）：
 * - 故意不走 utils/request 统一封装：公开页不要求登录态（无需 401 刷新链路），
 *   且统一封装对业务错误会弹全局 ElMessage 并丢失 code——落地页需要按 code 区分
 *   40117（未开放列表浏览）与 40400（统一防探测失败态），故用 fetch 直取统一响应体。
 */
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api'

/** 公开端点业务错误（code 为统一响应体错误码，如 40400/40117/42900） */
export class PubApiError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message)
    this.name = 'PubApiError'
  }
}

/** 直取统一响应体的 GET（免登录，无拦截器副作用） */
async function pubGet<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  const qs = params
    ? '?' +
      Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')
    : ''
  let body: { code: number; message: string; data: T }
  try {
    const res = await fetch(`${API_BASE}${url}${qs}`)
    body = await res.json()
  } catch {
    throw new PubApiError(-1, '网络异常')
  }
  if (body.code !== 0) {
    throw new PubApiError(body.code, body.message || '资源不存在')
  }
  return body.data
}

/** 公开文件元信息（f/{token}/info） */
export const pubFileInfo = (token: string) => pubGet<PubFileInfo>(`/pub/f/${token}/info`)

/** 公开文件夹单层列表（d/{token}/list；path 缺省 = 根） */
export const pubFolderList = (token: string, path?: string) =>
  pubGet<PubFolderList>(`/pub/d/${token}/list`, path ? { path } : undefined)

/** 公开文件夹内子文件元信息（d/{token}/info?path=） */
export const pubSubFileInfo = (token: string, path: string) =>
  pubGet<PubFileInfo>(`/pub/d/${token}/info`, { path })

/** raw 直链（浏览器原生请求，<video>/<audio>/<img> 自动发 Range） */
export function pubRawUrl(token: string, path?: string): string {
  return path
    ? `${API_BASE}/pub/d/${token}/raw?path=${encodeURIComponent(path)}`
    : `${API_BASE}/pub/f/${token}/raw`
}

/** download 直链（attachment + 原文件名） */
export function pubDownloadUrl(token: string, path?: string): string {
  return path
    ? `${API_BASE}/pub/d/${token}/download?path=${encodeURIComponent(path)}`
    : `${API_BASE}/pub/f/${token}/download`
}
