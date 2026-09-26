<script setup lang="ts">
/**
 * 公开展示页渲染器（P12 T113，D102 / ARCHITECTURE §28.5）。
 *
 * 只读子集：filterBar / table / detail 三区块（无 form、无行内动作），
 * 取数走免登录公开端点（api/app/pub.ts），字段 DSL / 枚举 label / expand 展示逻辑与
 * AdminRenderer 同源（views/app/utils/schema.ts），差异仅在数据来源与只读约束。
 */
import { computed, onMounted, reactive, watch } from 'vue'
import { queryData } from '@/api/app'
import { pubAppDataDetail, pubAppDataList, pubAppFileUrl } from '@/api/app/pub'
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

/** 区块（display 三型） */
interface DisplayBlock {
  type: 'filterBar' | 'table' | 'detail'
  bind: string
  title?: string
  fields?: string[]
  columns?: string[]
  rowLink?: { page: string; rowIdParam?: string }
}

interface DisplayDataSource {
  op?: 'list' | 'get'
  table?: string
  size?: number
  sort?: Array<{ f: string; dir: 'asc' | 'desc' }>
  fields?: string[]
}

interface DisplaySchema {
  kind?: string
  layout?: DisplayBlock[]
  dataSources?: Record<string, DisplayDataSource>
}

const props = defineProps<{
  pubCode: string
  schema: Record<string, unknown>
  /** 详情页传入的 route query（rowIdParam 取值来源） */
  routeQuery?: Record<string, unknown>
  /** 详情行参数名（默认 rowId；由宿主按列表页 rowLink.rowIdParam 传入） */
  rowIdParam?: string
  /**
   * 预览取数（P12 T115，R113/PRD-PATCH1 §4）：给定时改走 **A 侧登录态** `POST /api/app/data/query`
   * （草稿 schema 直查，与是否已保存/已公开无关），只读、不产生任何写请求；不传则走公开端点。
   */
  previewAppCode?: string
  /** 列表行点击 → 跳详情（宿主负责路由跳转） */
  onRowClick?: (row: DataRowView, rowLink: { page: string; rowIdParam?: string }) => void
}>()

const schema = computed<DisplaySchema>(() => (props.schema ?? {}) as DisplaySchema)
const blocks = computed<DisplayBlock[]>(() =>
  Array.isArray(schema.value.layout) ? (schema.value.layout as DisplayBlock[]) : [],
)

/** 数据源结果：rows 为列表，row 为单行 */
const store = reactive<{
  rows: Record<string, DataRowView[]>
  row: Record<string, DataRowView | null>
  loading: Record<string, boolean>
  error: Record<string, string>
}>({ rows: {}, row: {}, loading: {}, error: {} })

/** 筛选条当前值（`字段:op` → 值） */
const filters = reactive<Record<string, string>>({})

const rowIdParam = (): string => props.rowIdParam ?? 'rowId'

/**
 * 公开端点返回的是**平铺投影**（暴露字段直接在顶层，expand 结果在 `expanded`，API §19.2）；
 * 而渲染器与 `displayCell` 按 `DataRowView`（`row.data` / `row.expanded`）消费
 * → 此处归一（P13 T122 浏览器匿名取证发现：未归一则 `displayCell` 读 `row.data.name` 直接抛错、表格空白）。
 */
function toRowView(item: Record<string, unknown>): DataRowView {
  const { rowId, createdAt, updatedAt, expanded, ...rest } = item
  return {
    rowId: rowId === undefined || rowId === null ? '' : String(rowId),
    data: rest,
    createdAt: createdAt === undefined || createdAt === null ? '' : String(createdAt),
    updatedAt: updatedAt === undefined || updatedAt === null ? '' : String(updatedAt),
    ...(expanded && typeof expanded === 'object'
      ? { expanded: expanded as Record<string, unknown> }
      : {}),
  }
}

function dsOf(block: DisplayBlock): DisplayDataSource {
  return schema.value.dataSources?.[block.bind] ?? {}
}

/** 单行详情取数（rowId 来自路由 query，缺失 → 空态不报错；R102/§28.4） */
async function loadDetail(block: DisplayBlock): Promise<void> {
  const ds = dsOf(block)
  if (!ds.table) {
    store.row[block.bind] = null
    return
  }
  const rowId = String(props.routeQuery?.[rowIdParam()] ?? '')
  if (!rowId) {
    store.row[block.bind] = null
    return
  }
  store.loading[block.bind] = true
  try {
    const detail = await pubAppDataDetail(props.pubCode, ds.table, rowId, {
      expand: expandOf(block.bind),
    })
    store.row[block.bind] = toRowView(detail)
  } catch (error) {
    store.error[block.bind] = error instanceof Error ? error.message : '数据加载失败'
  } finally {
    store.loading[block.bind] = false
  }
}

