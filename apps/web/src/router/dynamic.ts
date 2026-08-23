import type { RouteRecordRaw } from 'vue-router'
import type { MenuTreeNode } from '@/types/api'
import router from './index'

/** views 下所有页面组件，供 component 字符串映射（如 "system/user/index"） */
const viewModules = import.meta.glob('../views/**/*.vue')

/** 已静态注册、无需动态注册的路径（dashboard 落地页与 profile 个人中心在静态路由 children 中） */
const STATIC_ROUTE_PATHS = new Set(['/dashboard', '/profile'])

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

  for (const route of routes) {
    // 幂等：已存在同名路由则先移除再注册
    if (route.name && router.hasRoute(route.name)) {
      router.removeRoute(route.name)
    }
    router.addRoute('layout', route)
  }
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
