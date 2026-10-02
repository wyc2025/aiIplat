<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { confirmDialog } from '@/utils/confirm'
import { formatTime } from '@/utils/format'
import {
  copyMarketApp,
  getMarketDetail,
  listMarket,
  type MarketCard,
  type MarketDetail,
} from '@/api/market'

/**
 * 应用中心 · 应用市场（P13 T121，PRD-P13 §8）：
 * 卡片流（名称/描述/发布者/表·页数/含演示标记/复制次数）+ 详情抽屉 + 「复制此应用」。
 * 仅登录用户可见（v1 无匿名浏览）；复制成功跳转新应用结构页。
 */
const router = useRouter()
const loading = ref(false)
const loadError = ref(false)
const list = ref<MarketCard[]>([])
const page = ref(1)
const pageSize = ref(12)
const total = ref(0)

const detail = reactive<{
  visible: boolean
  loading: boolean
  copying: boolean
  data: MarketDetail | null
  code: string
}>({ visible: false, loading: false, copying: false, data: null, code: '' })

async function load(): Promise<void> {
  loading.value = true
  loadError.value = false
  try {
    const result = await listMarket({ page: page.value, pageSize: pageSize.value })
    list.value = result.list
    total.value = result.total
  } catch {
    list.value = []
    total.value = 0
    loadError.value = true
  } finally {
    loading.value = false
  }
}

onMounted(load)

/** 时间文本（空值占位；formatTime 不接受 null） */
function timeText(value: string | null): string {
  return value ? formatTime(value) : '—'
}

function onPageChange(next: number): void {
  page.value = next
  void load()
}

async function openDetail(item: MarketCard): Promise<void> {
  detail.visible = true
  detail.code = item.code
  detail.data = null
  detail.loading = true
  try {
    detail.data = await getMarketDetail(item.code)
  } catch {
    // 请求层已提示（条目可能刚被下架：50014）
    detail.visible = false
  } finally {
    detail.loading = false
  }
}

/** 复制物化：成功后提示 + 跳转新应用结构页（PRD §8） */
async function doCopy(code: string): Promise<void> {
  const name = detail.data?.name ?? list.value.find((item) => item.code === code)?.name ?? code
  if (
    !(await confirmDialog(
      `复制「${name}」为我的新应用？将占用一个应用额度；副本从私有开始（结构与可选演示数据）。`,
      '复制应用',
    ))
  ) {
    return
  }
  detail.copying = true
  try {
    const result = await copyMarketApp(code)
    const skipped = result.skippedRows > 0 ? `（${result.skippedRows} 行演示数据因引用缺失被跳过）` : ''
    ElMessage.success(`已复制为新应用：${result.appCode}${skipped}`)
    detail.visible = false
    await load()
    void router.push({ path: '/app-center/schema', query: { appCode: result.appCode } })
  } catch {
    // 请求层已提示（配额满 50002 / 条目不可复制 50014）
  } finally {
    detail.copying = false
  }
}
</script>

