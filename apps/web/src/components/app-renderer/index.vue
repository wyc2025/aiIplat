<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { getSchema, queryData, runPageAction } from '@/api/app'
import { confirmDialog } from '@/utils/confirm'
import type { AppPageView, AppPageSchema, AppTableItem, DataRowView } from '@/types/api'
import FieldInput from './FieldInput.vue'
import { displayCell, findField, parseFieldSpec } from '@/views/app/utils/schema'

/**
 * AdminRenderer —— 功能页渲染引擎（P11 T106，ARCHITECTURE-P11 §5/§6）。
 * 按 page.schema 渲染四型区块（filterBar / table / form / detail）：
 * - 数据源统一经 POST /app/data/query；动作统一经 POST /app/data/action（多表写整体事务）；
 * - 禁用 v-html（全文本插值，防注入）；字段/区块 string DSL 解析见 views/app/utils/schema.ts。
 */
const props = defineProps<{ appCode: string; page: AppPageView }>()

const schema = computed(() => props.page.schema as AppPageSchema)
const tables = ref<AppTableItem[]>([])
const loadError = ref(false)
const dsState = reactive<
  Record<string, { list: DataRowView[]; total: number; loading: boolean; error: boolean }>
>({})
const filterValues = reactive<Record<string, Record<string, unknown>>>({})
const formValues = reactive<Record<string, Record<string, unknown>>>({})
const submitting = reactive<Record<string, boolean>>({})
const edit = reactive<{
  visible: boolean
  table: string
  action: string
  rowId: string
  values: Record<string, unknown>
}>({ visible: false, table: '', action: '', rowId: '', values: {} })
const editSubmitting = ref(false)

function ensureDs(name: string) {
  if (!dsState[name]) {
    dsState[name] = { list: [], total: 0, loading: false, error: false }
  }
  return dsState[name]
}

/** 表块中被 `:expand:` 引用的字段（查询时下推 expand ≤1 层） */
function expandOf(dsName: string): Array<{ f: string }> | undefined {
  const block = schema.value.layout.find((item) => item.type === 'table' && item.bind === dsName)
  const fields = (block?.columns ?? [])
    .map((spec) => parseFieldSpec(spec))
    .filter((parsed) => parsed.modifier === 'expand')
    .map((parsed) => ({ f: parsed.name }))
  return fields.length > 0 ? fields : undefined
}

async function loadDs(name: string): Promise<void> {
  const ds = schema.value.dataSources[name]
  if (!ds) return
  const state = ensureDs(name)
  state.loading = true
  state.error = false
  try {
    const applied = (filterValues[name]?.__applied ?? []) as Array<{
      f: string
      op: string
      v?: unknown
    }>
    const res = await queryData({
      appCode: props.appCode,
      op: ds.op === 'count' ? 'list' : ds.op,
      table: ds.table,
      filter: [...(ds.filter ?? []), ...applied],
      sort: ds.sort,
      size: ds.size ?? 20,
      page: 1,
      expand: expandOf(name),
    })
    state.list = res.list ?? (res.row ? [res.row] : [])
    state.total = res.total ?? state.list.length
  } catch {
    state.list = []
    state.total = 0
    state.error = true
  } finally {
    state.loading = false
  }
}

async function loadAll(): Promise<void> {
  loadError.value = false
  // 表单值容器必须**先于任何渲染**初始化（2026-09-29 修复）：
  // `tables` 在 getSchema 返回后立即就绪（`fieldOf` 有值 → 模板开始渲染表单字段控件），
  // 而 `formValues[bind]` 若等到数据源加载完才初始化，这中间那次渲染会读 undefined 的键，
  // 抛 "Cannot read properties of undefined (reading '字段名')" → 渲染中断留下"无实例组件 vnode"
  // → 之后离开该页时卸载崩（页面卡住不跳转）。
  initForms()
  try {
    const bundle = await getSchema(props.appCode)
    tables.value = bundle.tables
  } catch {
    loadError.value = true
    return
  }
  for (const [name, ds] of Object.entries(schema.value.dataSources)) {
    if (ds.op === 'list') {
      filterValues[name] = filterValues[name] ?? {}
      await loadDs(name)
    }
  }
}

