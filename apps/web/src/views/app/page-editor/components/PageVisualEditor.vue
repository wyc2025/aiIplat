<script setup lang="ts">
/**
 * 功能页可视化编辑器（P12 T115 / PRD-P12-PATCH1，R109~R113）。
 *
 * 纯前端：产出的 schema 与既有 `PUT /api/app/:code/pages/:pid` 契约完全一致（零后端改动）。
 * - 区块编排：增（admin 四型 / display 三型）、删、上移下移（不引拖拽库，D105）；
 * - 字段选择器：选项来自 `GET /app/:code/schema`（props.tables），按类型出算子/修饰符，
 *   **字段 DSL 由编辑器生成**（用户不手写 `字段:op` 语法）；
 * - 数据源表单化（op/table/sort/size/fields；display 仅 list/get）；
 * - admin actions 步骤编排；display table 的 rowLink（限同应用 display 页 + rowIdParam）；
 * - 预览：只读渲染**草稿 schema**，数据走 A 侧 DSL 直查（`PublicRenderer` previewAppCode 通道），
 *   form 不渲染提交、不执行动作、零写请求。
 */
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import PublicRenderer from '@/components/app-renderer/PublicRenderer.vue'
import { FIELD_TYPE_LABELS, parseFieldSpec } from '../../utils/schema'
import type { AppPageListItem } from '@/api/app'
import type { AppFieldType, AppTableItem } from '@/types/api'

type BlockType = 'filterBar' | 'table' | 'form' | 'detail'
type Modifier = '' | 'expand' | 'attachment' | 'ref'

/** 编辑态字段行（columns / fields / filter 共用；按区块类型取用 op 或 modifier） */
interface FieldEdit {
  name: string
  modifier: Modifier
  target: string
  multiple: boolean
  op: string
  required: boolean
}

interface BlockEdit {
  type: BlockType
  bind: string
  title: string
  rows: FieldEdit[]
  rowActions: string[]
  rowLinkPage: string
  rowIdParam: string
  /** form 区块展示形态（2026-09-30）：dialog 弹窗（缺省）/ inline 内嵌；display 页无 form 不涉及 */
  placement: 'inline' | 'dialog'
}

interface SourceEdit {
  name: string
  op: 'list' | 'get' | 'count'
  table: string
  size: number
  sort: Array<{ f: string; dir: 'asc' | 'desc' }>
  fields: string[]
}

interface ActionEdit {
  name: string
  tx: boolean
  steps: Array<{ op: 'create' | 'update' | 'delete'; table: string }>
}

const props = defineProps<{
  appCode: string
  /** 应用内用户表（含字段元数据，字段选择器选项来源） */
  tables: AppTableItem[]
  /** 同应用功能页（display rowLink 目标下拉） */
  pages: AppPageListItem[]
  /** 初始 schema（打开编辑窗时的库中最新版本 / 模板） */
  initialSchema: Record<string, unknown>
}>()

const kind = ref<'admin' | 'display'>('admin')
const blocks = ref<BlockEdit[]>([])
const sources = ref<SourceEdit[]>([])
const actions = ref<ActionEdit[]>([])
const previewVisible = ref(false)

const isDisplay = computed(() => kind.value === 'display')
const blockTypes = computed<BlockType[]>(() =>
  isDisplay.value ? ['filterBar', 'table', 'detail'] : ['filterBar', 'table', 'form', 'detail'],
)
const sourceOps = computed(() => (isDisplay.value ? ['list', 'get'] : ['list', 'get', 'count']))
const displayPages = computed(() => props.pages.filter((page) => page.kind === 'display'))
const tableOptions = computed(() => props.tables.map((table) => ({ value: table.name, label: `${table.label}（${table.name}）` })))
const filterOps = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'in']
const modifierOptions: Array<{ value: Modifier; label: string }> = [
  { value: '', label: '直接展示' },
  { value: 'expand', label: '展开引用' },
  { value: 'attachment', label: '附件' },
  { value: 'ref', label: '引用（可多值）' },
]

// ==================== 初始化与序列化 ====================

function emptyRow(): FieldEdit {
  return { name: '', modifier: '', target: '', multiple: false, op: 'eq', required: false }
}

