import { get, post } from '@/utils/request'
import type { CloudShare, CloudShareCreateResult } from '@/types/api'

/**
 * 创建分享（P4d：文件/文件夹均可 + 可选提取码；重复创建返回现存链接；url 为站内相对路径 /share/:token）。
 * password 为 4~8 位提取码，留空 = 无密码（现状兼容）。
 */
export const createShare = (fileId: number, expireDays = 7, password?: string) =>
  post<CloudShareCreateResult>('/cloud/share/create', {
    fileId,
    expireDays,
    ...(password ? { password } : {}),
  })

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

/** 停止分享 */
export const stopShare = (id: number) => post('/cloud/share/stop', { id })

/** 延长分享时间（从 max(now, expireAt) 续档；已停止不可延长），返回最新过期时间 */
export const extendShare = (id: number, expireDays: number) =>
  post<{ id: string; expireAt: string | null }>('/cloud/share/extend', { id, expireDays })

/** 修改 / 移除提取码（P4d：password 为 null 表示移除；旧访问凭证立即失效） */
export const updateSharePassword = (id: number, password: string | null) =>
  post<{ id: string; hasPassword: boolean }>(`/cloud/share/${id}/password`, { password })
