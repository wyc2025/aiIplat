import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { RouteLocationNormalized } from 'vue-router'

const STORAGE_KEY = 'iplat_tabs'

/** 页签项 */
export interface TabItem {
  /** 路由 path，作为唯一标识 */
  path: string
  title: string
}

/** 恢复持久化页签（结构校验，异常回退空数组） */
function load(): TabItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list)
      ? list.filter((tab) => tab && typeof tab.path === 'string' && typeof tab.title === 'string')
      : []
  } catch {
    return []
  }
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

  function addTab(route: RouteLocationNormalized) {
    if (route.meta?.hidden) return
    const path = route.path
    if (tabs.value.some((tab) => tab.path === path)) return
    tabs.value.push({ path, title: (route.meta?.title as string) ?? route.name?.toString() ?? path })
  }

  function removeTab(path: string): string | null {
    const index = tabs.value.findIndex((tab) => tab.path === path)
    if (index === -1) return null
    tabs.value.splice(index, 1)
    // 返回删除后应跳转的页签（优先右侧，其次左侧）
    const next = tabs.value[index] ?? tabs.value[index - 1]
    return next ? next.path : null
  }

  /** 关闭其他页签（始终保留首页工作台与目标页签；首页不可关闭，2026-09-11 用户要求） */
  function removeOthers(path: string) {
    tabs.value = tabs.value.filter((tab) => tab.path === path || tab.path === '/dashboard')
  }

  function removeAll() {
    tabs.value = []
  }

  function reset() {
    tabs.value = []
  }

  return { tabs, addTab, removeTab, removeOthers, removeAll, reset }
})