function rowFromSpec(raw: string, forFilter: boolean): FieldEdit {
  const spec = parseFieldSpec(raw)
  const row = emptyRow()
  row.name = spec.name
  if (forFilter) {
    row.op = spec.modifier && filterOps.includes(spec.modifier) ? spec.modifier : 'eq'
    return row
  }
  if (spec.modifier === 'expand') {
    row.modifier = 'expand'
    row.target = spec.target ?? ''
  } else if (spec.modifier === 'attachment') {
    row.modifier = 'attachment'
  } else if (spec.modifier === 'ref') {
    row.modifier = 'ref'
    row.target = spec.target ?? ''
    row.multiple = spec.multiple === true
  }
  return row
}

function specOf(row: FieldEdit): string {
  if (!row.name) return ''
  if (row.modifier === 'expand') return `${row.name}:expand:${row.target}`
  if (row.modifier === 'attachment') return `${row.name}:attachment`
  if (row.modifier === 'ref') return `${row.name}:ref:${row.target}${row.multiple ? ':multiple' : ''}`
  return row.name
}

function fromSchema(raw: Record<string, unknown>): void {
  const source = (raw ?? {}) as {
    kind?: string
    layout?: Array<Record<string, unknown>>
    dataSources?: Record<string, Record<string, unknown>>
    actions?: Record<string, Record<string, unknown>>
  }
  kind.value = source.kind === 'display' ? 'display' : 'admin'
  const layout = Array.isArray(source.layout) ? source.layout : []
  blocks.value = layout.map((block) => {
    const type = (block.type as BlockType) ?? 'table'
    const forFilter = type === 'filterBar'
    const rawList = forFilter
      ? ((block.fields as string[]) ?? [])
      : type === 'table'
        ? ((block.columns as string[]) ?? [])
        : ((block.fields as string[]) ?? [])
    const rowLink = (block.rowLink ?? {}) as { page?: string; rowIdParam?: string }
    return {
      type,
      bind: (block.bind as string) ?? '',
      title: (block.title as string) ?? '',
      rows: rawList.map((item) => rowFromSpec(item, forFilter)),
      rowActions: ((block.rowActions as string[]) ?? []).filter((item) => item),
      rowLinkPage: rowLink.page ?? '',
      rowIdParam: rowLink.rowIdParam ?? 'rowId',
      placement: block.placement === 'inline' ? 'inline' : 'dialog',
    }
  })
  const ds = source.dataSources ?? {}
  sources.value = Object.entries(ds).map(([name, item]) => ({
    name,
    op: ((item.op as SourceEdit['op']) ?? 'list') as SourceEdit['op'],
    table: (item.table as string) ?? '',
    size: (item.size as number) ?? 20,
    sort: Array.isArray(item.sort) ? (item.sort as SourceEdit['sort']) : [],
    fields: Array.isArray(item.fields) ? (item.fields as string[]) : [],
  }))
  const acts = source.actions ?? {}
  actions.value = Object.entries(acts).map(([name, item]) => ({
    name,
    tx: item.tx === true,
    steps: Array.isArray(item.steps) ? (item.steps as ActionEdit['steps']) : [],
  }))
}

function getSchema(): Record<string, unknown> {
  const layout = blocks.value.map((block) => {
    const base: Record<string, unknown> = { type: block.type, bind: block.bind }
    if (block.title) base.title = block.title
    if (block.type === 'filterBar') {
      base.fields = block.rows.filter((row) => row.name).map((row) => `${row.name}:${row.op}`)
    } else if (block.type === 'table') {
      base.columns = block.rows.filter((row) => row.name).map(specOf)
      if (!isDisplay.value && block.rowActions.length > 0) base.rowActions = [...block.rowActions]
      if (isDisplay.value && block.rowLinkPage) {
        base.rowLink = { page: block.rowLinkPage, rowIdParam: block.rowIdParam || 'rowId' }
      }
    } else {
      base.fields = block.rows.filter((row) => row.name).map(specOf)
      // form 区块展示形态（2026-09-30）：dialog = 表头「新建」弹窗 / inline = 内嵌区块
      if (!isDisplay.value && block.type === 'form') base.placement = block.placement
    }
    return base
  })
  const dataSources: Record<string, unknown> = {}
  for (const source of sources.value) {
    if (!source.name || !source.table) continue
    const item: Record<string, unknown> = { op: source.op, table: source.table }
    if (source.size) item.size = source.size
    if (source.sort.length > 0) item.sort = source.sort
    if (source.fields.length > 0) item.fields = source.fields
    dataSources[source.name] = item
  }
  const actionMap: Record<string, unknown> = {}
  if (!isDisplay.value) {
    for (const action of actions.value) {
      if (!action.name) continue
      actionMap[action.name] = { tx: action.tx, steps: action.steps.filter((step) => step.table) }
    }
  }
  return { kind: kind.value, layout, dataSources, actions: actionMap }
}

