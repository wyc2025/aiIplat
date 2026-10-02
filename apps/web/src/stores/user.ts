import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { UserInfo } from '@/types/api'
import { fetchAvatarBlob } from '@/api/cloud/file'
import { clearTokens, getAccessToken } from '@/utils/token'

/**
 * 用户状态：当前登录人信息 + 角色标识 + 头像展示地址。
 *
 * 头像口径（PROGRESS 遗留 18）：`userInfo.avatar` 是受登录保护的后端路径，`<img src>` 直连带不了
 * Authorization 必然 401；故由本 store 统一拉 Blob 换 objectURL 供展示（`avatarUrl`），
 * 并负责 objectURL 的回收（换头像 / 登出时 revoke，避免内存泄漏）。
 * 未设置头像或拉取失败 → `avatarUrl` 为空，组件自然回退昵称首字母。
 * 后续接 MinIO/OSS 时若改为预签名 URL（可直接 `<img>` 直连 + 浏览器缓存），只需替换本文件的取图实现。
 */
export const useUserStore = defineStore('user', () => {
  const userInfo = ref<UserInfo | null>(null)
  const roles = ref<string[]>([])
/** 角色显示名（与 `roles` 同序）；接口未返回时退化为 code，见 setUserInfo */
const roleLabels = ref<string[]>([])
  /** 头像展示地址（objectURL；空 = 无头像/加载失败，组件回退首字母） */
  const avatarUrl = ref('')

  /** 已换取 objectURL 的头像路径（用于跳过重复请求） */
  let loadedAvatarPath = ''
  /** 当前生效的 objectURL（需显式 revoke） */
  let objectUrl = ''

  const isLogin = computed(() => Boolean(getAccessToken()) && userInfo.value !== null)
  /** 是否超管（roles 含 admin） */
  const isSuperAdmin = computed(() => roles.value.includes('admin'))
  const nickname = computed(() => userInfo.value?.nickname ?? '')

  /** 释放当前 objectURL */
  function releaseAvatarUrl() {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl)
      objectUrl = ''
    }
    avatarUrl.value = ''
  }

  /**
   * 拉取头像 Blob 并换成 objectURL（幂等：同路径不重复请求）。
   * 失败静默回退（不弹错、不阻断登录流程）；等待期间若已登出或又换了头像，则丢弃本次结果。
   */
  async function syncAvatar(): Promise<void> {
    const path = userInfo.value?.avatar ?? ''
    if (!path) {
      loadedAvatarPath = ''
      releaseAvatarUrl()
      return
    }
    if (path === loadedAvatarPath && objectUrl) return
    loadedAvatarPath = path
    try {
      const blob = await fetchAvatarBlob(path)
      if (loadedAvatarPath !== path || userInfo.value?.avatar !== path) return
      releaseAvatarUrl()
      objectUrl = URL.createObjectURL(blob)
      avatarUrl.value = objectUrl
    } catch {
      releaseAvatarUrl()
    }
  }

  function setUserInfo(user: UserInfo, roleCodes: string[], roleNames: string[] = []) {
    userInfo.value = user
    roles.value = roleCodes
    // 展示用名称：接口未返回时退化为 code（老后端兼容）——界面统一读 roleLabels
    roleLabels.value = roleNames.length > 0 ? roleNames : roleCodes
    void syncAvatar()
  }

  /** 头像上传成功后同步（P3 走 per-account 头像行，fileId 变化即天然版本化，无需防缓存） */
  function setAvatar(avatarPath: string) {
    if (!userInfo.value) return
    userInfo.value = { ...userInfo.value, avatar: avatarPath }
    void syncAvatar()
  }

  function reset() {
    userInfo.value = null
    roles.value = []
    roleLabels.value = []
    loadedAvatarPath = ''
    releaseAvatarUrl()
    clearTokens()
  }

  return {
    userInfo,
    roles,
    roleLabels,
    avatarUrl,
    isLogin,
    isSuperAdmin,
    nickname,
    setUserInfo,
    setAvatar,
    syncAvatar,
    reset,
  }
})
