<script setup lang="ts">
/**
 * 只读渲染器（P14 T127：由 `PublicRenderer` 改造而来）。
 *
 * P14 D113：匿名公开面与 display 展示页整体退役（展示改由「展示应用 + 站点静态页」承担），
 * 本组件只剩一个用途——**页编辑器草稿预览**：按登录态 `POST /api/app/data/query` 直查数据、
 * 零写请求（不渲染 form、不执行动作、无行内动作按钮）。
 *
 * 只读子集：filterBar / table / detail 三区块；字段 DSL 与单元格展示逻辑与 AdminRenderer 同源
 * （`views/app/utils/schema.ts`）。详情区块在预览态无路由参数，显示空态（不请求）。
 */
import { computed, onMounted, reactive, watch } from 'vue'
import { queryData } from '@/api/app'
import type { DataRowView } from '@/types/api'
import { displayCell, parseFieldSpec } from '@/views/app/utils/schema'

/** 区块字段项（raw 保留原始 DSL 串供 displayCell 使用） */
interface FieldSpecItem {
  raw: string
  name: string
  modifier?: string
  target?: string
  multiple?: boolean
}

/** 区块（只读三型） */
interface ReadonlyBlock {
  type: 'filterBar' | 'table' | 'detail'
  bind: string
  title?: string
  fields?: string[]
  columns?: string[]
}

interface ReadonlyDataSource {
  op?: 'list' | 'get' | 'count'
  table?: string
  size?: number
  sort?: Array<{ f: string; dir: 'asc' | 'desc' }>
  fields?: string[]
}

interface ReadonlySchema {
  kind?: string
  layout?: ReadonlyBlock[]
  dataSources?: Record<string, ReadonlyDataSource>
}

const props = defineProps<{
  /** 取数应用（登录态直查：草稿 schema 与是否已保存无关） */
  appCode: string
  schema: Record<string, unknown>
}>()

const schema = computed<ReadonlySchema>(() => (props.schema ?? {}) as ReadonlySchema)
const blocks = computed<ReadonlyBlock[]>(() =>
  Array.isArray(schema.value.layout) ? (schema.value.layout as ReadonlyBlock[]) : [],
)

/** 数据源结果：rows 为列表，row 为单行（预览态恒空） */
const store = reactive<{
  rows: Record<string, DataRowView[]>
  row: Record<string, DataRowView | null>
  loading: Record<string, boolean>
  error: Record<string, string>
}>({ rows: {}, row: {}, loading: {}, error: {} })

/** 筛选条当前值（`字段:op` → 值） */
const filters = reactive<Record<string, string>>({})

function dsOf(block: ReadonlyBlock): ReadonlyDataSource {
  return schema.value.dataSources?.[block.bind] ?? {}
}

/** 详情区块：预览态无路由参数 → 直接空态（不发请求） */
function loadDetail(block: ReadonlyBlock): void {
  store.row[block.bind] = null
}

/** 列表取数（登录态 A 侧 DSL 直查；filter/sort/expand 由编辑器按区块配置传入） */
async function loadList(block: ReadonlyBlock): Promise<void> {
  const ds = dsOf(block)
  if (!ds.table) {
    store.rows[block.bind] = []
    return
  }
  store.loading[block.bind] = true
  try {
    const applied = Object.entries(filters)
      .filter(([, value]) => value !== '')
      .map(([key, value]) => `${key}:${value}`)
    const res = await queryData({
      appCode: props.appCode,
      op: 'list',
      table: ds.table,
      filter: applied.map((raw) => {
        const [f, op, ...rest] = raw.split(':')
        return { f, op: op as 'eq' | 'contains', v: rest.join(':') }
      }),
      sort: ds.sort,
      size: ds.size ?? 20,
      page: 1,
      expand: expandOf(block.bind).map((f) => ({ f })),
    })
    store.rows[block.bind] = (res.list ?? []) as unknown as DataRowView[]
  } catch (error) {
    store.error[block.bind] = error instanceof Error ? error.message : '数据加载失败'
    store.rows[block.bind] = []
  } finally {
    store.loading[block.bind] = false
  }
}

