<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  addField,
  createRelation,
  createTable,
  deleteField,
  deleteTable,
  getSchema,
} from '@/api/app'
import { confirmDialog } from '@/utils/confirm'
import type { AppFieldInput, AppFieldType, AppSchemaBundle } from '@/types/api'
import { FIELD_TYPES, FIELD_TYPE_LABELS } from '../utils/schema'

/**
 * 应用结构编辑器（P11 T106）：表 / 字段 / 关系管理。
 * 变更即时失效后端 schema 缓存；软删字段保留历史数据（D95）。
 */
const route = useRoute()
const appCode = computed(() => String(route.query.appCode ?? ''))

const loading = ref(false)
const loadError = ref(false)
const bundle = ref<AppSchemaBundle | null>(null)

const userTables = computed(() => (bundle.value?.tables ?? []).filter((table) => !table.isSystem))

function emptyField(): AppFieldInput {
  return { name: '', label: '', type: 'text' }
}

const tableDialog = reactive({
  visible: false,
  submitting: false,
  name: '',
  label: '',
  fields: [emptyField()] as AppFieldInput[],
})

const fieldDialog = reactive({
  visible: false,
  submitting: false,
  tableId: '',
  tableName: '',
  field: emptyField() as AppFieldInput,
})

const relDialog = reactive({
  visible: false,
  submitting: false,
  fromTable: '',
  fromField: '',
  toTable: '',
})

async function load(): Promise<void> {
  if (!appCode.value) return
  loading.value = true
  loadError.value = false
  try {
    bundle.value = await getSchema(appCode.value)
  } catch {
    bundle.value = null
    loadError.value = true
  } finally {
    loading.value = false
  }
}

onMounted(load)

function openTableDialog(): void {
  tableDialog.name = ''
  tableDialog.label = ''
  tableDialog.fields = [emptyField()]
  tableDialog.visible = true
}

function addFieldRow(): void {
  tableDialog.fields.push(emptyField())
}

function removeFieldRow(index: number): void {
  tableDialog.fields.splice(index, 1)
  if (tableDialog.fields.length === 0) tableDialog.fields.push(emptyField())
}

async function submitTable(): Promise<void> {
  const valid = tableDialog.fields.filter((field) => field.name.trim() && field.label.trim())
  if (!tableDialog.name.trim() || !tableDialog.label.trim() || valid.length === 0) {
    ElMessage.warning('表名、显示名与至少 1 个字段为必填')
    return
  }
  tableDialog.submitting = true
  try {
    await createTable(appCode.value, {
      name: tableDialog.name.trim(),
      label: tableDialog.label.trim(),
      fields: valid.map((field) => normalizeField(field)),
    })
    ElMessage.success('建表成功')
    tableDialog.visible = false
    await load()
  } catch {
    // 请求层已提示
  } finally {
    tableDialog.submitting = false
  }
}

function openFieldDialog(tableId: string, tableName: string): void {
  fieldDialog.tableId = tableId
  fieldDialog.tableName = tableName
  fieldDialog.field = emptyField()
  fieldDialog.visible = true
}

async function submitField(): Promise<void> {
  if (!fieldDialog.field.name.trim() || !fieldDialog.field.label.trim()) {
    ElMessage.warning('字段名与显示名必填')
    return
  }
  fieldDialog.submitting = true
  try {
    await addField(appCode.value, fieldDialog.tableId, normalizeField(fieldDialog.field))
    ElMessage.success('字段已新增')
    fieldDialog.visible = false
    await load()
  } finally {
    fieldDialog.submitting = false
  }
}

function normalizeField(field: AppFieldInput): AppFieldInput {
  const next: AppFieldInput = {
    name: field.name.trim(),
    label: field.label.trim(),
    type: field.type,
  }
  if (field.required) next.required = 1
  if (field.type === 'enum') next.enumOptions = field.enumOptions ?? [{ value: '', label: '' }]
  if (field.type === 'ref') next.refTable = field.refTable
  return next
}

async function removeField(fieldId: string, label: string): Promise<void> {
  if (!(await confirmDialog(`删除字段「${label}」？历史数据保留，字段将从页面中消失。`, '删除确认', { type: 'warning' }))) {
    return
  }
  await deleteField(appCode.value, fieldId)
  ElMessage.success('字段已删除（软删）')
  await load()
}

async function removeTable(tableId: string, label: string): Promise<void> {
  if (!(await confirmDialog(`删除表「${label}」？如被其他表引用会阻断，需先解除引用。`, '删除确认', { type: 'warning' }))) {
    return
  }
  await deleteTable(appCode.value, tableId)
  ElMessage.success('表已删除（软删）')
  await load()
}

/** 枚举选项标签串（模板内不做类型标注，避免模板表达式解析失败） */
function enumLabels(record: { enumOptions?: Array<{ label: string }> | null }): string {
  return (record.enumOptions ?? []).map((option) => option.label).join(' / ')
}

/** 逗号分隔文本 → 枚举选项 */
function parseEnumOptions(input: unknown): Array<{ value: string; label: string }> {
  return String(input ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => ({ value: item, label: item }))
}