function initForms(): void {
  for (const block of schema.value.layout) {
    if (block.type !== 'form') continue
    formValues[block.bind] = formValues[block.bind] ?? {}
  }
}

onMounted(loadAll)

function fieldOf(name: string) {
  return findField(tables.value, name)
}

function fieldLabel(spec: string): string {
  const parsed = parseFieldSpec(spec)
  return fieldOf(parsed.name)?.label ?? parsed.name
}

function tableOf(tableName: string): AppTableItem | undefined {
  return tables.value.find((table) => table.name === tableName)
}

/** 动作绑定的目标表（取步骤首表） */
function actionTable(action: string): string {
  const steps = schema.value.actions[action]?.steps ?? []
  return steps[0]?.table ?? ''
}

function actionExists(action: string): boolean {
  return Boolean(schema.value.actions[action])
}

/** ref 字段候选（约定数据源名 `${field}_options`，字段取 rowId + 首个其它声明字段） */
function refOptions(fieldName: string): Array<{ value: string; label: string }> {
  const ds = schema.value.dataSources[`${fieldName}_options`]
  const state = dsState[`${fieldName}_options`]
  if (!ds || !state) return []
  const labelField = (ds.fields ?? []).find((name) => name !== 'rowId') ?? 'rowId'
  return state.list.map((row) => ({
    value: row.rowId,
    label: String(row.data[labelField] ?? row.rowId),
  }))
}

function filterMode(spec: string): 'text' | 'enum' | 'bool' {
  const parsed = parseFieldSpec(spec)
  const field = fieldOf(parsed.name)
  if (field?.type === 'enum') return 'enum'
  if (field?.type === 'bool') return 'bool'
  return 'text'
}

/** 过滤值读写（模板里不用 v-model 强转，避免 unknown 与控件 prop 类型冲突） */
function getFilter(dsName: string, spec: string): unknown {
  return filterValues[dsName]?.[spec]
}

function filterText(dsName: string, spec: string): string {
  const raw = getFilter(dsName, spec)
  return raw === undefined || raw === null ? '' : String(raw)
}

function setFilter(dsName: string, spec: string, value: unknown): void {
  if (!filterValues[dsName]) filterValues[dsName] = {}
  filterValues[dsName][spec] = value
}

function applyFilter(dsName: string): void {
  const block = schema.value.layout.find((item) => item.type === 'filterBar' && item.bind === dsName)
  const next: Array<{ f: string; op: string; v?: unknown }> = []
  for (const spec of block?.fields ?? []) {
    const parsed = parseFieldSpec(spec)
    const raw = filterValues[dsName]?.[spec]
    if (raw === undefined || raw === null || raw === '') continue
    next.push({ f: parsed.name, op: parsed.modifier ?? 'eq', v: raw })
  }
  if (!filterValues[dsName]) filterValues[dsName] = {}
  filterValues[dsName].__applied = next
  void loadDs(dsName)
}

function resetFilter(dsName: string): void {
  for (const key of Object.keys(filterValues[dsName] ?? {})) {
    delete filterValues[dsName][key]
  }
  void loadDs(dsName)
}

async function submitAction(action: string, params: Record<string, unknown>): Promise<boolean> {
  if (!actionExists(action)) {
    ElMessage.warning(`页面未声明动作「${action}」，请在功能页编辑器补充后重试`)
    return false
  }
  try {
    await runPageAction({ appCode: props.appCode, pageCode: props.page.code, action, params })
    ElMessage.success('操作成功')
    await reloadAllLists()
    return true
  } catch {
    return false
  }
}

async function reloadAllLists(): Promise<void> {
  for (const [name, ds] of Object.entries(schema.value.dataSources)) {
    if (ds.op === 'list') await loadDs(name)
  }
}

async function submitForm(bind: string): Promise<void> {
  submitting[bind] = true
  try {
    const ok = await submitAction(bind, { ...(formValues[bind] ?? {}) })
    if (ok) formValues[bind] = {}
  } finally {
    submitting[bind] = false
  }
}

