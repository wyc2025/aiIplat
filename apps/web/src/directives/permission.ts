import type { App, Directive, DirectiveBinding } from 'vue'
import { usePermissionStore } from '@/stores/permission'

/**
 * v-permission 按钮权限指令（ARCHITECTURE 3.2.5）：
 * - v-permission="'system:user:create'" 无权限则移除元素
 * - v-permission="['a','b']" 满足其一即可
 * - 超管（perms 含 '*'）直接放行
 */
function checkPermission(el: HTMLElement, binding: DirectiveBinding<string | string[]>): void {
  const permissionStore = usePermissionStore()
  const value = binding.value
  if (value === undefined || value === null) return
  if (!permissionStore.hasPerm(value)) {
    el.parentNode?.removeChild(el)
  }
}

const permissionDirective: Directive<HTMLElement, string | string[]> = {
  mounted: checkPermission,
}

export function setupPermissionDirective(app: App): void {
  app.directive('permission', permissionDirective)
}
