<template>
  <el-drawer
    :model-value="visible"
    title="布局设置"
    size="280px"
    @update:model-value="emit('close')"
  >
    <div class="v-setting-item">
      <span>显示页签栏</span>
      <el-switch v-model="settingsStore.showTabsBar" />
    </div>
    <div class="v-setting-item">
      <span>显示面包屑</span>
      <el-switch v-model="settingsStore.showBreadcrumb" />
    </div>
  </el-drawer>
</template>

<script setup lang="ts">
import { useSettingsStore } from '@/stores/settings'

defineProps<{ visible: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const settingsStore = useSettingsStore()
</script>

<style scoped>
.v-setting-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
  font-size: 14px;
  color: #303133;
}
</style>