function setRowRequired(index: number, value: unknown): void {
  tableDialog.fields[index].required = value ? 1 : 0
}

function setRowEnumOptions(index: number, value: unknown): void {
  tableDialog.fields[index].enumOptions = parseEnumOptions(value)
}

function setFieldRequired(value: unknown): void {
  fieldDialog.field.required = value ? 1 : 0
}

function setFieldEnumOptions(value: unknown): void {
  fieldDialog.field.enumOptions = parseEnumOptions(value)
}

function openRelDialog(): void {
  relDialog.fromTable = userTables.value[0]?.name ?? ''
  relDialog.toTable = userTables.value[1]?.name ?? userTables.value[0]?.name ?? ''
  relDialog.fromField = ''
  relDialog.visible = true
}

async function submitRelation(): Promise<void> {
  if (!relDialog.fromTable || !relDialog.fromField.trim() || !relDialog.toTable) {
    ElMessage.warning('源表、源字段、目标表均为必填')
    return
  }
  relDialog.submitting = true
  try {
    const result = await createRelation(appCode.value, {
      fromTable: relDialog.fromTable,
      fromField: relDialog.fromField.trim(),
      toTable: relDialog.toTable,
    })
    ElMessage.success(`关系已建立（中间表 ${result.throughTable}）`)
    relDialog.visible = false
    await load()
  } finally {
    relDialog.submitting = false
  }
}
</script>

