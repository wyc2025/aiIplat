<template>
  <div class="v-usage-page">
    <!-- 顶部：当前套餐卡片 -->
    <el-card class="v-plan-card">
      <div
        v-if="myPlan.plan"
        class="v-plan-inner"
      >
        <div class="v-plan-left">
          <div class="v-plan-name">
            {{ myPlan.plan.name }}
          </div>
          <div class="v-plan-cycle">
            重置日期：{{ formatDate(myPlan.cycleEnd) }}
          </div>
        </div>
        <div class="v-plan-stats">
          <div class="v-stat">
            <div class="v-stat-num">
              {{ myPlan.totalCredits }}
            </div>
            <div class="v-stat-label">
              本期总额度
            </div>
          </div>
          <div class="v-stat">
            <div class="v-stat-num v-used">
              {{ myPlan.usedCredits }}
            </div>
            <div class="v-stat-label">
              已用
            </div>
          </div>
          <div class="v-stat">
            <div class="v-stat-num v-remain">
              {{ myPlan.remainingCredits }}
            </div>
            <div class="v-stat-label">
              剩余
            </div>
          </div>
        </div>
        <el-progress
          :percentage="usedPercent"
          :stroke-width="10"
          class="v-progress"
        />
      </div>
      <el-empty
        v-else
        description="尚未开通套餐"
      >
        <el-button
          type="primary"
          @click="goPlan"
        >
          前往开通
        </el-button>
      </el-empty>
    </el-card>

    <!-- 下方：用量明细表 -->
    <ProTable
      :data="list"
      :loading="loading"
      :load-error="loadError"
      :total="total"
      :page-no="pageNo"
      :page-size="pageSize"
      @search="search"
      @reset="reset"
      @retry="load"
      @page-change="handlePageChange"
      @size-change="handleSizeChange"
    >
      <template #search>
        <el-form-item label="模型">
          <el-select
            v-model="query.modelId"
            placeholder="全部模型"
            clearable
            style="width: 220px"
          >
            <el-option
              v-for="m in modelOptions"
              :key="m.id"
              :label="m.displayName"
              :value="Number(m.id)"
            />
          </el-select>
        </el-form-item>
      </template>

      <el-table-column
        prop="createdAt"
        label="时间"
        width="180"
      >
        <template #default="{ row }">
          {{ formatTime(row.createdAt) }}
        </template>
      </el-table-column>
      <el-table-column
        prop="modelDisplayName"
        label="模型"
        width="160"
      />
      <el-table-column
        prop="conversationTitle"
        label="会话"
        min-width="200"
        show-overflow-tooltip
      />
      <el-table-column
        prop="tokensInput"
        label="输入量"
        width="110"
        align="right"
      />
      <el-table-column
        prop="tokensOutput"
        label="输出量"
        width="110"
        align="right"
      />
      <el-table-column
        prop="credits"
        label="扣减积分"
        width="100"
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
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import dayjs from 'dayjs'
import ProTable from '@/components/ProTable/index.vue'
import { getMyPlan, type MyPlanResult } from '@/api/ai/plan'
import { getMyUsage, type MyUsageItem } from '@/api/ai/usage'
import { getModels, type AvailableModel } from '@/api/ai/chat'
import { useTable } from '@/hooks/useTable'

const router = useRouter()

const myPlan = ref<MyPlanResult>({ plan: null, cycleStart: null, cycleEnd: null, totalCredits: '0', usedCredits: '0', remainingCredits: '0' })
const modelOptions = ref<AvailableModel[]>([])

const { loading, list, total, pageNo, pageSize, loadError, query, load, search, reset, handlePageChange, handleSizeChange } =
  useTable<MyUsageItem, { modelId?: number }>({
    fetchApi: getMyUsage,
    query: { modelId: undefined },
  })

const usedPercent = computed(() => {
  const total = Number(myPlan.value.totalCredits)
  if (!total) return 0
  return Math.min(100, Math.round((Number(myPlan.value.usedCredits) / total) * 100))
})

onMounted(async () => {
  await Promise.all([loadMyPlan(), loadModels()])
})

async function loadMyPlan() {
  try {
    myPlan.value = await getMyPlan()
  } catch {
    // 错误提示由 request 统一处理
  }
}

async function loadModels() {
  try {
    modelOptions.value = await getModels()
  } catch {
    modelOptions.value = []
  }
}

function goPlan() {
  router.push('/ai/plan')
}

function formatDate(t: string | null) {
  return t ? dayjs(t).format('YYYY-MM-DD') : '—'
}

function formatTime(t: string) {
  return dayjs(t).format('YYYY-MM-DD HH:mm:ss')
}
</script>

<style scoped>
.v-usage-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.v-plan-card {
  background: #fff;
}
.v-plan-inner {
  display: flex;
  align-items: center;
  gap: 40px;
}
.v-plan-left {
  flex-shrink: 0;
}
.v-plan-name {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
}
.v-plan-cycle {
  font-size: 13px;
  color: #909399;
  margin-top: 6px;
}
.v-plan-stats {
  display: flex;
  gap: 40px;
}
.v-stat-num {
  font-size: 22px;
  font-weight: 600;
  color: #303133;
}
.v-stat-num.v-used {
  color: #e6a23c;
}
.v-stat-num.v-remain {
  color: #67c23a;
}
.v-stat-label {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
}
.v-progress {
  flex: 1;
  max-width: 360px;
}
.v-credits {
  color: #f56c6c;
  font-weight: 600;
}
</style>
