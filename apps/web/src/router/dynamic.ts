import type { RouteRecordRaw } from 'vue-router'
import { getUserInfo } from '@/api/system/auth'
import { usePermissionStore } from '@/stores/permission'
import { useUserStore } from '@/stores/user'
import type { MenuTreeNode } from '@/types/api'
import router from './index'

/** views 下所有页面组件，供 component 字符串映射（如 "system/user/index"） */
const viewModules = import.meta.glob('../views/**/*.vue')

/** 已静态注册、无需动态注册的路径（dashboard 落地页与 profile 个人中心在静态路由 children 中） */
const STATIC_ROUTE_PATHS = new Set(['/dashboard', '/profile'])

/** 当前已动态注册的路由名（重载菜单时用于移除「已消失」的项，如应用/页面被删） */
const registeredNames = new Set<string>()

/**
 * 把 userinfo 返回的菜单树递归转为路由并注册到 layout 下。
 * - type=1 目录：递归处理子级，自身不产生路由
 * - type=2 菜单：生成一条路由，component 字符串映射到 views 下的 .vue
 */
export function registerDynamicRoutes(menus: MenuTreeNode[]): void {
  const routes: RouteRecordRaw[] = []

  const walk = (nodes: MenuTreeNode[]) => {
    for (const node of nodes) {
      // 菜单的 path 即完整路由路径（seed 中即为全路径，如 system/user、/dashboard），
      // 无需拼接父级；目录仅递归子级，按钮不进路由
      if (node.type === 1) {
        walk(node.children ?? [])
        continue
      }
      if (node.type !== 2) continue

      const fullPath = resolvePath(node.path)
      // 静态注册的路由（dashboard）跳过，避免覆盖静态定义
      if (STATIC_ROUTE_PATHS.has(fullPath)) continue
      const component = resolveComponent(node.component)
      if (!component) continue

      routes.push({
        path: fullPath,
        name: routeName(fullPath),
        component,
        meta: {
          title: node.name,
          icon: node.icon ?? undefined,
          hidden: node.visible === 0,
          perms: node.perms ?? undefined,
        },
      })
    }
  }

  walk(menus)

  // 先移除「本轮菜单里已不存在」的旧动态路由（应用 / 功能页被删后菜单项消失）
  const nextNames = new Set(routes.map((route) => route.name as string))
  for (const name of registeredNames) {
    if (!nextNames.has(name) && router.hasRoute(name)) {
      router.removeRoute(name)
    }
  }

  for (const route of routes) {
    // 幂等：已存在同名路由则先移除再注册
    if (route.name && router.hasRoute(route.name)) {
      router.removeRoute(route.name)
    }
    router.addRoute('layout', route)
  }

  registeredNames.clear()
  for (const name of nextNames) registeredNames.add(name)
}

/**
 * 重载菜单树与动态路由（P15 反馈修复）。
 *
 * 场景：**新建 / 入册数据应用、增删功能页**后，「应用中心」下的动态菜单会变化；而菜单只在首次进入
 * （路由守卫）时取一次——不刷新页面就看不到新项（`confirmDraft` 的提示语「功能页已挂到应用中心菜单」
 * 此前并未真正生效）。本函数重取 userinfo 并重建路由（`registerDynamicRoutes` 幂等，
 * 且会移除已消失的项）。
 *
 * @returns 菜单是否发生变化（调用方可据此决定是否提示用户）
 */
export async function reloadMenus(): Promise<boolean> {
  const { user, roles, perms, menus } = await getUserInfo()
  const userStore = useUserStore()
  const permissionStore = usePermissionStore()
  const changed = menuSignature(permissionStore.menus) !== menuSignature(menus)
  userStore.setUserInfo(user, roles)
  permissionStore.setPermission(perms, menus)
  registerDynamicRoutes(menus)
  permissionStore.setRoutesLoaded(true)
  return changed
}

/** 菜单签名（path|name 序列；用于判断菜单是否变化） */
function menuSignature(menus: MenuTreeNode[]): string {
  const parts: string[] = []
  const walk = (nodes: MenuTreeNode[]): void => {
    for (const node of nodes) {
      parts.push(`${node.path ?? ''}|${node.name}`)
      if (node.children && node.children.length > 0) walk(node.children)
    }
  }
  walk(menus)
  return parts.join(',')
}

/** 规范化路由路径（seed 的 path 可能是 /dashboard 或 system/user，统一补前导斜杠） */
function resolvePath(path: string | null): string {
  if (!path) return '/'
  return path.startsWith('/') ? path : `/${path}`
}

/** component 字符串（如 "system/user/index"）映射到 views 组件 */
function resolveComponent(component: string | null) {
  if (!component) return null
  const key = `../views/${component.replace(/^\//, '')}.vue`
  return viewModules[key] ?? null
}

/** 由路径生成路由名（/system/user -> system-user） */
function routeName(path: string): string {
  return path.replace(/^\//, '').replace(/\//g, '-') || 'home'
}
