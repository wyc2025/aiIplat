import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

const STORAGE_KEY = 'iplat_settings'

interface PersistedSettings {
  sidebarCollapsed: boolean
  showTabsBar: boolean
  showBreadcrumb: boolean
}

const defaults: PersistedSettings = {
  sidebarCollapsed: false,
  showTabsBar: true,
  showBreadcrumb: true,
}

function load(): PersistedSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? { ...defaults, ...JSON.parse(raw) } : { ...defaults }
  } catch {
    return { ...defaults }
  }
}

/** 布局设置（侧边栏折叠、TabsBar/面包屑开关），持久化到 localStorage */
export const useSettingsStore = defineStore('settings', () => {
  const persisted = load()
  const sidebarCollapsed = ref(persisted.sidebarCollapsed)
  const showTabsBar = ref(persisted.showTabsBar)
  const showBreadcrumb = ref(persisted.showBreadcrumb)

  watch(
    [sidebarCollapsed, showTabsBar, showBreadcrumb],
    () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          sidebarCollapsed: sidebarCollapsed.value,
          showTabsBar: showTabsBar.value,
          showBreadcrumb: showBreadcrumb.value,
        }),
      )
    },
    { deep: true },
  )

  function toggleSidebar() {
    sidebarCollapsed.value = !sidebarCollapsed.value
  }

  return { sidebarCollapsed, showTabsBar, showBreadcrumb, toggleSidebar }
})
