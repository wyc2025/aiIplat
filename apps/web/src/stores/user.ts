import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { UserInfo } from '@/types/api'
import { clearTokens, getAccessToken } from '@/utils/token'

/** 用户状态：当前登录人信息 + 角色标识 */
export const useUserStore = defineStore('user', () => {
  const userInfo = ref<UserInfo | null>(null)
  const roles = ref<string[]>([])

  const isLogin = computed(() => Boolean(getAccessToken()) && userInfo.value !== null)
  /** 是否超管（roles 含 admin） */
  const isSuperAdmin = computed(() => roles.value.includes('admin'))
  const nickname = computed(() => userInfo.value?.nickname ?? '')
  const avatar = computed(() => userInfo.value?.avatar ?? '')

  function setUserInfo(user: UserInfo, roleCodes: string[]) {
    userInfo.value = user
    roles.value = roleCodes
  }

  function reset() {
    userInfo.value = null
    roles.value = []
    clearTokens()
  }

  return { userInfo, roles, isLogin, isSuperAdmin, nickname, avatar, setUserInfo, reset }
})
