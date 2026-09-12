import type {
  CloudSharePublic,
  ShareFolderList,
  ShareVerifyResult,
} from '@/types/api'

/**
 * 云盘分享访客 API（P4d T56，免登录）：
 * 与 api/cloud/public.ts 同款「fetch 直取统一响应体」——访客页不要求登录态（无需 401 刷新链路），
 * 且必须按 code 区分 30017（需提取码）/30008（失效）/42900（限流），统一封装会弹全局提示并丢失 code。
 * 提取码通过后签发短期凭证 sid：普通请求走请求头 X-Share-Sid；
 * 媒体类原生子资源（<video>/<img>/<iframe>/<a download>）无法自定义请求头，故其 URL 追加 ?sid=。
 */
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api'

/** 分享访客端点业务错误（code 为统一响应体错误码，如 30008/30017/30018/42900） */
export class ShareApiError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message)
    this.name = 'ShareApiError'
  }
}

function qs(params?: Record<string, unknown>): string {
  if (!params) return ''
  const pairs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
  return pairs.length > 0 ? `?${pairs.join('&')}` : ''
}

async function shareRequest<T>(url: string, init?: RequestInit): Promise<T> {
  let body: { code: number; message: string; data: T }
  try {
    const res = await fetch(`${API_BASE}${url}`, init)
    body = await res.json()
  } catch {
    throw new ShareApiError(-1, '网络异常')
  }
  if (body.code !== 0) {
    throw new ShareApiError(body.code, body.message || '分享链接无效')
  }
  return body.data
}

/** 提取码校验（无密码分享直通）；错误 30018（含锁定提示），成功返回短期凭证 sid */
export const verifySharePassword = (token: string, password: string): Promise<ShareVerifyResult> =>
  shareRequest<ShareVerifyResult>(`/cloud/share/${token}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })

/** 分享信息（需过密码门：未持有效 sid 时后端返回 30017）；path 可选 = 文件夹内子项 */
export const shareInfo = (token: string, sid?: string, path?: string): Promise<CloudSharePublic> =>
  shareRequest<CloudSharePublic>(
    `/cloud/share/${token}${qs({ sid, path })}`,
    sid ? { headers: { 'X-Share-Sid': sid } } : undefined,
  )

/** 文件夹分享单层列表（动态子树；path 缺省 = 根） */
export const shareFolderList = (token: string, sid: string | undefined, path?: string): Promise<ShareFolderList> =>
  shareRequest<ShareFolderList>(
    `/cloud/share/${token}/list${qs({ path, sid })}`,
    sid ? { headers: { 'X-Share-Sid': sid } } : undefined,
  )

/** 文件预览流直链（inline；媒体原生请求靠 ?sid= 传递凭证，path 用于文件夹内子文件） */
export function shareRawUrl(token: string, sid?: string, path?: string): string {
  return `${API_BASE}/cloud/share/${token}/raw${qs({ sid, path })}`
}

/** 文件下载直链（attachment + 原文件名） */
export function shareDownloadUrl(token: string, sid?: string, path?: string): string {
  return `${API_BASE}/cloud/share/${token}/download${qs({ sid, path })}`
}

/**
 * 文件夹分享整包下载直链（流式 zip）。
 * 保留用于需要原生 <a>/子资源通道的场景；访客页整包下载改走 fetchSharePack（错误可提示，避免导航到 500 白页）。
 */
export function sharePackUrl(token: string, sid?: string): string {
  return `${API_BASE}/cloud/share/${token}/pack${qs({ sid })}`
}

/**
 * 文件夹分享整包下载（fetch + Blob，2026-09-12 修复）：
 * 经请求头携带凭证、可显示加载态，且非 zip 响应按统一响应体解析成可读错误——
 * 避免原生 <a> 导航把服务端错误（如 30017/30001/500）渲染成白页。
 */
export async function fetchSharePack(token: string, sid?: string): Promise<Blob> {
  let res: Response
  try {
    res = await fetch(
      `${API_BASE}/cloud/share/${token}/pack${qs({ sid })}`,
      sid ? { headers: { 'X-Share-Sid': sid } } : undefined,
    )
  } catch {
    throw new ShareApiError(-1, '网络异常')
  }
  // 非 2xx 或非 zip（业务错误走统一响应体 JSON）→ 解析成可读错误。
  // 注意：历史上服务端异常时可能「先设了 zip 头部再抛错」，故必须同时校验 res.ok
  const ctype = res.headers.get('content-type') ?? ''
  if (!res.ok || !ctype.startsWith('application/zip')) {
    let code = -1
    let message = '打包下载失败'
    try {
      const body = (await res.json()) as { code?: number; message?: string }
      code = body.code ?? -1
      message = body.message || message
    } catch {
      // 非 JSON（网关错误页等）：保留默认文案
    }
    throw new ShareApiError(code, message)
  }
  return res.blob()
}
