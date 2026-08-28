import { get, post } from '@/utils/request'
import type { CloudShare, CloudShareCreateResult } from '@/types/api'

/** 创建分享（仅文件 + 审核门禁，重复创建返回现存链接；url 为站内相对路径 /share/:token） */
export const createShare = (fileId: number, expireDays = 7) =>
  post<CloudShareCreateResult>('/cloud/share/create', { fileId, expireDays })

/**
 * 我的分享（创建时间倒序）。
 * status 缺省 → 后端排除"已停止"（默认视图不展示已停止链接）；0 已停止 / 1 有效 / 2 已过期。
 * keyword → 文件名模糊过滤。
 */
export const listShare = (status?: number, keyword?: string) => {
  const params: Record<string, unknown> = {}
  if (status !== undefined) params.status = status
  if (keyword) params.keyword = keyword
  return get<CloudShare[]>('/cloud/share/list', params)
}

/** 停止公开 */
export const stopShare = (id: number) => post('/cloud/share/stop', { id })

/** 延长时间（从 max(now, expireAt) 续档；已停止不可延长），返回最新过期时间 */
export const extendShare = (id: number, expireDays: number) =>
  post<{ id: string; expireAt: string | null }>('/cloud/share/extend', { id, expireDays })

/** 访客侧分享信息（免登录，独立路由页用，不走统一拦截器 token） */
export const publicShareInfo = (token: string) =>
  get<import('@/types/api').CloudSharePublic>(`/cloud/share/${token}`)

/** 访客下载直链（@Public，浏览器直接访问，无需 token） */
export const publicDownloadUrl = (token: string) => {
  const base = import.meta.env.VITE_API_BASE_URL ?? '/api'
  return `${base}/cloud/share/${token}/download`
}
