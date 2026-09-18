<template>
  <aside
    class="v-sidebar"
    :class="{ collapsed: settingsStore.sidebarCollapsed }"
  >
    <div class="v-logo">
      <AppLogo :size="22" />
      <span
        v-if="!settingsStore.sidebarCollapsed"
        class="v-logo-text"
      >iplat</span>
    </div>
    <el-scrollbar class="v-menu-scroll">
      <el-menu
        :default-active="activeMenu"
        :collapse="settingsStore.sidebarCollapsed"
        :collapse-transition="false"
        unique-opened
        router
        class="v-menu"
      >
        <SidebarItem :menus="permissionStore.menus" />
      </el-menu>
    </el-scrollbar>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { usePermissionStore } from '@/stores/permission'
import { useSettingsStore } from '@/stores/settings'
import AppLogo from '@/components/AppLogo/index.vue'
import SidebarItem from './SidebarItem.vue'

const route = useRoute()
const permissionStore = usePermissionStore()
const settingsStore = useSettingsStore()

const activeMenu = computed(() => route.path)
</script>

<style scoped>
.v-sidebar {
  width: 210px;
  height: 100vh;
  background: #001529;
  transition: width 0.28s;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
}
.v-sidebar.collapsed {
  width: 64px;
}
.v-logo {
  height: 50px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  overflow: hidden;
}
.v-logo-text {
  color: #fff;
  font-size: 18px;
  font-weight: 600;
  white-space: nowrap;
}
.v-menu-scroll {
  flex: 1;
}
.v-menu {
  border-right: none;
  background: #001529;
  --el-menu-text-color: #bfcbd9;
  --el-menu-hover-bg-color: #000c17;
  --el-menu-active-color: #fff;
  --el-menu-bg-color: #001529;
}
.v-menu:not(.el-menu--collapse) {
  width: 210px;
}
</style>