defineExpose({ getSchema, fromSchema })

// ==================== 区块操作（R110） ====================

function addBlock(type: BlockType): void {
  blocks.value.push({
    type,
    bind: sources.value[0]?.name ?? '',
    title: '',
    rows: [],
    rowActions: type === 'table' && !isDisplay.value ? ['edit', 'delete'] : [],
    rowLinkPage: '',
    rowIdParam: 'rowId',
    placement: 'dialog',
  })
}

function moveBlock(index: number, delta: number): void {
  const target = index + delta
  if (target < 0 || target >= blocks.value.length) return
  const [item] = blocks.value.splice(index, 1)
  blocks.value.splice(target, 0, item)
}

function removeBlock(index: number): void {
  blocks.value.splice(index, 1)
}

function addRow(block: BlockEdit): void {
  block.rows.push(emptyRow())
}

function removeRow(block: BlockEdit, index: number): void {
  block.rows.splice(index, 1)
}

// ==================== 数据源 / 动作操作 ====================

function addSource(): void {
  const used = new Set(sources.value.map((item) => item.name))
  let index = sources.value.length + 1
  let name = `ds${index}`
  while (used.has(name)) {
    index += 1
    name = `ds${index}`
  }
  sources.value.push({ name, op: 'list', table: props.tables[0]?.name ?? '', size: 20, sort: [], fields: [] })
}

function addSort(source: SourceEdit): void {
  source.sort.push({ f: fieldsOf(source.name)[0]?.name ?? '', dir: 'asc' })
}

function addAction(): void {
  const used = new Set(actions.value.map((item) => item.name))
  let index = actions.value.length + 1
  let name = `action${index}`
  while (used.has(name)) {
    index += 1
    name = `action${index}`
  }
  actions.value.push({ name, tx: false, steps: [{ op: 'create', table: props.tables[0]?.name ?? '' }] })
}

function addStep(action: ActionEdit): void {
  action.steps.push({ op: 'create', table: props.tables[0]?.name ?? '' })
}

// ==================== 字段选择器（R111） ====================

function tableOf(dsName: string): AppTableItem | undefined {
  const source = sources.value.find((item) => item.name === dsName)
  const name = source?.table ?? ''
  return props.tables.find((table) => table.name === name)
}

function fieldsOf(dsName: string): Array<{ name: string; label: string; type: AppFieldType }> {
  return (tableOf(dsName)?.fields ?? []).map((field) => ({
    name: field.name,
    label: `${field.label}（${field.name}）`,
    type: field.type as AppFieldType,
  }))
}

function fieldOptions(block: BlockEdit) {
  const list = fieldsOf(block.bind).map((field) => ({ value: field.name, label: field.label }))
  return [{ value: 'rowId', label: 'rowId（行主键）' }, ...list]
}

function fieldType(block: BlockEdit, name: string): AppFieldType | undefined {
  return fieldsOf(block.bind).find((field) => field.name === name)?.type
}

/** 类型感知算子：text→eq/contains/ne；number/date→比较全集；enum/bool→eq/ne；ref→eq/in */
function opsFor(block: BlockEdit, row: FieldEdit): string[] {
  const type = fieldType(block, row.name)
  if (type === 'number' || type === 'datetime') return ['eq', 'ne', 'gt', 'gte', 'lt', 'lte']
  if (type === 'enum' || type === 'bool') return ['eq', 'ne']
  if (type === 'ref') return ['eq', 'in']
  return ['eq', 'contains', 'ne']
}

