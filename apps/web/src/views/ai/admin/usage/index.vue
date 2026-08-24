<template>
  <div class="v-admin-usage">
    <!-- 顶部：汇总卡片 -->
    <div class="v-summary-cards">
      <el-card class="v-summary-card">
        <div class="v-summary-num">
          {{ summary.totalTokensInput }}
        </div>
        <div class="v-summary-label">
          总输入 tokens
        </div>
      </el-card>
      <el-card class="v-summary-card">
        <div class="v-summary-num">
          {{ summary.totalTokensOutput }}
        </div>
        <div class="v-summary-label">
          总输出 tokens
        </div>
      </el-card>
      <el-card class="v-summary-card">
        <div class="v-summary-num v-credits">
          {{ summary.totalCredits }}
        </div>
        <div class="v-summary-label">
          总扣减积分
        </div>
      </el-card>
    </div>

    <!-- 用量明细表 -->
    <ProTable
      :data="list"
      :loading="loading"
      :load-error="loadError"
      :total="total"
      :page-no="pageNo"
      :page-size="pageSize"
      @search="handleSearch"
      @reset="reset"
      @retry="load"
      @page-change="handlePageChange"
      @size-change="handleSizeChange"
    >
      <template #search>
        <el-form-item label="用户名">
          <el-input
            v-model="query.username"
            placeholder="请输入用户名"
            clearable
            style="width: 160px"
          />
        </el-form-item>
        <el-form-item label="模型">
          <el-select
            v-model="query.modelId"
            placeholder="全部模型"
            clearable
            style="width: 180px"
          >
            <el-option
              v-for="m in modelOptions"
              :key="m.id"
              :label="m.displayName"
              :value="Number(m.id)"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="时间范围">
          <el-date-picker
            v-model="dateRange"
            type="daterange"
            value-format="YYYY-MM-DD"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            style="width: 240px"
          />
        </el-form-item>
      </template>

      <el-table-column
        prop="createdAt"
        label="时间"
        width="170"
      >
        <template #default="{ row }">
          {{ formatTime(row.createdAt) }}
        </template>
      </el-table-column>
      <el-table-column
        prop="username"
        label="用户"
        width="120"
      />
      <el-table-column
        prop="modelDisplayName"
        label="模型"
        width="150"
        show-overflow-tooltip
      />
      <el-table-column
        prop="conversationTitle"
        label="会话"
        min-width="180"
        show-overflow-tooltip
      />
      <el-table-column
        prop="tokensInput"
        label="输入 tokens"
        width="110"
        align="right"
      />
      <el-table-column
        prop="tokensOutput"
        label="输出 tokens"
        width="110"
        align="right"
      />
      <el-table-column
        prop="credits"
        label="积分"
        width="90"
        align="right"
      >
        <template #default="{ row }">
          <span class="v-credits">-{{ row.credits }}</span>
        </template>
      </el-table-column>
    </ProTable>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import dayjs from 'dayjs'
import ProTable from '@/components/ProTable/index.vue'
import { getAdminUsage, type AdminUsageItem, type UsageSummary } from '@/api/ai/usage'
import { getModels, type AvailableModel } from '@/api/ai/chat'
import { useTable } from '@/hooks/useTable'

const modelOptions = ref<AvailableModel[]>([])
const dateRange = ref<[string, string] | null>(null)
const summary = ref<UsageSummary>({ totalTokensInput: 0, totalTokensOutput: 0, totalCredits: 0 })

const { loading, list, total, pageNo, pageSize, loadError, query, load, search, reset, handlePageChange, handleSizeChange } =
  useTable<AdminUsageItem, { username?: string; modelId?: number; startTime?: string; endTime?: string }>({
    fetchApi: async (params) => {
      const result = await getAdminUsage(params)
      summary.value = result.summary
      return result
    },
    query: { username: undefined, modelId: undefined, startTime: undefined, endTime: undefined },
  })

onMounted(async () => {
  try {
    modelOptions.value = await getModels()
  } catch {
    modelOptions.value = []
  }
})

function handleSearch() {
  query.startTime = dateRange.value?.[0] ? dayjs(dateRange.value[0]).startOf('day').toISOString() : undefined
  query.endTime = dateRange.value?.[1] ? dayjs(dateRange.value[1]).endOf('day').toISOString() : undefined
  search()
}

function formatTime(t: string) {
  return dayjs(t).format('YYYY-MM-DD HH:mm:ss')
}
</script>

<style scoped>
.v-admin-usage {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.v-summary-cards {
  display: flex;
  gap: 16px;
}
.v-summary-card {
  flex: 1;
  background: #fff;
}
.v-summary-num {
  font-size: 26px;
  font-weight: 600;
  color: #303133;
}
.v-summary-num.v-credits {
  color: #f56c6c;
}
.v-summary-label {
  font-size: 13px;
  color: #909399;
  margin-top: 6px;
}
.v-credits {
  color: #f56c6c;
  font-weight: 600;
}
</style>
