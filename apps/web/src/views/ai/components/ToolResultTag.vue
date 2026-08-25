<template>
  <div class="v-tool-result">
    <div
      class="v-tr-tag"
      :class="status"
      @click="expanded = !expanded"
    >
      <el-icon class="v-tr-icon">
        <Search v-if="status === 'executed'" />
        <CircleClose v-else />
      </el-icon>
      <span>{{ status === 'executed' ? '已' : '未' }}{{ title }}</span>
      <el-icon class="v-tr-arrow">
        <ArrowDown v-if="!expanded" />
        <ArrowUp v-else />
      </el-icon>
    </div>
    <div
      v-if="expanded"
      class="v-tr-detail"
    >
      <pre>{{ summary }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ArrowDown, ArrowUp, CircleClose, Search } from '@element-plus/icons-vue'

defineProps<{
  title: string
  summary: string
  status: string
}>()

const expanded = ref(false)
</script>

<style scoped>
.v-tool-result {
  margin-top: 8px;
}
.v-tr-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 12px;
  cursor: pointer;
  background: #f0f9eb;
  color: #67c23a;
  border: 1px solid #e1f3d8;
}
.v-tr-tag.failed {
  background: #fef0f0;
  color: #f56c6c;
  border-color: #fde2e2;
}
.v-tr-icon {
  font-size: 13px;
}
.v-tr-arrow {
  font-size: 12px;
  margin-left: 2px;
}
.v-tr-detail {
  margin-top: 6px;
  background: #f5f7fa;
  border-radius: 6px;
  padding: 8px 12px;
}
.v-tr-detail pre {
  margin: 0;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
  color: #606266;
  line-height: 1.5;
  font-family: inherit;
}
</style>