/** 引用目标表选项（expand / ref 的 target 下拉） */
function refTargets(block: BlockEdit, row: FieldEdit): Array<{ value: string; label: string }> {
  const field = (tableOf(block.bind)?.fields ?? []).find((item) => item.name === row.name)
  const options = props.tables
    .filter((table) => !table.isSystem)
    .map((table) => ({ value: table.name, label: `${table.label}（${table.name}）` }))
  if (field?.refTableName) {
    const hit = options.find((item) => item.value === field.refTableName)
    return hit ? [hit] : options
  }
  return options
}

function fieldTypeLabel(block: BlockEdit, row: FieldEdit): string {
  const type = fieldType(block, row.name)
  return type ? FIELD_TYPE_LABELS[type] : '—'
}

// ==================== 预览（PRD-PATCH1 §4） ====================

const previewRendererKey = ref(0)

function openPreview(): void {
  if (!sources.value.some((item) => item.name && item.table)) {
    ElMessage.warning('请先配置至少一个数据源（表）')
    return
  }
  previewRendererKey.value += 1
  previewVisible.value = true
}

/** 当前草稿的 display 归一化视图（预览统一走只读渲染：display 三型，form/actions 不执行） */
const previewDisplaySchema = computed<Record<string, unknown>>(() => {
  const draft = getSchema()
  const layout = (draft.layout as Array<Record<string, unknown>>).filter((block) => block.type !== 'form')
  return { ...draft, kind: 'display', layout, actions: {} }
})
</script>

