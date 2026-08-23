import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { MenuTreeNode } from '@/types/api'

/** 权限状态：权限标识集合 + 菜单树（驱动侧边栏与动态路由） */
export const usePermissionStore = defineStore('permission', () => {
  const perms = ref<string[]>([])
  const menus = ref<MenuTreeNode[]>([])
  /** 动态路由是否已注册（防止重复 addRoute） */
  const routesLoaded = ref(false)

  function setPermission(permList: string[], menuTree: MenuTreeNode[]) {
    perms.value = permList
    menus.value = menuTree
  }

  function setRoutesLoaded(loaded: boolean) {
    routesLoaded.value = loaded
  }

  /** 是否拥有某权限标识（超管 '*' 直接放行；数组满足其一即可） */
  function hasPerm(perm: string | string[]): boolean {
    if (perms.value.includes('*')) return true
    const required = Array.isArray(perm) ? perm : [perm]
    if (required.length === 0) return true
    return required.some((p) => perms.value.includes(p))
  }

  function reset() {
    perms.value = []
    menus.value = []
    routesLoaded.value = false
  }

  return { perms, menus, routesLoaded, setPermission, setRoutesLoaded, hasPerm, reset }
})
