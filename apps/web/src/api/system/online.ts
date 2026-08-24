import { del, get } from '@/utils/request'

/** 在线用户项 */
export interface OnlineUserItem {
  userId: string
  username: string
  nickname: string
  ip: string
  loginAt: string
  lastActiveAt: string
}

/** 在线用户列表（不分页） */
export const getOnlineList = () => get<OnlineUserItem[]>('/system/online')

/** 踢下线 */
export const kickUser = (userId: string) => del(`/system/online/${userId}`)
