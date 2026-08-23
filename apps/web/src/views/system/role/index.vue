<template>
  <div class="v-page">
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
        <el-form-item label="角色名">
          <el-input
            v-model="query.name"
            placeholder="请输入角色名"
            clearable
          />
        </el-form-item>
        <el-form-item label="状态">
          <el-select
            v-model="query.status"
            placeholder="全部"
            clearable
            style="width: 120px"
          >
            <el-option
              label="启用"
              :value="1"
            />
            <el-option
              label="禁用"
              :value="0"
            />
          </el-select>
        </el-form-item>
      </template>

      <template #toolbar>
        <el-button
          v-permission="'system:role:create'"
          type="primary"
          :icon="Plus"
          @click="openCreate"
        >
          新增角色
        </el-button>
      </template>

      <el-table-column
        prop="name"
        label="角色名"
        min-width="140"
      />
      <el-table-column
        prop="code"
        label="标识"
        min-width="140"
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
        width="220"
        fixed="right"
      >
        <template #default="{ row }">
          <!-- admin 角色受保护：不展示编辑/分配权限/删除 -->
          <template v-if="row.code !== 'admin'">
            <el-button
              v-permission="'system:role:update'"
              link
              type="primary"
              @click="openEdit(row)"
            >
              编辑
            </el-button>
            <el-button
              v-permission="'system:role:assign-menu'"
              link
              type="primary"
              @click="openAssign(row)"
            >
              分配权限
            </el-button>
            <el-button
              v-permission="'system:role:delete'"
              link
              type="danger"
              @click="handleDelete(row)"
            >
              删除
            </el-button>
          </template>
        </template>
      </el-table-column>
    </ProTable>

    <FormDialog
      v-model="dialogVisible"
      :title="isEdit ? '编辑角色' : '新增角色'"
      :form="form"
      :rules="rules"
      :submitting="submitting"
      @submit="handleSubmit"
    >
      <el-form-item
        label="角色名"
        prop="name"
      >
        <el-input
          v-model="form.name"
          placeholder="请输入角色名"
        />
      </el-form-item>
      <el-form-item
        label="标识"
        prop="code"
      >
        <el-input
          v-model="form.code"
          placeholder="小写字母、数字、下划线、中划线"
          :disabled="isEdit"
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
      <el-form-item label="备注">
        <el-input
          v-model="form.remark"
          type="textarea"
          :rows="3"
          placeholder="请输入备注"
        />
      </el-form-item>
    </FormDialog>

    <!-- 分配权限抽屉：菜单树勾选（父子联动，含按钮级叶子节点） -->
    <el-drawer
      v-model="assignVisible"
      :title="`分配权限 - ${assignRole?.name ?? ''}`"
      size="420px"
    >
      <div
        v-loading="assignLoading"
        class="v-assign-tree"
      >
        <el-tree
          ref="treeRef"
          :data="menuTree"
          :props="{ label: 'name', children: 'children' }"
          show-checkbox
          node-key="id"
          default-expand-all
        />
      </div>
      <template #footer>
        <el-button @click="assignVisible = false">
          取 消
        </el-button>
        <el-button
          type="primary"
          :loading="assignSubmitting"
          @click="handleAssignSave"
        >
          保 存
        </el-button>
      </template>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { nextTick, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, ElTree } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import dayjs from 'dayjs'
import {
  assignRoleMenus,
  createRole,
  deleteRole,
  getRoleMenuIds,
  getRolePage,
  updateRole,
} from '@/api/system/role'
import { getMenuList } from '@/api/system/menu'
import FormDialog from '@/components/FormDialog/index.vue'
import ProTable from '@/components/ProTable/index.vue'
import { useTable } from '@/hooks/useTable'
import type { MenuItem, RoleItem } from '@/types/api'
import { listToTree } from '@/utils/tree'

interface RolePageQuery extends Record<string, unknown> {
  name?: string
  status?: number
}

