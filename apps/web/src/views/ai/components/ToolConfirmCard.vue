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
    <div
      v-if="listSummary"
      class="v-tc-summary"
    >
      <div
        v-if="siteLabel"
        class="v-tc-site"
      >
        目标站点：{{ siteLabel }}
      </div>
      <el-table
        :data="listSummary"
        size="small"
        class="v-tc-table"
      >
        <el-table-column
          prop="path"
          label="文件"
          min-width="180"
          show-overflow-tooltip
        />
        <el-table-column
          label="动作"
          width="76"
        >
          <template #default="{ row }">
            <el-tag
              :type="row.action === 'overwritten' ? 'warning' : 'success'"
              size="small"
            >
              {{ row.action === 'overwritten' ? '覆盖' : '新建' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column
          label="大小"
          width="86"
        >
          <template #default="{ row }">
            {{ formatSize(row.size ?? 0) }}
          </template>
        </el-table-column>
      </el-table>
      <div class="v-tc-estimate">
        动作为预估，以执行结果为准
      </div>
    </div>
    <div
      v-else
      class="v-tc-summary"
    >
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
import type { ToolSummaryItem } from '@/api/ai/chat'
import { formatSize } from '@/utils/format'

const props = defineProps<{
  toolCallId: string
  title: string
  /** P2b 字符串摘要 / P4b T42 结构化文件清单 */
  summary: string | ToolSummaryItem[]
  status: string
  /** 是否已过期（确认单 10 分钟失效） */
  expired?: boolean
}>()

const emit = defineEmits<{
  (e: 'confirm', approved: boolean): void
}>()

const submitting = ref(false)

const isExpired = computed(() => props.expired === true)

/** 结构化摘要（数组）→ 渲染文件清单表格；字符串摘要维持 P2b 文本渲染 */
const listSummary = computed(() => (Array.isArray(props.summary) ? props.summary : null))

/** P4E T62：目标站点标识（多站 write_site_files 确认卡明示写入站点；缺省不渲染） */
const siteLabel = computed(() => {
  const site = listSummary.value?.[0]?.site
  return site ? `${site.title}（${site.slug}）` : ''
})

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
.v-tc-table {
  width: 100%;
}
.v-tc-site {
  margin-bottom: 6px;
  font-size: 13px;
  color: #606266;
}
.v-tc-estimate {
  margin-top: 4px;
  font-size: 12px;
  color: #909399;
}
.v-tc-actions {
  display: flex;
  gap: 8px;
}
.v-tc-state {
  margin-top: 4px;
}
</style>
