import type { TokenPair, UserInfoResult } from '@/types/api'
import { get, post } from '@/utils/request'

/** 登录 */
export function login(data: { username: string; password: string }): Promise<TokenPair> {
  return post<TokenPair>('/auth/login', data)
}

/** 登出 */
export function logout(): Promise<null> {
  return post<null>('/auth/logout')
}

/** 当前用户信息（用户 + 角色 + 权限标识 + 菜单树） */
export function getUserInfo(): Promise<UserInfoResult> {
  return get<UserInfoResult>('/auth/userinfo')
}
