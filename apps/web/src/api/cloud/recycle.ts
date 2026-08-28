import { get, post, del } from '@/utils/request'
import type { CloudRecycleItem, BreadcrumbItem } from '@/types/api'

/** 回收站列表（parentId 0/缺省=顶层被删项；带 parentId=只读浏览被删文件夹内容），返回裸数组（对齐 P1/P2 非分页列表风格） */
export const listRecycle = (parentId?: number) =>
  get<CloudRecycleItem[]>('/cloud/recycle/list', parentId != null ? { parentId } : {})

/** 回收站面包屑链 */
export const recyclePath = (id: number) =>
  get<BreadcrumbItem[]>('/cloud/recycle/path', { id })

/** 还原 */
export const restoreRecycle = (id: number) =>
  post<CloudRecycleItem>('/cloud/recycle/restore', { id })

/** 清空回收站 */
export const clearRecycle = () => del('/cloud/recycle/clear')

/** 彻底删除（递归子树 + 连带删分享 + used 回扣） */
export const purgeRecycle = (id: number) => del(`/cloud/recycle/${id}`)