function openEdit(row: DataRowView, tableName: string): void {
  if (!actionExists(`update_${tableName}`)) {
    ElMessage.warning(`页面未声明更新动作「update_${tableName}」`)
    return
  }
  edit.visible = true
  edit.table = tableName
  edit.action = `update_${tableName}`
  edit.rowId = row.rowId
  edit.values = { ...row.data }
}

function editFields(): string[] {
  return (tableOf(edit.table)?.fields ?? []).map((field) => field.name)
}

async function submitEdit(): Promise<void> {
  editSubmitting.value = true
  try {
    const ok = await submitAction(edit.action, { ...edit.values, rowId: edit.rowId })
    if (ok) edit.visible = false
  } finally {
    editSubmitting.value = false
  }
}

async function removeRow(row: DataRowView, tableName: string): Promise<void> {
  if (
    !(await confirmDialog('删除后历史痕迹保留（软删），确认删除该行？', '删除确认', {
      type: 'warning',
    }))
  ) {
    return
  }
  await submitAction(`delete_${tableName}`, { rowId: row.rowId })
}

/** detail 区块：展示绑定数据源的首行 */
function detailRows(bind: string): DataRowView[] {
  return dsState[bind]?.list ?? []
}
</script>

<template>
  <div class="v-app-renderer">
    <el-result
      v-if="loadError"
      icon="error"
      title="页面加载失败"
      sub-title="请稍后重试"
    >
      <template #extra>
        <el-button
          type="primary"
          @click="loadAll"
        >
          重试
        </el-button>
      </template>
    </el-result>

    <template v-else>
      <template
        v-for="(block, index) in schema.layout"
        :key="index"
      >
        <!-- filterBar -->
        <el-card
          v-if="block.type === 'filterBar'"
          shadow="never"
          class="v-block"
        >
          <div class="v-filter">
            <div
              v-for="spec in block.fields ?? []"
              :key="spec"
              class="v-filter__item"
            >
              <span class="v-filter__label">{{ fieldLabel(spec) }}</span>
              <el-select
                v-if="filterMode(spec) === 'enum'"
                :model-value="getFilter(block.bind, spec)"
                clearable
                placeholder="全部"
                class="v-filter__control"
                @update:model-value="setFilter(block.bind, spec, $event)"
              >
                <el-option
                  v-for="option in fieldOf(parseFieldSpec(spec).name)?.enumOptions ?? []"
                  :key="option.value"
                  :label="option.label"
                  :value="option.value"
                />
              </el-select>
              <el-select
                v-else-if="filterMode(spec) === 'bool'"
                :model-value="getFilter(block.bind, spec)"
                clearable
                placeholder="全部"
                class="v-filter__control"
                @update:model-value="setFilter(block.bind, spec, $event)"
              >
                <el-option
                  label="是"
                  :value="true"
                />
                <el-option
                  label="否"
                  :value="false"
                />
              </el-select>
              <el-input
                v-else
                :model-value="filterText(block.bind, spec)"
                clearable
                placeholder="输入关键字"
                class="v-filter__control"
                @update:model-value="setFilter(block.bind, spec, $event)"
                @keyup.enter="applyFilter(block.bind)"
              />
            </div>
            <el-button
              type="primary"
              @click="applyFilter(block.bind)"
            >
              查询
            </el-button>
            <el-button @click="resetFilter(block.bind)">
              重置
            </el-button>
          </div>
        </el-card>

        <!-- table -->
        <el-card
          v-else-if="block.type === 'table'"
          shadow="never"
          class="v-block"
        >
          <div class="v-block__header">
            <span class="v-block__title">{{ page.name }}</span>
            <el-button
              v-if="actionExists(`create_${actionTable(block.bind)}`)"
              type="primary"
              size="small"
              @click="formValues[`create_${actionTable(block.bind)}`] = {}"
            >
              清空表单
            </el-button>
          </div>
          <el-table
            v-loading="dsState[block.bind]?.loading"
            :data="dsState[block.bind]?.list ?? []"
            border
            stripe
          >
            <el-table-column
              v-for="column in block.columns ?? []"
              :key="column"
              :label="fieldLabel(column)"
              min-width="140"
            >
              <template #default="{ row }">
                {{ displayCell(row as DataRowView, column, tables) }}
              </template>
            </el-table-column>
            <el-table-column
              v-if="(block.rowActions ?? []).length > 0"
              label="操作"
              width="150"
              fixed="right"
            >
              <template #default="{ row }">
                <el-button
                  v-if="(block.rowActions ?? []).includes('edit')"
                  link
                  type="primary"
                  @click="openEdit(row as DataRowView, actionTable(block.bind))"
                >
                  编辑
                </el-button>
                <el-button
                  v-if="(block.rowActions ?? []).includes('delete')"
                  link
                  type="danger"
                  @click="removeRow(row as DataRowView, actionTable(block.bind))"
                >
                  删除
                </el-button>
              </template>
            </el-table-column>
            <template #empty>
              <el-empty
                v-if="!dsState[block.bind]?.error"
                description="暂无数据"
              />
              <el-result
                v-else
                icon="error"
                title="加载失败"
                sub-title="请稍后重试"
              >
                <template #extra>
                  <el-button
                    type="primary"
                    @click="loadDs(block.bind)"
                  >
                    重试
                  </el-button>
                </template>
              </el-result>
            </template>
          </el-table>
        </el-card>

        <!-- form（新建） -->
        <el-card
          v-else-if="block.type === 'form'"
          shadow="never"
          class="v-block"
        >
          <div class="v-block__title">
            {{ block.title ?? '新建' }}
          </div>
          <el-form
            label-width="100px"
            class="v-form"
          >
            <el-form-item
              v-for="spec in block.fields ?? []"
              :key="spec"
              :label="fieldLabel(spec)"
              :required="fieldOf(parseFieldSpec(spec).name)?.required"
            >
              <FieldInput
                v-if="fieldOf(parseFieldSpec(spec).name)"
                v-model="formValues[block.bind][parseFieldSpec(spec).name]"
                :app-code="appCode"
                :field="fieldOf(parseFieldSpec(spec).name)!"
                :options="refOptions(parseFieldSpec(spec).name)"
              />
            </el-form-item>
            <el-form-item>
              <el-button
                type="primary"
                :loading="submitting[block.bind]"
                @click="submitForm(block.bind)"
              >
                提交
              </el-button>
              <el-button @click="formValues[block.bind] = {}">
                重置
              </el-button>
            </el-form-item>
          </el-form>
        </el-card>

        <!-- detail -->
        <el-card
          v-else-if="block.type === 'detail'"
          shadow="never"
          class="v-block"
        >
          <el-descriptions
            :column="2"
            border
          >
            <el-descriptions-item
              v-for="spec in block.fields ?? []"
              :key="spec"
              :label="fieldLabel(spec)"
            >
              {{ detailRows(block.bind)[0] ? displayCell(detailRows(block.bind)[0], spec, tables) : '—' }}
            </el-descriptions-item>
          </el-descriptions>
        </el-card>
      </template>
    </template>

    <!-- 编辑弹窗 -->
    <el-dialog
      v-model="edit.visible"
      :title="`编辑 ${edit.table}`"
      width="560px"
    >
      <el-form label-width="100px">
        <el-form-item
          v-for="name in editFields()"
          :key="name"
          :label="fieldOf(name)?.label ?? name"
          :required="fieldOf(name)?.required"
        >
          <FieldInput
            v-if="fieldOf(name)"
            v-model="edit.values[name]"
            :app-code="appCode"
            :field="fieldOf(name)!"
            :options="refOptions(name)"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="edit.visible = false">
          取消
        </el-button>
        <el-button
          type="primary"
          :loading="editSubmitting"
          @click="submitEdit"
        >
          保存
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.v-app-renderer {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.v-block {
  border: 1px solid var(--el-border-color-lighter);
}
.v-block__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.v-block__title {
  font-weight: 600;
  margin-bottom: 12px;
}
.v-filter {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.v-filter__item {
  display: flex;
  align-items: center;
  gap: 6px;
}
.v-filter__label {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.v-filter__control {
  width: 180px;
}
.v-form {
  max-width: 640px;
}
</style>