/** 列表取数（filter/sort/expand 按 R104 传入；预览模式走 A 侧登录态 DSL 直查） */
async function loadList(block: DisplayBlock): Promise<void> {
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
    if (props.previewAppCode) {
      const preview = await queryData({
        appCode: props.previewAppCode,
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
      store.rows[block.bind] = (preview.list ?? []) as unknown as DataRowView[]
      return
    }
    const payload = await pubAppDataList(props.pubCode, ds.table, {
      size: ds.size ?? 20,
      sort: (ds.sort ?? []).map((item) => `${item.f}:${item.dir}`),
      filter: applied,
      expand: expandOf(block.bind),
    })
    store.rows[block.bind] = payload.list.map(toRowView)
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

function fieldSpecs(block: DisplayBlock): FieldSpecItem[] {
  const list = block.type === 'table' ? (block.columns ?? []) : (block.fields ?? [])
  return list.map((item) => ({ raw: item, ...parseFieldSpec(item) }))
}

function cellValue(row: DataRowView, spec: string): string {
  return displayCell(row, spec, [])
}

/** 附件字段取值（display: `字段:attachment`；取 fileId 出图/下载） */
function attachmentId(row: DataRowView, field: string): string {
  const raw = (row.data ?? {})[field]
  if (typeof raw === 'string' && raw) return raw
  if (typeof raw === 'number') return String(raw)
  return ''
}

function fileUrl(fileId: string): string {
  return pubAppFileUrl(props.pubCode, fileId)
}

/** 预览模式：rowLink 跳转无意义（草稿未落库/未公开）→ 不跳 */
function handleRowClick(row: DataRowView, rowLink: { page: string; rowIdParam?: string }): void {
  if (props.previewAppCode) return
  props.onRowClick?.(row, rowLink)
}

async function loadAll(): Promise<void> {
  for (const block of blocks.value) {
    if (block.type === 'detail') await loadDetail(block)
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
  <div class="pub-renderer">
    <template
      v-for="(block, index) in blocks"
      :key="index"
    >
      <!-- 筛选条（只读：仅查询，无写入口） -->
      <el-card
        v-if="block.type === 'filterBar'"
        class="pub-block"
        shadow="never"
      >
        <div class="pub-filter">
          <div
            v-for="spec in fieldSpecs(block)"
            :key="spec.name"
            class="pub-filter__item"
          >
            <span class="pub-filter__label">{{ spec.name }}</span>
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
        class="pub-block"
        shadow="never"
      >
        <div
          v-if="block.title"
          class="pub-block__title"
        >
          {{ block.title }}
        </div>
        <el-table
          v-loading="store.loading[block.bind]"
          :data="store.rows[block.bind] ?? []"
          :empty-text="store.error[block.bind] || '暂无数据'"
          @row-click="(row: DataRowView) => block.rowLink && handleRowClick(row, block.rowLink)"
        >
          <el-table-column
            v-for="spec in fieldSpecs(block)"
            :key="spec.name"
            :label="spec.name"
            min-width="120"
          >
            <template #default="{ row }">
              <template v-if="spec.modifier === 'attachment' && attachmentId(row, spec.name)">
                <el-image
                  :src="fileUrl(attachmentId(row, spec.name))"
                  fit="contain"
                  style="max-height: 64px"
                />
              </template>
              <template v-else>
                {{ cellValue(row, spec.raw ?? spec.name) }}
              </template>
            </template>
          </el-table-column>
          <template #empty>
            <span class="pub-empty">{{ store.error[block.bind] || '暂无数据' }}</span>
          </template>
        </el-table>
      </el-card>

      <!-- 详情 -->
      <el-card
        v-else-if="block.type === 'detail'"
        class="pub-block"
        shadow="never"
      >
        <div
          v-if="block.title"
          class="pub-block__title"
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
            <template v-if="spec.modifier === 'attachment' && attachmentId(store.row[block.bind] as DataRowView, spec.name)">
              <el-image
                :src="fileUrl(attachmentId(store.row[block.bind] as DataRowView, spec.name))"
                fit="contain"
                style="max-height: 240px"
              />
            </template>
            <template v-else>
              {{ cellValue(store.row[block.bind] as DataRowView, spec.raw ?? spec.name) }}
            </template>
          </el-descriptions-item>
        </el-descriptions>
        <el-empty
          v-else
          :description="store.loading[block.bind] ? '加载中…' : '参数缺失或暂无数据'"
        />
      </el-card>
    </template>

    <el-empty
      v-if="blocks.length === 0"
      description="该页面没有可展示的区块"
    />
  </div>
</template>

<style scoped>
.pub-block {
  margin-bottom: 16px;
}

.pub-block__title {
  font-weight: 600;
  margin-bottom: 12px;
}

.pub-filter {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}

.pub-filter__item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.pub-filter__label {
  font-size: 13px;
  color: var(--el-text-color-regular);
}

.pub-empty {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
</style>
