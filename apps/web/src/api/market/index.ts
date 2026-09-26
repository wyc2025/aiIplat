import { get, post } from '@/utils/request'

// ==================== 应用市场（P13 T121，API §20） ====================

/** 市场卡片项 */
export interface MarketCard {
  code: string
  name: string
  description: string | null
  publisherName: string | null
  tableCount: number
  pageCount: number
  hasDemo: boolean
  copyCount: number
  listedAt: string | null
}

/** 结构摘要（详情/审核共用） */
export interface MarketSnapshotSummary {
  tables: Array<{ name: string; label: string; fieldCount: number }>
  pages: Array<{ name: string; route: string; kind: string }>
}

/** 市场条目详情 */
export interface MarketDetail extends MarketCard, MarketSnapshotSummary {}

/** 分页外壳 */
export interface MarketPage<T> {
  list: T[]
  total: number
  page: number
  pageSize: number
}

/** 我的提交项（全状态） */
export interface MySubmission extends MarketSnapshotSummary {
  code: string
  appCode: string | null
  name: string
  description: string | null
  status: 'pending' | 'approved' | 'rejected' | 'delisted'
  hasDemo: boolean
  copyCount: number
  reviewNote: string | null
  tableCount: number
  pageCount: number
  createdAt: string
  reviewedAt: string | null
  listedAt: string | null
  delistedAt: string | null
}

/** 审核列表项（含 id，供审核动作） */
export interface ReviewItem extends MarketSnapshotSummary {
  id: string
  code: string
  name: string
  description: string | null
  publisherId: string
  publisherName: string | null
  hasDemo: boolean
  createdAt: string
  listedAt: string | null
  tableCount: number
  pageCount: number
}

/** 复制结果 */
export interface MarketCopyResult {
  appCode: string
  tableCount: number
  pageCount: number
  rowCount: number
  skippedRows: number
}

/** 市场列表（approved 且未下架，按上架时间倒序） */
export const listMarket = (params: { page?: number; pageSize?: number }) =>
  get<MarketPage<MarketCard>>('/market/list', params)

/** 条目详情（不存在/未上架 → 50014） */
export const getMarketDetail = (code: string) => get<MarketDetail>(`/market/${code}`)

/** 复制为我的新应用（配额满 50002） */
export const copyMarketApp = (code: string) =>
  post<MarketCopyResult>(`/market/${code}/copy`)

/** 提交应用到市场（重复活跃条目 50013；演示数据超限 50015） */
export const submitToMarket = (data: { appCode: string; withDemoData?: boolean }) =>
  post<{ ok: boolean; listingCode: string; status: string }>('/market/submissions', data)

/** 我的提交（全状态） */
export const listMySubmissions = () => get<MySubmission[]>('/market/mine')

// ==================== 审核面（market:review） ====================

/** 审核列表：pending（默认，待审）/ approved（在架，供下架） */
export const listReviewListings = (status: 'pending' | 'approved') =>
  get<ReviewItem[]>('/market/review/list', { status })

/** 审核动作（approve / reject 必填 note / delist） */
export const reviewListing = (
  id: string,
  data: { action: 'approve' | 'reject' | 'delist'; note?: string },
) => post<{ id: string; code: string; status: string }>(`/market/review/${id}`, data)
