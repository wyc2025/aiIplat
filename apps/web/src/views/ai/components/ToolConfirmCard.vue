<template>
  <div
    class="v-tool-confirm"
    :class="{ expired: isExpired }"
  >
    <div class="v-tc-header">
      <el-icon class="v-tc-icon">
        <Warning />
      </el-icon>
      <span class="v-tc-title">{{ title }}</span>
    </div>
    <div class="v-tc-summary">
      {{ summary }}
    </div>

    <!-- 待确认：确认/取消按钮 -->
    <div
      v-if="status === 'pending' && !isExpired"
      class="v-tc-actions"
    >
      <el-button
        type="primary"
        size="small"
        :loading="submitting"
        @click="handleConfirm(true)"
      >
        确认执行
      </el-button>
      <el-button
        size="small"
        :loading="submitting"
        @click="handleConfirm(false)"
      >
        取消
      </el-button>
    </div>

    <!-- 已处理/过期：固化状态 -->
    <div
      v-else
      class="v-tc-state"
    >
      <el-tag
        v-if="isExpired"
        type="info"
        size="small"
      >
        已过期
      </el-tag>
      <el-tag
        v-else-if="status === 'executed'"
        type="success"
        size="small"
      >
        已执行
      </el-tag>
      <el-tag
        v-else-if="status === 'rejected'"
        type="info"
        size="small"
      >
        已取消
      </el-tag>
      <el-tag
        v-else-if="status === 'failed'"
        type="danger"
        size="small"
      >
        执行失败
      </el-tag>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Warning } from '@element-plus/icons-vue'

const props = defineProps<{
  toolCallId: string
  title: string
  summary: string
  status: string
  /** 是否已过期（确认单 10 分钟失效） */
  expired?: boolean
}>()

const emit = defineEmits<{
  (e: 'confirm', approved: boolean): void
}>()

const submitting = ref(false)

const isExpired = computed(() => props.expired === true)

function handleConfirm(approved: boolean) {
  submitting.value = true
  emit('confirm', approved)
}
</script>

<style scoped>
.v-tool-confirm {
  border: 1px solid #e6a23c;
  background: #fdf6ec;
  border-radius: 8px;
  padding: 10px 14px;
  margin-top: 8px;
}
.v-tool-confirm.expired {
  border-color: #dcdfe6;
  background: #f5f7fa;
}
.v-tc-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
  color: #e6a23c;
}
.v-tc-icon {
  font-size: 16px;
}
.v-tc-summary {
  font-size: 13px;
  color: #606266;
  margin: 6px 0 10px;
  line-height: 1.5;
  word-break: break-word;
}
.v-tc-actions {
  display: flex;
  gap: 8px;
}
.v-tc-state {
  margin-top: 4px;
}
</style>