/** 从 table 块 columns 里挑 `:expand:目标` → expand 下推参数 */
function expandOf(bind: string): string[] {
  const block = blocks.value.find((item) => item.type === 'table' && item.bind === bind)
  const specs = block?.columns ?? []
  return specs
    .filter((spec) => parseFieldSpec(spec).modifier === 'expand')
    .map((spec) => parseFieldSpec(spec).name)
}

function fieldSpecs(block: ReadonlyBlock): FieldSpecItem[] {
  const list = block.type === 'table' ? (block.columns ?? []) : (block.fields ?? [])
  return list.map((item) => ({ raw: item, ...parseFieldSpec(item) }))
}

function cellValue(row: DataRowView, spec: string): string {
  return displayCell(row, spec, [])
}

async function loadAll(): Promise<void> {
  for (const block of blocks.value) {
    if (block.type === 'detail') loadDetail(block)
    else await loadList(block)
  }
}

function applyFilter(): void {
  for (const block of blocks.value) {
    if (block.type === 'filterBar') void loadList({ ...block, type: 'table', bind: block.bind })
  }
}

function resetFilter(): void {
  for (const key of Object.keys(filters)) filters[key] = ''
  applyFilter()
}

watch(() => props.schema, () => void loadAll())
onMounted(() => void loadAll())
</script>

<template>
  <div class="ro-renderer">
    <template
      v-for="(block, index) in blocks"
      :key="index"
    >
      <!-- 筛选条（只读：仅查询，无写入口） -->
      <el-card
        v-if="block.type === 'filterBar'"
        class="ro-block"
        shadow="never"
      >
        <div class="ro-filter">
          <div
            v-for="spec in fieldSpecs(block)"
            :key="spec.name"
            class="ro-filter__item"
          >
            <span class="ro-filter__label">{{ spec.name }}</span>
            <el-input
              v-model="filters[`${spec.name}:${spec.modifier ?? 'eq'}`]"
              :placeholder="spec.modifier === 'contains' ? '包含…' : '等于…'"
              clearable
              size="small"
              @keyup.enter="applyFilter"
            />
          </div>
          <el-button
            size="small"
            type="primary"
            @click="applyFilter"
          >
            查询
          </el-button>
          <el-button
            size="small"
            @click="resetFilter"
          >
            重置
          </el-button>
        </div>
      </el-card>

      <!-- 列表 -->
      <el-card
        v-else-if="block.type === 'table'"
        class="ro-block"
        shadow="never"
      >
        <div
          v-if="block.title"
          class="ro-block__title"
        >
          {{ block.title }}
        </div>
        <el-table
          v-loading="store.loading[block.bind]"
          :data="store.rows[block.bind] ?? []"
          :empty-text="store.error[block.bind] || '暂无数据'"
        >
          <el-table-column
            v-for="spec in fieldSpecs(block)"
            :key="spec.name"
            :label="spec.name"
            min-width="120"
          >
            <template #default="{ row }">
              {{ cellValue(row, spec.raw ?? spec.name) }}
            </template>
          </el-table-column>
        </el-table>
      </el-card>

      <!-- 详情 -->
      <el-card
        v-else-if="block.type === 'detail'"
        class="ro-block"
        shadow="never"
      >
        <div
          v-if="block.title"
          class="ro-block__title"
        >
          {{ block.title }}
        </div>
        <el-descriptions
          v-if="store.row[block.bind]"
          :column="1"
          border
        >
          <el-descriptions-item
            v-for="spec in fieldSpecs(block)"
            :key="spec.name"
            :label="spec.name"
          >
            {{ cellValue(store.row[block.bind] as DataRowView, spec.raw ?? spec.name) }}
          </el-descriptions-item>
        </el-descriptions>
        <el-empty
          v-else
          description="预览态不展示详情行（需真实路由参数）"
        />
      </el-card>
    </template>

    <el-empty
      v-if="blocks.length === 0"
      description="该页面没有可预览的区块"
    />
  </div>
</template>

<style scoped>
.ro-block {
  margin-bottom: 16px;
}

.ro-block__title {
  font-weight: 600;
  margin-bottom: 12px;
}

.ro-filter {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}

.ro-filter__item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ro-filter__label {
  font-size: 13px;
  color: var(--el-text-color-regular);
}
</style>
