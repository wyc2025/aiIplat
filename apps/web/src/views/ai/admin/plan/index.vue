<template>
  <div>
    <ProTable
      :data="list"
      :loading="loading"
      :load-error="loadError"
      :total="total"
      :page-no="pageNo"
      :page-size="pageSize"
      @search="search"
      @reset="reset"
      @retry="load"
      @page-change="handlePageChange"
      @size-change="handleSizeChange"
    >
      <template #search>
        <el-form-item label="套餐名称">
          <el-input
            v-model="query.name"
            placeholder="请输入套餐名称"
            clearable
            style="width: 180px"
          />
        </el-form-item>
      </template>

      <template #toolbar>
        <el-button
          v-permission="'ai:plan:create'"
          type="primary"
          :icon="Plus"
          @click="openCreate"
        >
          新增套餐
        </el-button>
      </template>

      <el-table-column
        prop="name"
        label="套餐名称"
        min-width="120"
        show-overflow-tooltip
      />
      <el-table-column
        prop="code"
        label="标识"
        min-width="100"
        show-overflow-tooltip
      />
      <el-table-column
        prop="monthlyCredits"
        label="月积分"
        width="110"
        align="right"
      />
      <el-table-column
        prop="price"
        label="价格"
        width="90"
        align="right"
      >
        <template #default="{ row }">
          {{ Number(row.price) > 0 ? `¥${row.price}` : '免费' }}
        </template>
      </el-table-column>
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
        prop="activeSubscribers"
        label="生效订阅"
        width="90"
        align="right"
      />
      <el-table-column
        prop="sort"
        label="排序"
        width="70"
        align="center"
      />
      <el-table-column
        label="操作"
        width="220"
        fixed="right"
      >
        <template #default="{ row }">
          <el-button
            v-permission="'ai:plan:update'"
            link
            type="primary"
            @click="openEdit(row)"
          >
            编辑
          </el-button>
          <el-button
            v-permission="'ai:plan:assign'"
            link
            type="primary"
            @click="openAssign(row)"
          >
            指派用户
          </el-button>
          <el-button
            v-permission="'ai:plan:delete'"
            link
            type="danger"
            @click="handleDelete(row)"
          >
            删除
          </el-button>
        </template>
      </el-table-column>
    </ProTable>

    <!-- 新增/编辑弹窗 -->
    <FormDialog
      v-model="dialogVisible"
      :title="isEdit ? '编辑套餐' : '新增套餐'"
      :form="form"
      :rules="rules"
      :submitting="submitting"
      label-width="110px"
      @submit="handleSubmit"
    >
      <el-form-item
        label="套餐名称"
        prop="name"
      >
        <el-input
          v-model="form.name"
          placeholder="如 标准版"
        />
      </el-form-item>
      <el-form-item
        label="标识"
        prop="code"
      >
        <el-input
          v-model="form.code"
          :disabled="isEdit"
          placeholder="小写字母/数字，如 standard"
        />
      </el-form-item>
      <el-form-item
        label="月积分额度"
        prop="monthlyCredits"
      >
        <el-input-number
          v-model="form.monthlyCredits"
          :min="0"
          style="width: 100%"
        />
      </el-form-item>
      <el-form-item label="价格">
        <el-input-number
          v-model="form.price"
          :min="0"
          :precision="2"
          style="width: 100%"
        />
      </el-form-item>
      <el-form-item label="说明">
        <el-input
          v-model="form.description"
          type="textarea"
          :rows="2"
          placeholder="套餐说明（选填）"
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
      <el-form-item label="排序">
        <el-input-number
          v-model="form.sort"
          :min="0"
        />
      </el-form-item>
    </FormDialog>

    <!-- 指派用户弹窗 -->
    <FormDialog
      v-model="assignVisible"
      :title="`指派套餐「${assignPlanName}」给用户`"
      :form="assignForm"
      :rules="assignRules"
      :submitting="assignSubmitting"
      label-width="90px"
      @submit="handleAssignSubmit"
    >
      <el-form-item
        label="选择用户"
        prop="userId"
      >
        <el-select
          v-model="assignForm.userId"
          placeholder="搜索用户名"
          filterable
          remote
          :remote-method="searchUsers"
          :loading="userSearchLoading"
          style="width: 100%"
        >
          <el-option
            v-for="u in userOptions"
            :key="u.id"
            :label="`${u.nickname}（${u.username}）`"
            :value="Number(u.id)"
          />
        </el-select>
      </el-form-item>
    </FormDialog>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import ProTable from '@/components/ProTable/index.vue'
