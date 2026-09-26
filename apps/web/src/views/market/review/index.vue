<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
// ElMessageBox.prompt 为 JS 调用（非模板组件），需显式引入样式（含遮罩层 overlay）
import 'element-plus/es/components/message-box/style/css'
import 'element-plus/es/components/overlay/style/css'
import { confirmDialog } from '@/utils/confirm'
import { formatTime } from '@/utils/format'
import { listReviewListings, reviewListing, type ReviewItem } from '@/api/market'

/**
 * 应用中心 · 市场审核（P13 T119/T121，market:review，PRD §8）：
 * 待审列表（快照摘要）→ 通过 / 拒绝（必填理由）；在架列表 → 下架。
 * 审核是人的事：AI 永不代审核（PRD §9）。
 */
const activeTab = ref<'pending' | 'approved'>('pending')
const loading = ref(false)
const loadError = ref(false)
const actioning = ref('')
const list = ref<ReviewItem[]>([])

async function load(): Promise<void> {
  loading.value = true
  loadError.value = false
  try {
    list.value = await listReviewListings(activeTab.value)
  } catch {
    list.value = []
    loadError.value = true
  } finally {
    loading.value = false
  }
}

onMounted(load)

function onTabChange(): void {
  list.value = []
  void load()
}

async function approve(item: ReviewItem): Promise<void> {
  if (
    !(await confirmDialog(
      `通过「${item.name}」并上架市场？上架后所有登录用户可见并可复制（副本仅含结构与可选演示数据）。`,
      '通过审核',
    ))
  ) {
    return
  }
  await run(item, 'approve')
}

async function reject(item: ReviewItem): Promise<void> {
  const note = await promptNote(item)
  if (note === null) return
  await run(item, 'reject', note)
}

async function delist(item: ReviewItem): Promise<void> {
  if (
    !(await confirmDialog(
      `下架「${item.name}」？下架后市场不再可见、不可复制；该应用之后可重新提交为新条目。`,
      '下架条目',
      { type: 'warning' },
    ))
  ) {
    return
  }
  await run(item, 'delist')
}

/** 拒绝理由（必填，≤500 字）；取消返回 null */
async function promptNote(item: ReviewItem): Promise<string | null> {
  try {
    const result = await ElMessageBox.prompt(
      `拒绝「${item.name}」的理由（将展示给发布者）：`,
      '拒绝上架',
      {
        inputType: 'textarea',
        inputPlaceholder: '请说明未通过的原因',
        inputValidator: (value: string) => {
          const text = (value ?? '').trim()
          if (!text) return '拒绝必须填写理由'
          if (text.length > 500) return '理由不能超过 500 字'
          return true
        },
      },
    )
    return result.value.trim()
  } catch {
    return null
  }
}

/** 快照摘要渲染（模板内不做类型标注，收敛到函数） */
function summaryLabels(tables: Array<{ label: string }>): string {
  return tables.map((item) => item.label).join('、')
}

function summaryNames(pages: Array<{ name: string }>): string {
  return pages.map((item) => item.name).join('、')
}

async function run(item: ReviewItem, action: 'approve' | 'reject' | 'delist', note?: string): Promise<void> {
  actioning.value = item.id
  try {
    await reviewListing(item.id, { action, note })
    ElMessage.success(action === 'approve' ? '已通过并上架' : action === 'reject' ? '已拒绝' : '已下架')
    await load()
  } catch {
    // 请求层已提示（40001 状态不可执行等）
  } finally {
    actioning.value = ''
  }
}
</script>

<template>
  <div class="v-market-review">
    <div class="v-market-review__header">
      <h3 class="v-market-review__title">
        市场审核
      </h3>
      <p class="v-market-review__desc">
        审核他人提交的数据应用（提交即冻结结构快照，审核只针对快照）；拒绝必须填写理由。
      </p>
    </div>

    <el-tabs
      v-model="activeTab"
      @tab-change="onTabChange"
    >
      <el-tab-pane
        label="待审"
        name="pending"
      />
      <el-tab-pane
        label="在架"
        name="approved"
      />
    </el-tabs>

    <div v-loading="loading">
      <el-result
        v-if="loadError"
        icon="error"
        title="加载失败"
        sub-title="请稍后重试"
      >
        <template #extra>
          <el-button
            type="primary"
            @click="load"
          >
            重试
          </el-button>
        </template>
      </el-result>

      <el-empty
        v-else-if="list.length === 0 && !loading"
        :description="activeTab === 'pending' ? '没有待审条目' : '没有在架条目'"
      />

      <el-table
        v-else
        :data="list"
        border
        row-key="id"
        class="v-market-review__table"
      >
        <el-table-column
          prop="name"
          label="应用"
          min-width="160"
        >
          <template #default="{ row }">
            <div class="v-market-review__name">
              {{ row.name }}
            </div>
            <div class="v-market-review__sub">
              {{ row.code }}
            </div>
          </template>
        </el-table-column>
        <el-table-column
          prop="publisherName"
          label="发布者"
          width="130"
        />
        <el-table-column
          label="快照摘要"
          min-width="240"
        >
          <template #default="{ row }">
            <div class="v-market-review__sub">
              表 {{ row.tableCount }} · 页 {{ row.pageCount }}
              <el-tag
                v-if="row.hasDemo"
                type="warning"
                size="small"
                class="v-market-review__tag"
              >
                含演示数据
              </el-tag>
            </div>
            <div class="v-market-review__sub">
              表：{{ summaryLabels(row.tables) || '无' }}
            </div>
            <div class="v-market-review__sub">
              页：{{ summaryNames(row.pages) || '无' }}
            </div>
          </template>
        </el-table-column>
        <el-table-column
          label="时间"
          width="170"
        >
          <template #default="{ row }">
            <div class="v-market-review__sub">
              {{ activeTab === 'pending' ? '提交：' : '上架：' }}{{ formatTime(row.listedAt ?? row.createdAt) }}
            </div>
          </template>
        </el-table-column>
        <el-table-column
          label="操作"
          width="180"
          fixed="right"
        >
          <template #default="{ row }">
            <template v-if="activeTab === 'pending'">
              <el-button
                size="small"
                type="success"
                :loading="actioning === row.id"
                @click="approve(row)"
              >
                通过
              </el-button>
              <el-button
                size="small"
                type="danger"
                plain
                :loading="actioning === row.id"
                @click="reject(row)"
              >
                拒绝
              </el-button>
            </template>
            <el-button
              v-else
              size="small"
              type="danger"
              plain
              :loading="actioning === row.id"
              @click="delist(row)"
            >
              下架
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<style scoped>
.v-market-review__header {
  margin-bottom: 8px;
}
.v-market-review__title {
  margin: 0 0 4px;
}
.v-market-review__desc {
  margin: 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.v-market-review__table {
  width: 100%;
}
.v-market-review__name {
  font-weight: 600;
}
.v-market-review__sub {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.v-market-review__tag {
  margin-left: 6px;
}
</style>
