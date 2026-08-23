<template>
  <template
    v-for="node in visibleMenus"
    :key="node.id"
  >
    <!-- 目录：可展开收起 -->
    <el-sub-menu
      v-if="node.type === 1"
      :index="resolvePath(node)"
    >
      <template #title>
        <el-icon v-if="node.icon">
          <component :is="node.icon" />
        </el-icon>
        <span>{{ node.name }}</span>
      </template>
      <SidebarItem :menus="node.children ?? []" />
    </el-sub-menu>
    <!-- 菜单：可点击跳转 -->
    <el-menu-item
      v-else
      :index="resolvePath(node)"
    >
      <el-icon v-if="node.icon">
        <component :is="node.icon" />
      </el-icon>
      <template #title>
        {{ node.name }}
      </template>
    </el-menu-item>
  </template>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { MenuTreeNode } from '@/types/api'

const props = defineProps<{
  menus: MenuTreeNode[]
}>()

/** 隐藏菜单（visible=0）不进侧边栏，但路由已注册可直达 */
const visibleMenus = computed(() => props.menus.filter((m) => m.visible !== 0))

/** 菜单 path 即完整路由路径（与 dynamic.ts 一致），仅补前导斜杠 */
function resolvePath(node: MenuTreeNode): string {
  const path = node.path ?? ''
  if (!path) return ''
  return path.startsWith('/') ? path : `/${path}`
}
</script>
