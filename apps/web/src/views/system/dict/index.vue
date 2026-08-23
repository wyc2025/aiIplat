<template>
  <div class="v-dict">
    <!-- 左：字典类型 -->
    <div class="v-type-panel">
      <ProTable
        :data="typeList"
        :loading="typeLoading"
        :load-error="typeLoadError"
        :total="typeTotal"
        :page-no="typePageNo"
        :page-size="typePageSize"
        highlight-current-row
        @search="typeSearch"
        @reset="typeReset"
        @retry="typeLoad"
        @page-change="handleTypePageChange"
        @size-change="handleTypeSizeChange"
        @current-change="handleTypeChange"
      >
        <template #search>
          <el-form-item label="字典名称">
            <el-input
              v-model="typeQuery.name"
              placeholder="请输入字典名称"
              clearable
              style="width: 160px"
            />
          </el-form-item>
        </template>

        <template #toolbar>
          <el-button
            v-permission="'system:dict:create'"
            type="primary"
            :icon="Plus"
            @click="openTypeCreate"
          >
            新增类型
          </el-button>
        </template>

        <el-table-column
          prop="name"
          label="字典名称"
          min-width="110"
          show-overflow-tooltip
        />
        <el-table-column
          prop="type"
          label="类型标识"
          min-width="120"
          show-overflow-tooltip
        />
        <el-table-column
          label="状态"
          width="76"
          align="center"
        >
          <template #default="{ row }">
            <el-tag
              :type="row.status === 1 ? 'success' : 'info'"
              size="small"
            >
              {{ row.status === 1 ? '启用' : '禁用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column
          label="操作"
          width="110"
          fixed="right"
        >
          <template #default="{ row }">
            <el-button
              v-permission="'system:dict:update'"
              link
              type="primary"
              @click.stop="openTypeEdit(row)"
            >
              编辑
            </el-button>
            <el-button
              v-permission="'system:dict:delete'"
              link
              type="danger"
              @click.stop="handleTypeDelete(row)"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
      </ProTable>
    </div>

    <!-- 右：字典数据 -->
    <div class="v-data-panel">
      <template v-if="currentType">
        <ProTable
          :data="dataList"
          :loading="dataLoading"
          :load-error="dataLoadError"
          :pagination="false"
          @retry="loadData"
        >
          <template #toolbar>
            <el-button
              v-permission="'system:dict:create'"
              type="primary"
              :icon="Plus"
              @click="openDataCreate"
            >
              新增字典数据
            </el-button>
            <span class="v-current-type">当前类型：{{ currentType.name }}（{{ currentType.type }}）</span>
          </template>

          <el-table-column
            prop="label"
            label="标签"
            min-width="120"
            show-overflow-tooltip
          />
          <el-table-column
            prop="value"
            label="值"
            min-width="100"
            show-overflow-tooltip
          />
          <el-table-column
            prop="sort"
            label="排序"
            width="70"
            align="center"
          />
          <el-table-column
            label="状态"
            width="80"
            align="center"
          >
            <template #default="{ row }">
              <el-tag
                :type="row.status === 1 ? 'success' : 'info'"
                size="small"
              >
                {{ row.status === 1 ? '启用' : '禁用' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column
            prop="remark"
            label="备注"
            min-width="140"
            show-overflow-tooltip
          >
            <template #default="{ row }">
              {{ row.remark ?? '-' }}
            </template>
          </el-table-column>
          <el-table-column
            label="操作"
            width="110"
            fixed="right"
          >
            <template #default="{ row }">
              <el-button
                v-permission="'system:dict:update'"
                link
                type="primary"
                @click="openDataEdit(row)"
              >
                编辑
              </el-button>
              <el-button
                v-permission="'system:dict:delete'"
                link
                type="danger"
                @click="handleDataDelete(row)"
              >
                删除
              </el-button>
            </template>
          </el-table-column>
        </ProTable>
      </template>
      <div
        v-else
        class="v-data-empty"
      >
        <el-empty description="请先选择左侧字典类型" />
      </div>
    </div>

    <!-- 类型新增/编辑弹窗 -->
    <FormDialog
      v-model="typeDialogVisible"
      :title="typeIsEdit ? '编辑字典类型' : '新增字典类型'"
      :form="typeForm"
      :rules="typeRules"
      :submitting="typeSubmitting"
      @submit="handleTypeSubmit"
    >
      <el-form-item
        label="字典名称"
        prop="name"
      >
        <el-input
          v-model="typeForm.name"
          placeholder="请输入字典名称"
        />
      </el-form-item>
      <el-form-item
        label="类型标识"
        prop="type"
      >
        <el-input
          v-model="typeForm.type"
          :disabled="typeIsEdit"
          placeholder="小写字母、数字、下划线，如 sys_user_gender"
        />
      </el-form-item>
      <el-form-item label="状态">
        <el-radio-group v-model="typeForm.status">
          <el-radio :value="1">
            启用
          </el-radio>
          <el-radio :value="0">
            禁用
          </el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="备注">
        <el-input
          v-model="typeForm.remark"
          type="textarea"
          :rows="2"
          placeholder="请输入备注"
        />
      </el-form-item>
    </FormDialog>

    <!-- 数据新增/编辑弹窗 -->
    <FormDialog
      v-model="dataDialogVisible"
      :title="dataIsEdit ? '编辑字典数据' : '新增字典数据'"
      :form="dataForm"
      :rules="dataRules"
      :submitting="dataSubmitting"
      @submit="handleDataSubmit"
    >
      <el-form-item
        label="标签"
        prop="label"
      >
        <el-input
          v-model="dataForm.label"
          placeholder="请输入标签"
        />
      </el-form-item>
      <el-form-item
        label="值"
        prop="value"
      >
        <el-input
          v-model="dataForm.value"
          placeholder="请输入值"
        />
      </el-form-item>
      <el-form-item label="排序">
        <el-input-number
          v-model="dataForm.sort"
          :min="0"
        />
      </el-form-item>
      <el-form-item label="状态">
        <el-radio-group v-model="dataForm.status">
          <el-radio :value="1">
            启用
          </el-radio>
          <el-radio :value="0">
            禁用
          </el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="备注">
        <el-input
          v-model="dataForm.remark"
          type="textarea"
          :rows="2"
          placeholder="请输入备注"
        />
      </el-form-item>
    </FormDialog>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import {
  createDictData,
  createDictType,
  deleteDictData,
  deleteDictType,
  getDictDataList,
  getDictTypePage,
  updateDictData,
  updateDictType,
} from '@/api/system/dict'
import FormDialog from '@/components/FormDialog/index.vue'
import ProTable from '@/components/ProTable/index.vue'
import { useTable } from '@/hooks/useTable'
import type { DictDataItem, DictTypeItem } from '@/types/api'

// ========== 左：字典类型（分页，三态由 useTable/ProTable 驱动） ==========
const {
  list: typeList,
  total: typeTotal,
  pageNo: typePageNo,
  pageSize: typePageSize,
  loading: typeLoading,
  loadError: typeLoadError,
  query: typeQuery,
  load: typeLoad,
  search: typeSearch,
  reset: typeReset,
  handlePageChange: handleTypePageChange,
  handleSizeChange: handleTypeSizeChange,
} = useTable<DictTypeItem, { name?: string }>({
  fetchApi: getDictTypePage,
  query: { name: undefined },
})

// 当前选中类型（current-change 在刷新时会触发空值，忽略以保持选中）
const currentType = ref<DictTypeItem | null>(null)

function handleTypeChange(row: DictTypeItem | null) {
  if (!row) return
  currentType.value = row
  loadData()
}

// ========== 右：字典数据（不分页） ==========
const dataList = ref<DictDataItem[]>([])
const dataLoading = ref(false)
const dataLoadError = ref(false)

async function loadData() {
  if (!currentType.value) return
  dataLoading.value = true
  dataLoadError.value = false
  try {
    dataList.value = await getDictDataList(currentType.value.id)
  } catch {
    dataList.value = []
    dataLoadError.value = true
  } finally {
    dataLoading.value = false
  }
}

// ========== 类型新增/编辑 ==========
const typeDialogVisible = ref(false)
const typeSubmitting = ref(false)
const typeIsEdit = ref(false)
const typeEditingId = ref<string>('')
const typeForm = reactive({ name: '', type: '', status: 1, remark: '' })

const typeRules = {
  name: [{ required: true, message: '请输入字典名称', trigger: 'blur' }],
  type: [
    { required: true, message: '请输入类型标识', trigger: 'blur' },
    { pattern: /^[a-z0-9_]+$/, message: '仅支持小写字母、数字、下划线', trigger: 'blur' },
  ],
}

function openTypeCreate() {
  typeIsEdit.value = false
  typeEditingId.value = ''
  typeForm.name = ''
  typeForm.type = ''
  typeForm.status = 1
  typeForm.remark = ''
  typeDialogVisible.value = true
}

function openTypeEdit(row: DictTypeItem) {
  typeIsEdit.value = true
  typeEditingId.value = row.id
  typeForm.name = row.name
  typeForm.type = row.type
  typeForm.status = row.status
  typeForm.remark = row.remark ?? ''
  typeDialogVisible.value = true
}

async function handleTypeSubmit() {
  typeSubmitting.value = true
  try {
    const payload = { name: typeForm.name, status: typeForm.status, remark: typeForm.remark || undefined }
    if (typeIsEdit.value) {
      await updateDictType(typeEditingId.value, payload)
      ElMessage.success('编辑成功')
      // 同步右侧标题展示
      if (currentType.value?.id === typeEditingId.value) {
        currentType.value = { ...currentType.value, name: typeForm.name }
      }
    } else {
      await createDictType({ ...payload, type: typeForm.type })
      ElMessage.success('新增成功')
    }
    typeDialogVisible.value = false
    typeLoad()
  } finally {
    typeSubmitting.value = false
  }
}

async function handleTypeDelete(row: DictTypeItem) {
  await ElMessageBox.confirm(`确认删除字典类型「${row.name}」吗？`, '提示', { type: 'warning' })
  await deleteDictType(row.id)
  ElMessage.success('删除成功')
  if (currentType.value?.id === row.id) {
    currentType.value = null
    dataList.value = []
  }
  typeLoad()
}

// ========== 数据新增/编辑 ==========
const dataDialogVisible = ref(false)
const dataSubmitting = ref(false)
const dataIsEdit = ref(false)
const dataEditingId = ref<string>('')
const dataForm = reactive({ label: '', value: '', sort: 0, status: 1, remark: '' })

const dataRules = {
  label: [{ required: true, message: '请输入标签', trigger: 'blur' }],
  value: [{ required: true, message: '请输入值', trigger: 'blur' }],
}

function openDataCreate() {
  dataIsEdit.value = false
  dataEditingId.value = ''
  dataForm.label = ''
  dataForm.value = ''
  dataForm.sort = 0
  dataForm.status = 1
  dataForm.remark = ''
  dataDialogVisible.value = true
}

function openDataEdit(row: DictDataItem) {
  dataIsEdit.value = true
  dataEditingId.value = row.id
  dataForm.label = row.label
  dataForm.value = row.value
  dataForm.sort = row.sort
  dataForm.status = row.status
  dataForm.remark = row.remark ?? ''
  dataDialogVisible.value = true
}

async function handleDataSubmit() {
  if (!currentType.value) return
  dataSubmitting.value = true
  try {
    const payload = {
      label: dataForm.label,
      value: dataForm.value,
      sort: dataForm.sort,
      status: dataForm.status,
      remark: dataForm.remark || undefined,
    }
    if (dataIsEdit.value) {
      await updateDictData(dataEditingId.value, payload)
      ElMessage.success('编辑成功')
    } else {
      await createDictData({ ...payload, typeId: Number(currentType.value.id) })
      ElMessage.success('新增成功')
    }
    dataDialogVisible.value = false
    loadData()
  } finally {
    dataSubmitting.value = false
  }
}

async function handleDataDelete(row: DictDataItem) {
  await ElMessageBox.confirm(`确认删除字典数据「${row.label}」吗？`, '提示', { type: 'warning' })
  await deleteDictData(row.id)
  ElMessage.success('删除成功')
  loadData()
}
</script>

<style scoped>
.v-dict {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}
.v-type-panel {
  width: 460px;
  flex-shrink: 0;
}
.v-data-panel {
  flex: 1;
  min-width: 0;
}
.v-data-empty {
  background: #fff;
  border-radius: 6px;
  padding: 48px 16px;
}
.v-current-type {
  margin-left: auto;
  font-size: 13px;
  color: #909399;
  align-self: center;
}
</style>
