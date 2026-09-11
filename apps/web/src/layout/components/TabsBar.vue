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
      @contextmenu="onContextMenu($event, tab)"
    >
      {{ tab.title }}
    </el-tag>

    <!-- 右键菜单：关闭当前 / 关闭其他（首页工作台不可关闭） -->
    <Teleport to="body">
      <div
        v-if="ctxMenu"
        class="v-tab-ctx"
        :style="{ left: `${ctxMenu.x}px`, top: `${ctxMenu.y}px` }"
        @contextmenu.prevent
      >
        <div
          v-if="ctxMenu.tab.path !== '/dashboard'"
          class="v-tab-ctx-item"
          @click="onCloseCurrent"
        >
          关闭当前
        </div>
        <div
          class="v-tab-ctx-item"
          @click="onCloseOthers"
        >
          关闭其他
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useSettingsStore } from '@/stores/settings'
import { useTabsStore, type TabItem } from '@/stores/tabs'

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

// ==================== 右键菜单（关闭当前 / 关闭其他） ====================
const ctxMenu = ref<{ x: number; y: number; tab: TabItem } | null>(null)

function onContextMenu(e: MouseEvent, tab: TabItem) {
  e.preventDefault()
  ctxMenu.value = { x: e.clientX, y: e.clientY, tab }
}
function closeMenu() {
  ctxMenu.value = null
}
function onCloseCurrent() {
  if (!ctxMenu.value) return
  closeTab(ctxMenu.value.tab.path)
  closeMenu()
}
function onCloseOthers() {
  if (!ctxMenu.value) return
  const keep = ctxMenu.value.tab.path
  tabsStore.removeOthers(keep)
  // 当前页被关闭 → 跳到保留的页签
  if (route.path !== keep) router.push(keep)
  closeMenu()
}
onMounted(() => document.addEventListener('click', closeMenu))
onBeforeUnmount(() => document.removeEventListener('click', closeMenu))
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

<style>
/* 右键菜单（Teleport 挂 body，全局样式） */
.v-tab-ctx {
  position: fixed;
  z-index: 3000;
  min-width: 120px;
  background: #fff;
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
  padding: 4px 0;
}
.v-tab-ctx-item {
  padding: 7px 16px;
  font-size: 13px;
  color: #303133;
  cursor: pointer;
  user-select: none;
}
.v-tab-ctx-item:hover {
  background: #f5f7fa;
  color: var(--el-color-primary);
}
</style>