import FormDialog from '@/components/FormDialog/index.vue'
import {
  assignPlan,
  createPlan,
  deletePlan,
  getPlanPage,
  updatePlan,
  type PlanAdminItem,
} from '@/api/ai/plan'
import { getUserPage } from '@/api/system/user'
import type { UserRow } from '@/types/api'
import { useTable } from '@/hooks/useTable'

// ========== 列表 ==========
const { loading, list, total, pageNo, pageSize, loadError, query, load, search, reset, handlePageChange, handleSizeChange } =
  useTable<PlanAdminItem, { name?: string }>({
    fetchApi: getPlanPage,
    query: { name: undefined },
  })

// ========== 新增/编辑 ==========
const dialogVisible = ref(false)
const isEdit = ref(false)
const submitting = ref(false)
const form = reactive({
  id: '',
  name: '',
  code: '',
  monthlyCredits: 10000,
  price: 0,
  description: '',
  status: 1,
  sort: 0,
})
const rules = {
  name: [{ required: true, message: '请输入套餐名称', trigger: 'blur' }],
  code: [
    { required: true, message: '请输入套餐标识', trigger: 'blur' },
    { pattern: /^[a-z0-9_-]+$/, message: '仅支持小写字母、数字、下划线、中划线', trigger: 'blur' },
  ],
  monthlyCredits: [{ required: true, message: '请输入月积分额度', trigger: 'blur' }],
}

function openCreate() {
  isEdit.value = false
  Object.assign(form, { id: '', name: '', code: '', monthlyCredits: 10000, price: 0, description: '', status: 1, sort: 0 })
  dialogVisible.value = true
}

function openEdit(row: PlanAdminItem) {
  isEdit.value = true
  Object.assign(form, {
    id: row.id,
    name: row.name,
    code: row.code,
    monthlyCredits: Number(row.monthlyCredits),
    price: Number(row.price),
    description: row.description ?? '',
    status: row.status,
    sort: row.sort,
  })
  dialogVisible.value = true
}

async function handleSubmit() {
  submitting.value = true
  try {
    if (isEdit.value) {
      await updatePlan(form.id, {
        name: form.name,
        monthlyCredits: form.monthlyCredits,
        price: form.price,
        description: form.description,
        status: form.status,
        sort: form.sort,
      })
      ElMessage.success('编辑成功')
    } else {
      await createPlan({
        name: form.name,
        code: form.code,
        monthlyCredits: form.monthlyCredits,
        price: form.price,
        description: form.description,
        status: form.status,
        sort: form.sort,
      })
      ElMessage.success('新增成功')
    }
    dialogVisible.value = false
    load()
  } finally {
    submitting.value = false
  }
}

async function handleDelete(row: PlanAdminItem) {
  await ElMessageBox.confirm(`确认删除套餐「${row.name}」吗？`, '提示', { type: 'warning' })
  await deletePlan(row.id)
  ElMessage.success('删除成功')
  load()
}

// ========== 指派用户 ==========
const assignVisible = ref(false)
const assignSubmitting = ref(false)
const assignPlanId = ref('')
const assignPlanName = ref('')
const assignForm = reactive({ userId: undefined as number | undefined })
const assignRules = {
  userId: [{ required: true, message: '请选择用户', trigger: 'change' }],
}
const userOptions = ref<UserRow[]>([])
const userSearchLoading = ref(false)

function openAssign(row: PlanAdminItem) {
  assignPlanId.value = row.id
  assignPlanName.value = row.name
  assignForm.userId = undefined
  userOptions.value = []
  assignVisible.value = true
  searchUsers('')
}

async function searchUsers(keyword: string) {
  userSearchLoading.value = true
  try {
    const result = await getUserPage({ username: keyword || undefined, pageNo: 1, pageSize: 20, status: 1 })
    userOptions.value = result.list
  } catch {
    userOptions.value = []
  } finally {
    userSearchLoading.value = false
  }
}

async function handleAssignSubmit() {
  if (!assignForm.userId) return
  assignSubmitting.value = true
  try {
    await assignPlan({ userId: assignForm.userId, planId: Number(assignPlanId.value) })
    ElMessage.success('指派成功')
    assignVisible.value = false
    load()
  } finally {
    assignSubmitting.value = false
  }
}
</script>
