/**
 * 数据应用公开访问 API（P12 T113，访客侧免登录）。
 *
 * 故意不走 utils/request 统一封装（照 api/cloud/public.ts 先例）：
 * 公开页不要求登录态（无需 401 刷新链路），且统一封装对业务错误会弹全局 ElMessage 并丢失 code——
 * 公开页需要按 code 区分 40400（未公开/不存在，统一防探测）与 40001（参数越界）。
 */
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api'

/** 公开接口业务错误（保留 code 供页面分支） */
export class AppPubApiError extends Error {
  readonly code: number

  constructor(code: number, message: string) {
    super(message)
    this.name = 'AppPubApiError'
    this.code = code
  }
}

/** 公开 manifest */
export interface PubAppManifest {
  name: string
  description: string | null
  pages: Array<{ code: string; name: string }>
}

/** 公开列表响应（R101 投影后） */
export interface PubListPayload {
  list: Array<Record<string, unknown>>
  total: number
  pageNo: number
  pageSize: number
}

/** 公开查询参数（R104：重复参数 sort/filter/expand 以数组传入） */
export interface PubQueryParams {
  page?: number
  size?: number
  sort?: string[]
  filter?: string[]
  expand?: string[]
}

/** 公开列表分页取数（R104 固定参数） */
async function pubGet<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  const search = new URLSearchParams()
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue
      if (Array.isArray(value)) {
        for (const item of value) search.append(key, String(item))
      } else {
        search.append(key, String(value))
      }
    }
  }
  const qs = search.toString()
  const res = await fetch(`${API_BASE}${url}${qs ? `?${qs}` : ''}`)
  let body: { code: number; message: string; data: T } | null = null
  try {
    body = (await res.json()) as { code: number; message: string; data: T }
  } catch {
    throw new AppPubApiError(-1, '网络异常，请稍后再试')
  }
  if (!body || body.code !== 0) {
    throw new AppPubApiError(body?.code ?? -1, body?.message || '资源不存在')
  }
  return body.data
}

/** 公开 manifest（应用名 + 公开展示页清单） */
export function pubAppManifest(pubCode: string): Promise<PubAppManifest> {
  return pubGet<PubAppManifest>(`/pub/app/${pubCode}`)
}

/** 公开展示页 schema */
export function pubAppPageSchema(
  pubCode: string,
  pageCode: string,
): Promise<Record<string, unknown>> {
  return pubGet<Record<string, unknown>>(`/pub/app/${pubCode}/pages/${pageCode}/schema`)
}

/** 公开列表（R104 参数越界 → 40001；表未暴露/应用未公开 → 40400） */
export function pubAppDataList(
  pubCode: string,
  table: string,
  params: PubQueryParams = {},
): Promise<PubListPayload> {
  return pubGet<PubListPayload>(`/pub/app/${pubCode}/data/${table}`, params as Record<string, unknown>)
}

/** 公开单行（行不存在 → 40400） */
export function pubAppDataDetail(
  pubCode: string,
  table: string,
  rowId: string,
  params: Pick<PubQueryParams, 'expand'> = {},
): Promise<Record<string, unknown>> {
  return pubGet<Record<string, unknown>>(
    `/pub/app/${pubCode}/data/${table}/${rowId}`,
    params as Record<string, unknown>,
  )
}

/** 公开附件直链（img/附件正常走浏览器 <img>/<video>，无需 token） */
export function pubAppFileUrl(pubCode: string, fileId: string, download = false): string {
  return `${API_BASE}/pub/app/${pubCode}/file/${fileId}${download ? '?download=1' : ''}`
}