<template>
  <div
    v-loading="loading"
    class="v-app-schema"
  >
    <div class="v-app-schema__header">
      <h3 class="v-app-schema__title">
        结构编辑 · {{ bundle?.app.name ?? appCode }}
      </h3>
      <div>
        <el-button @click="openRelDialog">
          新建关系
        </el-button>
        <el-button
          type="primary"
          @click="openTableDialog"
        >
          新建表
        </el-button>
      </div>
    </div>

    <el-result
      v-if="loadError"
      icon="error"
      title="结构加载失败"
      sub-title="应用不存在或无权访问"
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
      v-else-if="userTables.length === 0 && !loading"
      description="还没有逻辑表，先新建一张"
    />

    <div
      v-else
      class="v-app-schema__tables"
    >
      <el-card
        v-for="table in userTables"
        :key="table.id"
        shadow="never"
        class="v-table-card"
      >
        <div class="v-table-card__head">
          <div>
            <span class="v-table-card__name">{{ table.label }}</span>
            <span class="v-table-card__code">{{ table.name }}</span>
          </div>
          <div>
            <el-button
              size="small"
              @click="openFieldDialog(table.id, table.name)"
            >
              加字段
            </el-button>
            <el-button
              size="small"
              type="danger"
              text
              @click="removeTable(table.id, table.label)"
            >
              删表
            </el-button>
          </div>
        </div>
        <el-table
          :data="table.fields"
          size="small"
          border
        >
          <el-table-column
            prop="label"
            label="字段"
            min-width="120"
          />
          <el-table-column
            prop="name"
            label="标识"
            min-width="120"
          />
          <el-table-column
            label="类型"
            width="100"
          >
            <template #default="{ row }">
              {{ FIELD_TYPE_LABELS[row.type as AppFieldType] }}
            </template>
          </el-table-column>
          <el-table-column
            label="必填"
            width="70"
          >
            <template #default="{ row }">
              {{ row.required ? '是' : '否' }}
            </template>
          </el-table-column>
          <el-table-column
            label="约束"
            min-width="160"
          >
            <template #default="{ row }">
              <span v-if="row.type === 'enum'">
                枚举：{{ enumLabels(row) }}
              </span>
              <span v-else-if="row.type === 'ref'">
                关联 {{ row.refTableName }}{{ row.refMultiple ? '（多值）' : '' }}
              </span>
              <span v-else>—</span>
            </template>
          </el-table-column>
          <el-table-column
            label="操作"
            width="90"
            fixed="right"
          >
            <template #default="{ row }">
              <el-button
                link
                type="danger"
                @click="removeField(row.id, row.label)"
              >
                删除
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>

      <el-card
        v-if="(bundle?.relations ?? []).length > 0"
        shadow="never"
        class="v-table-card"
      >
        <div class="v-table-card__name">
          多对多关系
        </div>
        <el-table
          :data="bundle?.relations ?? []"
          size="small"
          border
        >
          <el-table-column
            prop="fromTable"
            label="源表"
          />
          <el-table-column
            prop="fromField"
            label="源字段"
          />
          <el-table-column
            prop="toTable"
            label="目标表"
          />
          <el-table-column
            prop="throughTable"
            label="中间表"
          />
        </el-table>
      </el-card>
    </div>

    <!-- 新建表 -->
    <el-dialog
      v-model="tableDialog.visible"
      title="新建逻辑表"
      width="720px"
    >
      <el-form label-width="90px">
        <el-form-item
          label="表名"
          required
        >
          <el-input
            v-model="tableDialog.name"
            placeholder="小写字母/数字/下划线，如 book"
          />
        </el-form-item>
        <el-form-item
          label="显示名"
          required
        >
          <el-input
            v-model="tableDialog.label"
            placeholder="如 书"
          />
        </el-form-item>
        <el-form-item label="字段">
          <div class="v-field-rows">
            <div
              v-for="(field, index) in tableDialog.fields"
              :key="index"
              class="v-field-row"
            >
              <el-input
                v-model="field.name"
                placeholder="字段名"
                class="v-field-row__name"
              />
              <el-input
                v-model="field.label"
                placeholder="显示名"
                class="v-field-row__label"
              />
              <el-select
                v-model="field.type"
                class="v-field-row__type"
              >
                <el-option
                  v-for="type in FIELD_TYPES"
                  :key="type"
                  :label="FIELD_TYPE_LABELS[type]"
                  :value="type"
                />
              </el-select>
              <el-checkbox
                :model-value="field.required === 1"
                @update:model-value="setRowRequired(index, $event)"
              >
                必填
              </el-checkbox>
              <el-input
                v-if="field.type === 'ref'"
                v-model="field.refTable"
                placeholder="关联表名"
                class="v-field-row__ref"
              />
              <el-input
                v-if="field.type === 'enum'"
                :model-value="(field.enumOptions ?? []).map((o) => o.value).join(',')"
                placeholder="枚举值逗号分隔"
                class="v-field-row__enum"
                @update:model-value="setRowEnumOptions(index, $event)"
              />
              <el-button
                link
                type="danger"
                @click="removeFieldRow(index)"
              >
                移除
              </el-button>
            </div>
            <el-button
              size="small"
              @click="addFieldRow"
            >
              添加字段
            </el-button>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="tableDialog.visible = false">
          取消
        </el-button>
        <el-button
          type="primary"
          :loading="tableDialog.submitting"
          @click="submitTable"
        >
          创建
        </el-button>
      </template>
    </el-dialog>

    <!-- 加字段 -->
    <el-dialog
      v-model="fieldDialog.visible"
      :title="`给 ${fieldDialog.tableName} 加字段`"
      width="560px"
    >
      <el-form label-width="90px">
        <el-form-item
          label="字段名"
          required
        >
          <el-input v-model="fieldDialog.field.name" />
        </el-form-item>
        <el-form-item
          label="显示名"
          required
        >
          <el-input v-model="fieldDialog.field.label" />
        </el-form-item>
        <el-form-item label="类型">
          <el-select v-model="fieldDialog.field.type">
            <el-option
              v-for="type in FIELD_TYPES"
              :key="type"
              :label="FIELD_TYPE_LABELS[type]"
              :value="type"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="必填">
          <el-switch
            :model-value="fieldDialog.field.required === 1"
            @update:model-value="setFieldRequired($event)"
          />
        </el-form-item>
        <el-form-item
          v-if="fieldDialog.field.type === 'ref'"
          label="关联表"
        >
          <el-input
            v-model="fieldDialog.field.refTable"
            placeholder="目标表名（多对一）"
          />
        </el-form-item>
        <el-form-item
          v-if="fieldDialog.field.type === 'enum'"
          label="枚举值"
        >
          <el-input
            :model-value="(fieldDialog.field.enumOptions ?? []).map((o) => o.value).join(',')"
            placeholder="逗号分隔，如 want,reading,read"
            @update:model-value="setFieldEnumOptions($event)"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="fieldDialog.visible = false">
          取消
        </el-button>
        <el-button
          type="primary"
          :loading="fieldDialog.submitting"
          @click="submitField"
        >
          新增
        </el-button>
      </template>
    </el-dialog>

    <!-- 新建关系 -->
    <el-dialog
      v-model="relDialog.visible"
      title="新建多对多关系"
      width="520px"
    >
      <el-form label-width="90px">
        <el-form-item label="源表">
          <el-select v-model="relDialog.fromTable">
            <el-option
              v-for="table in userTables"
              :key="table.id"
              :label="table.name"
              :value="table.name"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="源字段">
          <el-input
            v-model="relDialog.fromField"
            placeholder="如 tag_ids（不存在则自动创建）"
          />
        </el-form-item>
        <el-form-item label="目标表">
          <el-select v-model="relDialog.toTable">
            <el-option
              v-for="table in userTables"
              :key="table.id"
              :label="table.name"
              :value="table.name"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="relDialog.visible = false">
          取消
        </el-button>
        <el-button
          type="primary"
          :loading="relDialog.submitting"
          @click="submitRelation"
        >
          创建
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.v-app-schema__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.v-app-schema__title {
  margin: 0;
}
.v-app-schema__tables {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.v-table-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.v-table-card__name {
  font-weight: 600;
  margin-right: 8px;
}
.v-table-card__code {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.v-field-rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}
.v-field-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.v-field-row__name,
.v-field-row__label {
  width: 120px;
}
.v-field-row__type,
.v-field-row__ref {
  width: 120px;
}
.v-field-row__enum {
  width: 180px;
}
</style>