const {
  loading,
  list,
  total,
  pageNo,
  pageSize,
  loadError,
  query,
  load,
  search,
  reset,
  handlePageChange,
  handleSizeChange,
} = useTable<RoleItem, RolePageQuery>({
  fetchApi: getRolePage,
  query: { name: undefined, status: undefined },
})

function formatTime(t: string) {
  return dayjs(t).format('YYYY-MM-DD HH:mm:ss')
}

// ========== 新增 / 编辑 ==========
const dialogVisible = ref(false)
const submitting = ref(false)
const isEdit = ref(false)
const editingId = ref<string>('')
const form = reactive({ name: '', code: '', sort: 0, status: 1, remark: '' })

const rules = {
  name: [{ required: true, message: '请输入角色名', trigger: 'blur' }],
  code: [
    { required: true, message: '请输入角色标识', trigger: 'blur' },
    { pattern: /^[a-z0-9_-]+$/, message: '仅支持小写字母、数字、下划线、中划线', trigger: 'blur' },
  ],
}

function openCreate() {
  isEdit.value = false
  editingId.value = ''
  form.name = ''
  form.code = ''
  form.sort = 0
  form.status = 1
  form.remark = ''
  dialogVisible.value = true
}

function openEdit(row: RoleItem) {
  isEdit.value = true
  editingId.value = row.id
  form.name = row.name
  form.code = row.code
  form.sort = row.sort
  form.status = row.status
  form.remark = row.remark ?? ''
  dialogVisible.value = true
}

async function handleSubmit() {
  submitting.value = true
  try {
    const payload = { ...form }
    if (isEdit.value) {
      await updateRole(editingId.value, payload)
      ElMessage.success('编辑成功')
    } else {
      await createRole(payload)
      ElMessage.success('新增成功')
    }
    dialogVisible.value = false
    load()
  } finally {
    submitting.value = false
  }
}

// ========== 删除（后端校验：被用户引用时禁删） ==========
async function handleDelete(row: RoleItem) {
  await ElMessageBox.confirm(`确认删除角色「${row.name}」吗？`, '提示', { type: 'warning' })
  await deleteRole(row.id)
  ElMessage.success('删除成功')
  load()
}

// ========== 分配权限（菜单树勾选） ==========
const assignVisible = ref(false)
const assignLoading = ref(false)
const assignSubmitting = ref(false)
const assignRole = ref<RoleItem | null>(null)
const menuTree = ref<MenuItem[]>([])
const treeRef = ref<InstanceType<typeof ElTree>>()

async function openAssign(row: RoleItem) {
  assignRole.value = row
  assignVisible.value = true
  assignLoading.value = true
  try {
    const [menus, checkedIds] = await Promise.all([getMenuList(), getRoleMenuIds(row.id)])
    menuTree.value = listToTree(menus)
    // 父子联动模式下只能回显叶子节点：直接勾选父节点会级联选中其全部子节点，
    // 故过滤掉父级 id，仅 setCheckedKeys 叶子（按钮）节点，父级由半选状态自然呈现
    const parentIds = new Set(menus.map((m) => m.parentId))
    const leafIds = checkedIds.filter((id) => !parentIds.has(id))
    await nextTick()
    treeRef.value?.setCheckedKeys(leafIds)
  } finally {
    assignLoading.value = false
  }
}

async function handleAssignSave() {
  const role = assignRole.value
  if (!role || !treeRef.value) return
  assignSubmitting.value = true
  try {
    // 全选（叶子/按钮）+ 半选（目录/菜单父级）合并提交
    const menuIds = [...treeRef.value.getCheckedKeys(), ...treeRef.value.getHalfCheckedKeys()].map(
      Number,
    )
    await assignRoleMenus(role.id, menuIds)
    ElMessage.success('分配成功')
    assignVisible.value = false
  } finally {
    assignSubmitting.value = false
  }
}
</script>

<style scoped>
.v-assign-tree {
  height: 100%;
  overflow: auto;
}
</style>
