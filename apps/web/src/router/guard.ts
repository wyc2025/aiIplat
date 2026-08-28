import type { Router } from 'vue-router'
import { getUserInfo } from '@/api/system/auth'
import { usePermissionStore } from '@/stores/permission'
import { useUserStore } from '@/stores/user'
import { getAccessToken } from '@/utils/token'
import { registerDynamicRoutes } from './dynamic'

const WHITE_LIST = ['/login', '/404']

/** 免登录公开页（如云盘访客分享页，凭 token 访问，不要求登录态） */
function isPublicRoute(to: { path: string; name: unknown | symbol }): boolean {
  return WHITE_LIST.includes(to.path) || to.name === 'share-visitor'
}

/**
 * 确保权限数据与动态路由已就绪。
 * 供 layout 路由的 beforeEnter 调用：必须在 redirect 到 /dashboard 之前完成注册，
 * 否则 /dashboard 尚未注册会落到 catch-all 404。
 * 返回 true 放行；无 token / 加载失败返回登录页重定向。
 */
export async function ensurePermissionLoaded(): Promise<boolean | { path: string }> {
  const token = getAccessToken()
  if (!token) return { path: '/login' }

  const userStore = useUserStore()
  const permissionStore = usePermissionStore()
  if (permissionStore.routesLoaded) return true

  try {
    const { user, roles, perms, menus } = await getUserInfo()
    userStore.setUserInfo(user, roles)
    permissionStore.setPermission(perms, menus)
    registerDynamicRoutes(menus)
    permissionStore.setRoutesLoaded(true)
    return true
  } catch {
    userStore.reset()
    permissionStore.reset()
    return { path: '/login' }
  }
}

/**
 * 全局前置守卫（ARCHITECTURE 3.2.6）：
 * - 白名单直接放行；已登录访问 /login → 重定向首页
 * - 无 token → /login
 * - 有 token 但动态路由未加载（含直达 /system/user 等深层路径，此时 layout 的
 *   beforeEnter 因未匹配而不触发）→ 先注册路由再 replace 重走导航
 */
export function setupRouterGuard(router: Router): void {
  router.beforeEach(async (to) => {
    const token = getAccessToken()

    if (isPublicRoute(to)) {
      if (to.path === '/login' && token) return '/dashboard'
      return true
    }

    if (!token) {
      return { path: '/login', query: to.fullPath !== '/' ? { redirect: to.fullPath } : {} }
    }

    // 动态路由未注册 → 先加载（含直达深层路径的场景），注册后重走让新路由生效。
    // 用 path/query 重建导航而非 spread to：to 此刻可能匹配的是 catch-all，
    // 其 name/matched 等字段会劫持重定向目标。
    const permissionStore = usePermissionStore()
    if (!permissionStore.routesLoaded) {
      console.warn('[guard] loading perms for', to.path)
      const result = await ensurePermissionLoaded()
      console.warn('[guard] routes after:', JSON.stringify(router.getRoutes().map((r) => r.path)))
      if (result !== true) return result
      return { path: to.path, query: to.query, replace: true }
    }

    return true
  })
}