<template>
  <div class="v-market">
    <div class="v-market__header">
      <div>
        <h3 class="v-market__title">
          应用市场
        </h3>
        <p class="v-market__desc">
          浏览他人通过审核上架的数据应用，一键复制为自己的应用（含结构与可选演示数据，副本默认不公开）。
        </p>
      </div>
    </div>

    <div
      v-loading="loading"
      class="v-market__body"
    >
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
        description="市场还没有上架的应用"
      />

      <div
        v-else
        class="v-market-grid"
      >
        <el-card
          v-for="item in list"
          :key="item.code"
          shadow="hover"
          class="v-market-card"
          @click="openDetail(item)"
        >
          <div class="v-market-card__head">
            <span class="v-market-card__name">{{ item.name }}</span>
            <el-tag
              v-if="item.hasDemo"
              type="warning"
              size="small"
            >
              含演示数据
            </el-tag>
          </div>
          <p class="v-market-card__desc">
            {{ item.description || '（无描述）' }}
          </p>
          <div class="v-market-card__meta">
            <span>发布者：{{ item.publisherName || '未知' }}</span>
            <span>表 {{ item.tableCount }} · 页 {{ item.pageCount }}</span>
            <span>已复制 {{ item.copyCount }} 次 · 上架：{{ timeText(item.listedAt) }}</span>
          </div>
          <div class="v-market-card__actions">
            <el-button
              size="small"
              type="primary"
              @click.stop="doCopy(item.code)"
            >
              复制此应用
            </el-button>
            <el-button
              size="small"
              @click.stop="openDetail(item)"
            >
              详情
            </el-button>
          </div>
        </el-card>
      </div>

      <div
        v-if="total > pageSize"
        class="v-market__pager"
      >
        <el-pagination
          :current-page="page"
          :page-size="pageSize"
          :total="total"
          layout="prev, pager, next, total"
          background
          @current-change="onPageChange"
        />
      </div>
    </div>

    <el-drawer
      v-model="detail.visible"
      :title="detail.data?.name || '条目详情'"
      size="480px"
    >
      <div v-loading="detail.loading">
        <template v-if="detail.data">
          <el-descriptions
            :column="1"
            border
            size="small"
          >
            <el-descriptions-item label="发布者">
              {{ detail.data.publisherName || '未知' }}
            </el-descriptions-item>
            <el-descriptions-item label="描述">
              {{ detail.data.description || '（无描述）' }}
            </el-descriptions-item>
            <el-descriptions-item label="规模">
              表 {{ detail.data.tableCount }} · 页 {{ detail.data.pageCount }}
            </el-descriptions-item>
            <el-descriptions-item label="演示数据">
              {{ detail.data.hasDemo ? '含演示数据（复制时一并写入）' : '仅结构（不含数据）' }}
            </el-descriptions-item>
            <el-descriptions-item label="复制次数">
              {{ detail.data.copyCount }}
            </el-descriptions-item>
            <el-descriptions-item label="上架时间">
              {{ timeText(detail.data.listedAt) }}
            </el-descriptions-item>
          </el-descriptions>

          <h4 class="v-market-detail__title">
            表结构
          </h4>
          <div class="v-market-detail__tags">
            <el-tag
              v-for="table in detail.data.tables"
              :key="table.name"
              size="small"
              class="v-market-detail__tag"
            >
              {{ table.label }}（{{ table.fieldCount }} 个字段）
            </el-tag>
            <span
              v-if="detail.data.tables.length === 0"
              class="v-market-detail__hint"
            >
              无逻辑表
            </span>
          </div>

          <h4 class="v-market-detail__title">
            功能页
          </h4>
          <div class="v-market-detail__tags">
            <el-tag
              v-for="item in detail.data.pages"
              :key="item.route"
              size="small"
              :type="item.kind === 'display' ? 'success' : 'info'"
              class="v-market-detail__tag"
            >
              {{ item.name }}（{{ item.kind === 'display' ? '展示页' : '管理页' }}）
            </el-tag>
            <span
              v-if="detail.data.pages.length === 0"
              class="v-market-detail__hint"
            >
              无功能页
            </span>
          </div>
        </template>
      </div>

      <template #footer>
        <el-button @click="detail.visible = false">
          关闭
        </el-button>
        <el-button
          type="primary"
          :loading="detail.copying"
          @click="doCopy(detail.code)"
        >
          复制此应用
        </el-button>
      </template>
    </el-drawer>
  </div>
</template>

<style scoped>
.v-market__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 16px;
}
.v-market__title {
  margin: 0 0 4px;
}
.v-market__desc {
  margin: 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.v-market__body {
  min-height: 200px;
}
.v-market-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}
.v-market-card {
  cursor: pointer;
}
.v-market-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.v-market-card__name {
  font-weight: 600;
}
.v-market-card__desc {
  margin: 8px 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  min-height: 20px;
}
.v-market-card__meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.v-market-card__actions {
  margin-top: 12px;
  display: flex;
  gap: 8px;
}
.v-market__pager {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
}
.v-market-detail__title {
  margin: 16px 0 8px;
  font-size: 14px;
}
.v-market-detail__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.v-market-detail__tag {
  margin: 0;
}
.v-market-detail__hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
