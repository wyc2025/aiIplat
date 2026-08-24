<template>
  <div class="v-plan-page">
    <!-- 当前套餐卡片 -->
    <el-card
      v-if="myPlan.plan"
      class="v-current-card"
    >
      <div class="v-current-inner">
        <div class="v-current-main">
          <div class="v-current-title">
            当前套餐：<span class="v-plan-name">{{ myPlan.plan.name }}</span>
          </div>
          <div class="v-current-desc">
            周期 {{ formatDate(myPlan.cycleStart) }} ~ {{ formatDate(myPlan.cycleEnd) }}
          </div>
        </div>
        <div class="v-current-stats">
          <div class="v-stat-item">
            <div class="v-stat-value">
              {{ myPlan.totalCredits }}
            </div>
            <div class="v-stat-label">
              本期额度
            </div>
          </div>
          <div class="v-stat-item">
            <div class="v-stat-value v-used">
              {{ myPlan.usedCredits }}
            </div>
            <div class="v-stat-label">
              已用积分
            </div>
          </div>
          <div class="v-stat-item">
            <div class="v-stat-value v-remain">
              {{ myPlan.remainingCredits }}
            </div>
            <div class="v-stat-label">
              剩余积分
            </div>
          </div>
        </div>
        <el-progress
          :percentage="usedPercent"
          :stroke-width="10"
          class="v-current-progress"
        />
      </div>
    </el-card>

    <!-- 套餐卡片网格 -->
    <div class="v-plan-grid">
      <el-card
        v-for="p in planList"
        :key="p.id"
        class="v-plan-card"
        :class="{ current: myPlan.plan?.id === p.id }"
      >
        <div class="v-plan-card-header">
          <span class="v-plan-card-name">{{ p.name }}</span>
          <el-tag
            v-if="myPlan.plan?.id === p.id"
            type="success"
            size="small"
          >
            当前套餐
          </el-tag>
        </div>
        <div class="v-plan-card-credits">
          {{ p.monthlyCredits }} <span class="v-credits-unit">积分/月</span>
        </div>
        <div class="v-plan-card-price">
          <template v-if="Number(p.price) > 0">
            <span class="v-price-value">¥{{ p.price }}</span>
            <span class="v-price-unit">/月</span>
          </template>
          <span
            v-else
            class="v-price-free"
          >免费</span>
        </div>
        <div class="v-plan-card-desc">
          {{ p.description || '—' }}
        </div>
        <el-button
          v-if="myPlan.plan?.id !== p.id"
          type="primary"
          style="width: 100%"
          :loading="submitting === p.id"
          @click="handleSubscribe(p)"
        >
          {{ myPlan.plan ? '切换至此套餐' : '立即开通' }}
        </el-button>
      </el-card>
      <el-empty
        v-if="!planList.length"
        description="暂无可用套餐"
        style="width: 100%"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import dayjs from 'dayjs'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getMyPlan, getPlanList, subscribePlan, type MyPlanResult, type PlanInfo } from '@/api/ai/plan'

const planList = ref<PlanInfo[]>([])
const myPlan = ref<MyPlanResult>({ plan: null, cycleStart: null, cycleEnd: null, totalCredits: '0', usedCredits: '0', remainingCredits: '0' })
const submitting = ref<string | null>(null)

const usedPercent = computed(() => {
  const total = Number(myPlan.value.totalCredits)
  if (!total) return 0
  return Math.min(100, Math.round((Number(myPlan.value.usedCredits) / total) * 100))
})

onMounted(async () => {
  await Promise.all([loadPlans(), loadMyPlan()])
})

async function loadPlans() {
  try {
    planList.value = await getPlanList()
  } catch {
    planList.value = []
  }
}

async function loadMyPlan() {
  try {
    myPlan.value = await getMyPlan()
  } catch {
    // 错误提示由 request 统一处理
  }
}

async function handleSubscribe(p: PlanInfo) {
  const action = myPlan.value.plan ? '切换' : '开通'
  await ElMessageBox.confirm(
    `确认${action}套餐「${p.name}」吗？${action}后立即生效并重新计算周期，本周期额度将被重置。`,
    `${action}套餐`,
    { type: 'warning', confirmButtonText: `确认${action}`, cancelButtonText: '取消' },
  )
  submitting.value = p.id
  try {
    await subscribePlan({ planId: Number(p.id) })
    ElMessage.success(`${action}成功`)
    await loadMyPlan()
  } finally {
    submitting.value = null
  }
}

function formatDate(t: string | null) {
  return t ? dayjs(t).format('YYYY-MM-DD') : '—'
}
</script>

<style scoped>
.v-plan-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.v-current-card {
  background: #fff;
}
.v-current-inner {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.v-current-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.v-current-title {
  font-size: 15px;
  color: #303133;
}
.v-plan-name {
  font-weight: 600;
  color: #409eff;
}
.v-current-desc {
  font-size: 13px;
  color: #909399;
}
.v-current-stats {
  display: flex;
  gap: 48px;
}
.v-stat-value {
  font-size: 24px;
  font-weight: 600;
  color: #303133;
}
.v-stat-value.v-used {
  color: #e6a23c;
}
.v-stat-value.v-remain {
  color: #67c23a;
}
.v-stat-label {
  font-size: 12px;
  color: #909399;
  margin-top: 4px;
}
.v-current-progress {
  max-width: 480px;
}

.v-plan-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 16px;
}
.v-plan-card {
  border: 2px solid transparent;
  transition: border-color 0.2s;
}
.v-plan-card.current {
  border-color: #67c23a;
}
.v-plan-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.v-plan-card-name {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
}
.v-plan-card-credits {
  font-size: 26px;
  font-weight: 700;
  color: #409eff;
  margin-bottom: 8px;
}
.v-credits-unit {
  font-size: 13px;
  font-weight: 400;
  color: #909399;
}
.v-plan-card-price {
  margin-bottom: 12px;
  min-height: 22px;
}
.v-price-value {
  font-size: 20px;
  font-weight: 600;
  color: #f56c6c;
}
.v-price-unit {
  font-size: 13px;
  color: #909399;
}
.v-price-free {
  font-size: 15px;
  color: #67c23a;
  font-weight: 600;
}
.v-plan-card-desc {
  font-size: 13px;
  color: #606266;
  min-height: 40px;
  margin-bottom: 14px;
  line-height: 1.6;
}
</style>
