import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { RouteLocationNormalized } from 'vue-router'
import { usePermissionStore } from '@/stores/permission'
import type { MenuTreeNode } from '@/types/api'

const STORAGE_KEY = 'iplat_tabs'

/** 页签项 */
export interface TabItem {
  /**
   * 路由**完整路径**（含 query，如 `/app-center/schema?appCode=app(9)`），作为唯一标识。
   * 2026-09-29 修正：此前用 `route.path`（丢 query），导致同一编辑器被多个应用共用一条页签、
   * 点页签还丢失 appCode。
   */
  fullPath: string
  title: string
}

/** 恢复持久化页签（结构校验，异常回退空数组；兼容早期只存 path 的旧数据） */
function load(): TabItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const list = raw ? JSON.parse(raw) : []
    if (!Array.isArray(list)) return []
    return list
      .map((tab: { fullPath?: unknown; path?: unknown; title?: unknown } | null) => {
        const fullPath = typeof tab?.fullPath === 'string' ? tab.fullPath : typeof tab?.path === 'string' ? tab.path : ''
        const title = typeof tab?.title === 'string' ? tab.title : ''
        return fullPath && title ? { fullPath, title } : null
      })
      .filter((tab): tab is TabItem => tab !== null)
  } catch {
    return []
  }
}

/**
 * 按路由 path 在菜单树中反查显示名（菜单节点的 path 即完整路由路径）。
 * 用途：功能页 / 应用编辑器这类"动态进入"的页面，`meta.title` 只能是笼统的"功能页"，
 * 反查菜单后可显示"字帖管理"这类真名。
 */
function findMenuName(nodes: MenuTreeNode[], path: string): string | null {
  for (const node of nodes) {
    if (node.path === path && node.name) return node.name
    const hit = node.children?.length ? findMenuName(node.children, path) : null
    if (hit) return hit
  }
  return null
}

/** 页签状态（TabsBar），持久化到 localStorage（关闭浏览器重开可恢复） */
export const useTabsStore = defineStore('tabs', () => {
  const tabs = ref<TabItem[]>(load())

  // 页签增删即持久化；reset/removeAll 清空时同样触发写入
  watch(
    tabs,
    (value) => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
    },
    { deep: true },
  )

  /**
   * 记录页签（2026-09-29 口径修正）：**访问即记录**，不再沿用 `meta.hidden` 拦截——
   * `hidden` 只表示"不进侧边菜单"，此前被复用成"不记页签"，导致应用功能页 / 结构编辑器 /
   * 功能页编辑器 / 个人中心从菜单（或卡片、顶栏）进入却没有页签。
   * 标题优先级：菜单名 → `meta.title` → 路由名 → 完整路径。
   */
  function addTab(route: RouteLocationNormalized) {
    const fullPath = route.fullPath
    if (tabs.value.some((tab) => tab.fullPath === fullPath)) return
    const menuName = findMenuName(usePermissionStore().menus, route.path)
    const title = menuName ?? (route.meta?.title as string) ?? route.name?.toString() ?? fullPath
    tabs.value.push({ fullPath, title })
  }

  function removeTab(fullPath: string): string | null {
    const index = tabs.value.findIndex((tab) => tab.fullPath === fullPath)
    if (index === -1) return null
    tabs.value.splice(index, 1)
    // 返回删除后应跳转的页签（优先右侧，其次左侧）
    const next = tabs.value[index] ?? tabs.value[index - 1]
    return next ? next.fullPath : null
  }

  /** 关闭其他页签（始终保留首页工作台与目标页签；首页不可关闭，2026-09-11 用户要求） */
  function removeOthers(fullPath: string) {
    tabs.value = tabs.value.filter((tab) => tab.fullPath === fullPath || tab.fullPath === '/dashboard')
  }

  function removeAll() {
    tabs.value = []
  }

  function reset() {
    tabs.value = []
  }

  return { tabs, addTab, removeTab, removeOthers, removeAll, reset }
})
