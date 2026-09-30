<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
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
  // 切页（同路由换参数、实例复用）先清掉上一页残留的数据源/筛选/表单状态
  resetPageState()
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

/** 清空当前页状态（数据源 / 筛选 / 表单）；切页复用同一实例时必须重置 */
function resetPageState(): void {
  for (const key of Object.keys(dsState)) delete dsState[key]
  for (const key of Object.keys(filterValues)) delete filterValues[key]
  for (const key of Object.keys(formValues)) delete formValues[key]
}

/** 表单值容器（惰性初始化兜底：万一渲染早于 loadAll，也不会读到 undefined 的键） */
function formOf(bind: string): Record<string, unknown> {
  if (!formValues[bind]) formValues[bind] = {}
  return formValues[bind]
}

/** 清空表单（table 块「清空表单」与 form 块「重置」共用） */
function resetForm(bind: string): void {
  formValues[bind] = {}
}

// ==================== form 区块展示形态（2026-09-30：新建弹窗化） ====================

/**
 * form 区块展示形态：`inline` = 内嵌区块（历史行为）；其余（含未声明）= `dialog`
 * —— 新建改为表格卡片头部「新建」按钮 + 弹窗，与「编辑」一致（用户口径，缺省即弹窗，
 * 存量页面无需改 schema 即生效；需要内嵌的页面在页编辑器里显式选 inline）。
 */
function placementOf(block: { placement?: string }): 'inline' | 'dialog' {
  return block?.placement === 'inline' ? 'inline' : 'dialog'
}

/** 表格块绑定的数据源对应的逻辑表名 */
function tableOfDs(dsName: string): string {
  return schema.value.dataSources[dsName]?.table ?? ''
}

/** 该表下的 dialog 型「新建」入口（弹窗标题取 form 区块 title） */
function dialogFormsOf(dsName: string): Array<{ bind: string; title: string }> {
  const table = tableOfDs(dsName)
  return schema.value.layout
    .filter((block) => block.type === 'form' && placementOf(block) === 'dialog' && actionTable(block.bind) === table)
    .map((block) => ({ bind: block.bind, title: block.title ?? `新建${table}` }))
}

/** 该表下是否存在 inline 型表单（决定表头是否保留「清空表单」） */
function hasInlineForm(dsName: string): boolean {
  const table = tableOfDs(dsName)
  return schema.value.layout.some(
    (block) => block.type === 'form' && placementOf(block) === 'inline' && actionTable(block.bind) === table,
  )
}

/** 新建弹窗状态 */
const createDialog = reactive<{ visible: boolean; bind: string; title: string; table: string }>({
  visible: false,
  bind: '',
  title: '',
  table: '',
})
const createSubmitting = ref(false)

/** 打开新建弹窗（每次打开清空表单值） */
function openCreate(bind: string, title: string, table: string): void {
  createDialog.bind = bind
  createDialog.title = title
  createDialog.table = table
  formValues[bind] = {}
  createDialog.visible = true
}

/** 弹窗内字段列表（该动作目标表的全部字段） */
function createFields(): string[] {
  return (tableOf(createDialog.table)?.fields ?? []).map((field) => field.name)
}

/** 提交新建（复用统一动作入口；成功后关闭并清空） */
async function submitCreate(): Promise<void> {
  createSubmitting.value = true
  try {
    const ok = await submitAction(createDialog.bind, { ...(formValues[createDialog.bind] ?? {}) })
    if (ok) {
      createDialog.visible = false
      formValues[createDialog.bind] = {}
    }
  } finally {
    createSubmitting.value = false
  }
}

onMounted(loadAll)

/**
 * 切页重新加载（2026-09-29 修复「功能页之间互跳后再点菜单没反应」）：
 * 功能页之间跳转时**路由相同、只有参数变化**（`/app-center/app/:appCode/p/:pageCode`），
 * Vue 会**复用本组件实例**（不会重新 mounted）——必须监听 page.code 主动重跑 loadAll，
 * 否则新页面的表单容器未初始化，模板读 `formValues[新bind][字段名]` 抛
 * "Cannot read properties of undefined (reading '字段名')"，渲染期中断留下"无实例组件 vnode"，
 * 之后离开该页时卸载崩、点任何菜单都无反应。
 */
watch(
  () => props.page?.code,
  () => {
    void loadAll()
  },
)

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
            <div class="v-block__actions">
              <!-- dialog 型表单：新建入口（弹窗，与「编辑」同款） -->
              <el-button
                v-for="form in dialogFormsOf(block.bind)"
                :key="form.bind"
                type="primary"
                size="small"
                @click="openCreate(form.bind, form.title, actionTable(form.bind))"
              >
                {{ form.title }}
              </el-button>
              <!-- inline 型表单：表单在下方内嵌，这里保留清空 -->
              <el-button
                v-if="hasInlineForm(block.bind)"
                size="small"
                @click="resetForm(`create_${tableOfDs(block.bind)}`)"
              >
                清空表单
              </el-button>
            </div>
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
                  @click="openEdit(row as DataRowView, tableOfDs(block.bind))"
                >
                  编辑
                </el-button>
                <el-button
                  v-if="(block.rowActions ?? []).includes('delete')"
                  link
                  type="danger"
                  @click="removeRow(row as DataRowView, tableOfDs(block.bind))"
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

        <!-- form（新建）：仅 inline 型内嵌渲染；dialog 型由表头「新建」按钮弹出 -->
        <el-card
          v-else-if="block.type === 'form' && placementOf(block) === 'inline'"
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
                v-model="formOf(block.bind)[parseFieldSpec(spec).name]"
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
              <el-button @click="resetForm(block.bind)">
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

    <!-- 新建弹窗（form 区块 placement=dialog；字段控件与「编辑」同款 FieldInput） -->
    <el-dialog
      v-model="createDialog.visible"
      :title="createDialog.title"
      width="560px"
    >
      <el-form label-width="100px">
        <el-form-item
          v-for="name in createFields()"
          :key="name"
          :label="fieldOf(name)?.label ?? name"
          :required="fieldOf(name)?.required"
        >
          <FieldInput
            v-if="fieldOf(name)"
            v-model="formOf(createDialog.bind)[name]"
            :app-code="appCode"
            :field="fieldOf(name)!"
            :options="refOptions(name)"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createDialog.visible = false">
          取消
        </el-button>
        <el-button
          type="primary"
          :loading="createSubmitting"
          @click="submitCreate"
        >
          提交
        </el-button>
      </template>
    </el-dialog>

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
.v-block__actions {
  display: flex;
  align-items: center;
  gap: 8px;
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
