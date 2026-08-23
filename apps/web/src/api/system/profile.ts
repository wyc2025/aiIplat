import { put } from '@/utils/request'

export interface UpdateProfilePayload {
  nickname: string
  email?: string
  phone?: string
  gender?: number
}

export interface ChangePasswordPayload {
  oldPassword: string
  newPassword: string
}

/** 个人中心：修改自己的基本信息 */
export const updateProfile = (data: UpdateProfilePayload) => put('/system/user/profile', data)

/** 个人中心：修改密码（成功后后端使全部会话失效，需重新登录） */
export const changePassword = (data: ChangePasswordPayload) =>
  put('/system/user/profile/password', data)
