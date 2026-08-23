<template>
  <div
    v-if="settingsStore.showTabsBar"
    class="v-tabs-bar"
  >
    <el-tag
      v-for="tab in tabsStore.tabs"
      :key="tab.path"
      :closable="tab.path !== '/dashboard'"
      :effect="tab.path === route.path ? 'dark' : 'plain'"
      class="v-tab"
      @click="router.push(tab.path)"
      @close="closeTab(tab.path)"
    >
      {{ tab.title }}
    </el-tag>
  </div>
</template>

<script setup lang="ts">
import { watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSettingsStore } from '@/stores/settings'
import { useTabsStore } from '@/stores/tabs'

const route = useRoute()
const router = useRouter()
const tabsStore = useTabsStore()
const settingsStore = useSettingsStore()

// 路由变化即记录页签
watch(
  () => route.path,
  () => tabsStore.addTab(route),
  { immediate: true },
)

function closeTab(path: string) {
  const next = tabsStore.removeTab(path)
  // 关闭的是当前页 → 跳到相邻页签；无页签则回首页
  if (path === route.path) {
    router.push(next ?? '/dashboard')
  }
}
</script>

<style scoped>
.v-tabs-bar {
  height: 40px;
  background: #fff;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 16px;
  border-top: 1px solid #f0f0f0;
  overflow-x: auto;
}
.v-tab {
  cursor: pointer;
  flex-shrink: 0;
}
</style>
