<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="v-uq"
    >
      <div class="v-uq-head">
        <span class="v-uq-title">
          上传队列
          <span
            v-if="hasActive"
            class="v-uq-summary"
          >进行中…</span>
          <span
            v-else
            class="v-uq-summary"
          >成功 {{ successCount }} / 失败 {{ failCount }}</span>
        </span>
        <span class="v-uq-actions">
          <el-button
            v-if="!hasActive && items.length > 0"
            link
            size="small"
            @click="$emit('clear')"
          >
            清空
          </el-button>
          <el-button
            v-if="!hasActive"
            link
            size="small"
            @click="$emit('close')"
          >
            收起
          </el-button>
        </span>
      </div>
      <el-progress
        :percentage="totalPercent"
        :stroke-width="8"
        :status="!hasActive && failCount > 0 ? 'exception' : !hasActive ? 'success' : undefined"
      />
      <div class="v-uq-list">
        <div
          v-for="item in items"
          :key="item.key"
          class="v-uq-item"
        >
          <div class="v-uq-item-main">
            <span
              class="v-uq-name"
              :title="item.name"
            >{{ item.name }}</span>
            <span
              v-if="item.status === 'success' && item.finalName && item.finalName !== item.name"
              class="v-uq-final"
              :title="`最终保存为「${item.finalName}」`"
            >已存为 {{ item.finalName }}</span>
          </div>
          <div class="v-uq-item-side">
            <!-- 状态列：等待中 / 上传中 x% / 已完成 / 失败原因 -->
            <el-tag
              v-if="item.status === 'success'"
              type="success"
              size="small"
            >
              已完成
            </el-tag>
            <el-tooltip
              v-else-if="item.status === 'failed'"
              :content="item.error"
              placement="left"
            >
              <span class="v-uq-error">{{ item.error || '上传失败' }}</span>
            </el-tooltip>
            <span
              v-else-if="item.status === 'uploading'"
              class="v-uq-uploading"
            >上传中 {{ item.percent }}%</span>
            <span
              v-else
              class="v-uq-pending"
            >等待中</span>
          </div>
          <el-progress
            v-if="item.status === 'uploading'"
            :percentage="item.percent"
            :show-text="false"
            :stroke-width="4"
            class="v-uq-bar"
          />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import type { UploadQueueItem } from './useUploadQueue'

defineProps<{
  visible: boolean
  items: UploadQueueItem[]
  hasActive: boolean
  successCount: number
  failCount: number
  totalPercent: number
}>()

defineEmits<{
  clear: []
  close: []
}>()
</script>

<style scoped>
.v-uq {
  position: fixed;
  right: 24px;
  bottom: 24px;
  width: 380px;
  max-width: calc(100vw - 48px);
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.15);
  padding: 12px 14px;
  z-index: 2000;
}
.v-uq-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.v-uq-title {
  font-size: 14px;
  font-weight: 600;
}
.v-uq-summary {
  font-weight: 400;
  color: #909399;
  font-size: 12px;
  margin-left: 8px;
}
.v-uq-list {
  max-height: 300px;
  overflow: auto;
  margin-top: 8px;
}
.v-uq-item {
  padding: 6px 0;
  border-bottom: 1px solid #f0f2f5;
}
.v-uq-item:last-child {
  border-bottom: none;
}
.v-uq-item-main {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}
.v-uq-name {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.v-uq-final {
  font-size: 12px;
  color: #67c23a;
  flex-shrink: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.v-uq-item-side {
  display: flex;
  justify-content: flex-end;
  margin-top: 2px;
}
.v-uq-uploading {
  font-size: 12px;
  color: #409eff;
}
.v-uq-pending {
  font-size: 12px;
  color: #c0c4cc;
}
.v-uq-error {
  font-size: 12px;
  color: #f56c6c;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 300px;
  cursor: default;
}
.v-uq-bar {
  margin-top: 4px;
}
</style>
