<template>
  <div class="v-dashboard">
    <!-- 统计卡片（PRD F3：用户总数 / 角色总数 / 今日登录 / 今日操作） -->
    <div class="v-stats-grid">
      <div
        v-for="card in statCards"
        :key="card.title"
        v-loading="statsLoading"
        class="v-stat-card"
      >
        <el-icon
          :size="42"
          :color="card.color"
        >
          <component :is="card.icon" />
        </el-icon>
        <div class="v-stat-info">
          <div class="v-stat-value">
            {{ statsFailed ? '-' : card.value }}
          </div>
          <div class="v-stat-title">
            {{ card.title }}
          </div>
        </div>
      </div>
    </div>

    <!-- 近 7 天登录趋势折线图 -->
    <div class="v-panel">
      <div class="v-panel-title">
        近 7 天登录趋势
      </div>
      <div
        v-if="trendFailed"
        class="v-trend-error"
      >
        <span>趋势数据加载失败</span>
        <el-button
          type="primary"
          link
          @click="loadTrend"
        >
          重试
        </el-button>
      </div>
      <div
        v-show="!trendFailed"
        ref="chartRef"
        class="v-trend-chart"
      />
    </div>

    <!-- 快捷入口（按当前用户菜单权限过滤） -->
    <div class="v-panel">
      <div class="v-panel-title">
        快捷入口
      </div>
      <div class="v-shortcut-grid">
        <div
          v-for="item in shortcuts"
          :key="item.path"
          class="v-shortcut-card"
          @click="router.push(item.path)"
        >
          <el-icon
            :size="26"
            color="#409eff"
          >
            <component :is="item.icon" />
          </el-icon>
          <span class="v-shortcut-title">{{ item.title }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useEventListener } from '@vueuse/core'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { Avatar, DataLine, Tickets, User, UserFilled } from '@element-plus/icons-vue'
import { getDashboardStats, getLoginTrend, type DashboardStats, type TrendItem } from '@/api/system/dashboard'
import { usePermissionStore } from '@/stores/permission'
import type { MenuTreeNode } from '@/types/api'

// ECharts 按需注册（ARCHITECTURE 1.1）
echarts.use([LineChart, GridComponent, TooltipComponent, CanvasRenderer])

const router = useRouter()
const permissionStore = usePermissionStore()

// ========== 统计卡片 ==========
const statsLoading = ref(false)
const statsFailed = ref(false)
const stats = ref<DashboardStats | null>(null)

const statCards = computed(() => [
  { title: '用户总数', icon: User, color: '#409eff', value: stats.value?.userCount ?? 0 },
  { title: '角色总数', icon: Avatar, color: '#67c23a', value: stats.value?.roleCount ?? 0 },
  { title: '今日登录', icon: DataLine, color: '#e6a23c', value: stats.value?.todayLoginCount ?? 0 },
  { title: '今日操作', icon: Tickets, color: '#f56c6c', value: stats.value?.todayOperationCount ?? 0 },
])

async function loadStats() {
  statsLoading.value = true
  statsFailed.value = false
  try {
    stats.value = await getDashboardStats()
  } catch {
    // 错误提示已由 request 拦截器统一弹出
    statsFailed.value = true
  } finally {
    statsLoading.value = false
  }
}

// ========== 登录趋势折线图 ==========
const chartRef = ref<HTMLDivElement>()
const trendFailed = ref(false)
let chart: echarts.ECharts | null = null

async function loadTrend() {
  trendFailed.value = false
  try {
    const { list } = await getLoginTrend()
    renderChart(list)
  } catch {
    trendFailed.value = true
  }
}

function renderChart(list: TrendItem[]) {
  if (!chartRef.value) return
  if (!chart) chart = echarts.init(chartRef.value)
  chart.setOption({
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 24, top: 24, bottom: 32 },
    xAxis: { type: 'category', data: list.map((item) => item.date.slice(5)) },
    yAxis: { type: 'value', minInterval: 1 },
    series: [
      {
        name: '登录次数',
        type: 'line',
        smooth: true,
        symbolSize: 6,
        areaStyle: { opacity: 0.12 },
        data: list.map((item) => item.count),
      },
    ],
  })
}

// 窗口尺寸变化时自适应（useEventListener 自动随组件卸载解绑）
useEventListener(window, 'resize', () => chart?.resize())

// ========== 快捷入口（用户管理 / 角色管理 / 个人中心，按菜单权限过滤） ==========
const shortcuts = computed(() => {
  // 用户/角色管理按菜单权限过滤；个人中心为静态路由（PRD F11），所有登录用户可用
  const entries: Array<{
    title: string
    path: string
    icon: typeof User
    menuPath?: string
  }> = [
    { title: '用户管理', path: '/system/user', icon: User, menuPath: 'system/user' },
    { title: '角色管理', path: '/system/role', icon: Avatar, menuPath: 'system/role' },
    { title: '个人中心', path: '/profile', icon: UserFilled },
  ]
  return entries.filter(
    (entry) => !entry.menuPath || hasMenuPath(permissionStore.menus, entry.menuPath),
  )
})

/** 递归判断菜单树中是否存在指定 path 的菜单 */
function hasMenuPath(menus: MenuTreeNode[], path: string): boolean {
  return menus.some(
    (menu) => menu.path === path || (menu.children.length > 0 && hasMenuPath(menu.children, path)),
  )
}

onMounted(() => {
  void loadStats()
  void loadTrend()
})

onBeforeUnmount(() => {
  chart?.dispose()
  chart = null
})
</script>

<style scoped>
.v-stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 16px;
}
.v-stat-card {
  background: #fff;
  border-radius: 6px;
  padding: 20px;
  display: flex;
  align-items: center;
  gap: 16px;
}
.v-stat-value {
  font-size: 26px;
  font-weight: 600;
  color: #303133;
  line-height: 1.2;
}
.v-stat-title {
  font-size: 13px;
  color: #909399;
  margin-top: 4px;
}
.v-panel {
  background: #fff;
  border-radius: 6px;
  padding: 16px 20px;
  margin-bottom: 16px;
}
.v-panel-title {
  font-size: 15px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 12px;
}
.v-trend-chart {
  height: 320px;
}
.v-trend-error {
  height: 320px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #909399;
}
.v-shortcut-grid {
  display: grid;
  grid-template-columns: repeat(3, 200px);
  gap: 16px;
}
.v-shortcut-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  cursor: pointer;
  transition: border-color 0.2s;
}
.v-shortcut-card:hover {
  border-color: #409eff;
}
.v-shortcut-title {
  font-size: 14px;
  color: #303133;
}
</style>