<template>
  <div class="v-visual">
    <el-alert
      :title="isDisplay ? '展示页：只读浏览（filterBar / table / detail），无动作与表单' : '管理页：可含表单与动作（写入走页面动作端点）'"
      type="info"
      :closable="false"
      show-icon
      class="v-visual__tip"
    />

    <!-- 数据源 -->
    <section class="v-visual__section">
      <div class="v-visual__head">
        <span class="v-visual__title">数据源</span>
        <el-button
          size="small"
          @click="addSource"
        >
          新增数据源
        </el-button>
      </div>
      <el-empty
        v-if="sources.length === 0"
        description="还没有数据源，区块的 bind 将无可选项"
        :image-size="60"
      />
      <el-card
        v-for="source in sources"
        :key="source.name"
        class="v-visual__card"
        shadow="never"
      >
        <div class="v-visual__row">
          <el-input
            v-model="source.name"
            size="small"
            placeholder="数据源名（如 mainList）"
            style="width: 160px"
          />
          <el-select
            v-model="source.op"
            size="small"
            style="width: 120px"
          >
            <el-option
              v-for="op in sourceOps"
              :key="op"
              :label="op"
              :value="op"
            />
          </el-select>
          <el-select
            v-model="source.table"
            size="small"
            placeholder="逻辑表"
            style="width: 200px"
          >
            <el-option
              v-for="table in tableOptions"
              :key="table.value"
              :label="table.label"
              :value="table.value"
            />
          </el-select>
          <el-input-number
            v-model="source.size"
            size="small"
            :min="1"
            :max="100"
            controls-position="right"
            style="width: 110px"
          />
          <el-button
            size="small"
            type="danger"
            text
            @click="sources.splice(sources.indexOf(source), 1)"
          >
            删除
          </el-button>
        </div>
        <div class="v-visual__row">
          <span class="v-visual__label">排序</span>
          <div
            v-for="(sort, sortIndex) in source.sort"
            :key="sortIndex"
            class="v-visual__row"
          >
            <el-select
              v-model="sort.f"
              size="small"
              style="width: 160px"
            >
              <el-option
                v-for="field in fieldOptions({ bind: source.name } as BlockEdit)"
                :key="field.value"
                :label="field.label"
                :value="field.value"
              />
            </el-select>
            <el-select
              v-model="sort.dir"
              size="small"
              style="width: 90px"
            >
              <el-option
                label="升序"
                value="asc"
              />
              <el-option
                label="降序"
                value="desc"
              />
            </el-select>
            <el-button
              size="small"
              text
              type="danger"
              @click="source.sort.splice(sortIndex, 1)"
            >
              ×
            </el-button>
          </div>
          <el-button
            size="small"
            text
            type="primary"
            @click="addSort(source)"
          >
            + 排序
          </el-button>
        </div>
      </el-card>
    </section>

    <!-- 区块编排 -->
    <section class="v-visual__section">
      <div class="v-visual__head">
        <span class="v-visual__title">区块（顺序即渲染顺序）</span>
        <div class="v-visual__row">
          <el-button
            v-for="type in blockTypes"
            :key="type"
            size="small"
            @click="addBlock(type)"
          >
            + {{ type }}
          </el-button>
        </div>
      </div>
      <el-empty
        v-if="blocks.length === 0"
        description="还没有区块"
        :image-size="60"
      />
      <el-card
        v-for="(block, blockIndex) in blocks"
        :key="blockIndex"
        class="v-visual__card"
        shadow="never"
      >
        <div class="v-visual__row">
          <el-select
            v-model="block.type"
            size="small"
            style="width: 130px"
          >
            <el-option
              v-for="type in blockTypes"
              :key="type"
              :label="type"
              :value="type"
            />
          </el-select>
          <el-select
            v-model="block.bind"
            size="small"
            placeholder="bind 数据源"
            style="width: 160px"
          >
            <el-option
              v-for="source in sources"
              :key="source.name"
              :label="source.name"
              :value="source.name"
            />
          </el-select>
          <el-input
            v-model="block.title"
            size="small"
            placeholder="标题（可选）"
            style="width: 160px"
          />
          <el-button
            size="small"
            :disabled="blockIndex === 0"
            @click="moveBlock(blockIndex, -1)"
          >
            上移
          </el-button>
          <el-button
            size="small"
            :disabled="blockIndex === blocks.length - 1"
            @click="moveBlock(blockIndex, 1)"
          >
            下移
          </el-button>
          <el-button
            size="small"
            type="danger"
            text
            @click="removeBlock(blockIndex)"
          >
            删除
          </el-button>
        </div>

        <!-- admin form：展示形态（2026-09-30） -->
        <div
          v-if="block.type === 'form' && !isDisplay"
          class="v-visual__row"
        >
          <span class="v-visual__label">展示形态</span>
          <el-select
            v-model="block.placement"
            size="small"
            style="width: 170px"
          >
            <el-option
              label="弹窗（表头「新建」）"
              value="dialog"
            />
            <el-option
              label="内嵌区块"
              value="inline"
            />
          </el-select>
        </div>

        <!-- admin table：行内动作（display 禁） -->
        <div
          v-if="block.type === 'table' && !isDisplay"
          class="v-visual__row"
        >
          <span class="v-visual__label">行内动作</span>
          <el-checkbox-group v-model="block.rowActions">
            <el-checkbox value="edit">
              编辑
            </el-checkbox>
            <el-checkbox value="delete">
              删除
            </el-checkbox>
          </el-checkbox-group>
        </div>

        <!-- display table：rowLink（R112） -->
        <div
          v-if="block.type === 'table' && isDisplay"
          class="v-visual__row"
        >
          <span class="v-visual__label">行点击跳转</span>
          <el-select
            v-model="block.rowLinkPage"
            size="small"
            clearable
            placeholder="目标展示页（可空）"
            style="width: 200px"
          >
            <el-option
              v-for="page in displayPages"
              :key="page.code"
              :label="`${page.name}（${page.code}）`"
              :value="page.code"
            />
          </el-select>
          <el-input
            v-model="block.rowIdParam"
            size="small"
            placeholder="参数名（默认 rowId）"
            style="width: 160px"
          />
        </div>

        <!-- 字段列表 -->
        <div class="v-visual__rows">
          <div
            v-for="(row, rowIndex) in block.rows"
            :key="rowIndex"
            class="v-visual__row"
          >
            <el-select
              v-model="row.name"
              size="small"
              filterable
              placeholder="字段"
              style="width: 190px"
            >
              <el-option
                v-for="field in fieldOptions(block)"
                :key="field.value"
                :label="field.label"
                :value="field.value"
              />
            </el-select>
            <span class="v-visual__type">{{ fieldTypeLabel(block, row) }}</span>

            <template v-if="block.type === 'filterBar'">
              <el-select
                v-model="row.op"
                size="small"
                style="width: 120px"
              >
                <el-option
                  v-for="op in opsFor(block, row)"
                  :key="op"
                  :label="op"
                  :value="op"
                />
              </el-select>
            </template>
            <template v-else>
              <el-select
                v-model="row.modifier"
                size="small"
                style="width: 140px"
              >
                <el-option
                  v-for="item in modifierOptions"
                  :key="item.value"
                  :label="item.label"
                  :value="item.value"
                />
              </el-select>
              <el-select
                v-if="row.modifier === 'expand' || row.modifier === 'ref'"
                v-model="row.target"
                size="small"
                placeholder="目标表"
                style="width: 170px"
              >
                <el-option
                  v-for="target in refTargets(block, row)"
                  :key="target.value"
                  :label="target.label"
                  :value="target.value"
                />
              </el-select>
              <el-checkbox
                v-if="row.modifier === 'ref'"
                v-model="row.multiple"
              >
                多值
              </el-checkbox>
            </template>

            <el-button
              size="small"
              text
              type="danger"
              @click="removeRow(block, rowIndex)"
            >
              ×
            </el-button>
          </div>
          <el-button
            size="small"
            text
            type="primary"
            @click="addRow(block)"
          >
            + 字段
          </el-button>
        </div>
      </el-card>
    </section>

    <!-- 动作（admin） -->
    <section
      v-if="!isDisplay"
      class="v-visual__section"
    >
      <div class="v-visual__head">
        <span class="v-visual__title">动作（表单提交 / 多步事务）</span>
        <el-button
          size="small"
          @click="addAction"
        >
          新增动作
        </el-button>
      </div>
      <el-empty
        v-if="actions.length === 0"
        description="还没有动作（form 区块的 bind 需指向动作名）"
        :image-size="60"
      />
      <el-card
        v-for="action in actions"
        :key="action.name"
        class="v-visual__card"
        shadow="never"
      >
        <div class="v-visual__row">
          <el-input
            v-model="action.name"
            size="small"
            placeholder="动作名（如 create_book）"
            style="width: 200px"
          />
          <el-checkbox v-model="action.tx">
            事务（多步整体提交）
          </el-checkbox>
          <el-button
            size="small"
            type="danger"
            text
            @click="actions.splice(actions.indexOf(action), 1)"
          >
            删除
          </el-button>
        </div>
        <div
          v-for="(step, stepIndex) in action.steps"
          :key="stepIndex"
          class="v-visual__row"
        >
          <span class="v-visual__label">步骤 {{ stepIndex + 1 }}</span>
          <el-select
            v-model="step.op"
            size="small"
            style="width: 120px"
          >
            <el-option
              label="create"
              value="create"
            />
            <el-option
              label="update"
              value="update"
            />
            <el-option
              label="delete"
              value="delete"
            />
          </el-select>
          <el-select
            v-model="step.table"
            size="small"
            style="width: 200px"
          >
            <el-option
              v-for="table in tableOptions"
              :key="table.value"
              :label="table.label"
              :value="table.value"
            />
          </el-select>
          <el-button
            size="small"
            text
            type="danger"
            @click="action.steps.splice(stepIndex, 1)"
          >
            ×
          </el-button>
        </div>
        <el-button
          size="small"
          text
          type="primary"
          @click="addStep(action)"
        >
          + 步骤
        </el-button>
      </el-card>
    </section>

    <div class="v-visual__footer">
      <el-button
        size="small"
        type="primary"
        plain
        @click="openPreview"
      >
        预览草稿（只读）
      </el-button>
      <span class="v-visual__hint">预览走登录态直查，不产生写请求；表单提交与动作不执行</span>
    </div>

    <el-dialog
      v-model="previewVisible"
      title="草稿预览（只读）"
      width="760px"
      append-to-body
    >
      <PublicRenderer
        :key="previewRendererKey"
        :pub-code="''"
        :preview-app-code="appCode"
        :schema="previewDisplaySchema"
      />
      <template #footer>
        <el-button @click="previewVisible = false">
          关闭
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.v-visual__tip {
  margin-bottom: 12px;
}
.v-visual__section {
  margin-bottom: 18px;
}
.v-visual__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.v-visual__title {
  font-weight: 600;
  font-size: 14px;
}
.v-visual__card {
  margin-bottom: 10px;
  background: var(--el-fill-color-lighter, #fafafa);
}
.v-visual__row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 6px;
}
.v-visual__rows {
  border-top: 1px dashed var(--el-border-color);
  padding-top: 8px;
}
.v-visual__label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.v-visual__type {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  min-width: 54px;
}
.v-visual__footer {
  display: flex;
  align-items: center;
  gap: 10px;
}
.v-visual__hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
