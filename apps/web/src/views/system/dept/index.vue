<template>
  <div class="v-page">
    <ProTable
      :data="treeData"
      :loading="loading"
      :load-error="loadError"
      :pagination="false"
      row-key="id"
      :tree-props="{ children: 'children' }"
      default-expand-all
      @retry="load"
    >
      <template #toolbar>
        <el-button
          v-permission="'system:dept:create'"
          type="primary"
          :icon="Plus"
          @click="openCreate()"
        >
          新增部门
        </el-button>
      </template>

      <el-table-column
        prop="name"
        label="部门名称"
        min-width="200"
      />
      <el-table-column
        prop="sort"
        label="排序"
        width="80"
        align="center"
      />
      <el-table-column
        label="状态"
        width="90"
        align="center"
      >
        <template #default="{ row }">
          <el-tag :type="row.status === 1 ? 'success' : 'info'">
            {{ row.status === 1 ? '启用' : '禁用' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column
        prop="createdAt"
        label="创建时间"
        width="180"
      >
        <template #default="{ row }">
          {{ formatTime(row.createdAt) }}
        </template>
      </el-table-column>
      <el-table-column
        label="操作"
        width="200"
        fixed="right"
      >
        <template #default="{ row }">
          <el-button
            v-permission="'system:dept:create'"
            link
            type="primary"
            @click="openCreate(row)"
          >
            新增子级
          </el-button>
          <el-button
            v-permission="'system:dept:update'"
            link
            type="primary"
            @click="openEdit(row)"
          >
            编辑
          </el-button>
          <el-button
            v-permission="'system:dept:delete'"
            link
            type="danger"
            @click="handleDelete(row)"
          >
            删除
          </el-button>
        </template>
      </el-table-column>
    </ProTable>

    <FormDialog
      v-model="dialogVisible"
      :title="isEdit ? '编辑部门' : '新增部门'"
      :form="form"
      :rules="rules"
      :submitting="submitting"
      @submit="handleSubmit"
    >
      <el-form-item label="父部门">
        <el-tree-select
          v-model="form.parentId"
          :data="parentOptions"
          :props="{ label: 'name', value: 'id', children: 'children' }"
          check-strictly
          :render-after-expand="false"
          placeholder="留空为根部门"
          clearable
          style="width: 100%"
        />
      </el-form-item>
      <el-form-item
        label="部门名称"
        prop="name"
      >
        <el-input
          v-model="form.name"
          placeholder="请输入部门名称"
        />
      </el-form-item>
      <el-form-item label="排序">
        <el-input-number
          v-model="form.sort"
          :min="0"
        />
      </el-form-item>
      <el-form-item label="状态">
        <el-radio-group v-model="form.status">
          <el-radio :value="1">
            启用
          </el-radio>
          <el-radio :value="0">
            禁用
          </el-radio>
        </el-radio-group>
      </el-form-item>
    </FormDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import dayjs from 'dayjs'
import { createDept, deleteDept, getDeptList, updateDept } from '@/api/system/dept'
import FormDialog from '@/components/FormDialog/index.vue'
import ProTable from '@/components/ProTable/index.vue'
import type { DeptItem } from '@/types/api'
import { listToTree } from '@/utils/tree'

const loading = ref(false)
const loadError = ref(false)
const list = ref<DeptItem[]>([])

const treeData = computed(() => listToTree(list.value))

async function load() {
  loading.value = true
  loadError.value = false
  try {
    list.value = await getDeptList()
  } catch {
    list.value = []
    loadError.value = true
  } finally {
    loading.value = false
  }
}
load()

// 父级下拉选项（排除自身编辑时的循环在提交时校验，这里仅提供树）
const parentOptions = computed(() => treeData.value)

const dialogVisible = ref(false)
const submitting = ref(false)
const isEdit = ref(false)
const editingId = ref<string>('')
// parentId 保持字符串与 tree-select 选项 value（id 为字符串）一致，提交时再转 number
const form = reactive({ parentId: undefined as string | undefined, name: '', sort: 0, status: 1 })

const rules = {
  name: [{ required: true, message: '请输入部门名称', trigger: 'blur' }],
}

function formatTime(t: string) {
  return dayjs(t).format('YYYY-MM-DD HH:mm:ss')
}

function openCreate(parent?: DeptItem) {
  isEdit.value = false
  editingId.value = ''
  form.parentId = parent ? parent.id : undefined
  form.name = ''
  form.sort = 0
  form.status = 1
  dialogVisible.value = true
}

function openEdit(row: DeptItem) {
  isEdit.value = true
  editingId.value = row.id
  form.parentId = row.parentId === '0' ? undefined : row.parentId
  form.name = row.name
  form.sort = row.sort
  form.status = row.status
  dialogVisible.value = true
}

async function handleSubmit() {
  submitting.value = true
  try {
    const payload = { ...form, parentId: form.parentId !== undefined ? Number(form.parentId) : 0 }
    if (isEdit.value) {
      await updateDept(editingId.value, payload)
      ElMessage.success('编辑成功')
    } else {
      await createDept(payload)
      ElMessage.success('新增成功')
    }
    dialogVisible.value = false
    load()
  } finally {
    submitting.value = false
  }
}

async function handleDelete(row: DeptItem) {
  await ElMessageBox.confirm(`确认删除部门「${row.name}」吗？`, '提示', { type: 'warning' })
  await deleteDept(row.id)
  ElMessage.success('删除成功')
  load()
}
</script>
