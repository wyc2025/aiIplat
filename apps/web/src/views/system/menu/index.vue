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
          v-permission="'system:menu:create'"
          type="primary"
          :icon="Plus"
          @click="openCreate()"
        >
          新增菜单
        </el-button>
      </template>

      <el-table-column
        prop="name"
        label="菜单名称"
        min-width="180"
      />
      <el-table-column
        label="图标"
        width="70"
        align="center"
      >
        <template #default="{ row }">
          <el-icon v-if="row.icon">
            <component :is="row.icon" />
          </el-icon>
        </template>
      </el-table-column>
      <el-table-column
        label="类型"
        width="90"
        align="center"
      >
        <template #default="{ row }">
          <el-tag :type="typeTagMap[row.type]?.tag ?? 'info'">
            {{ typeTagMap[row.type]?.label ?? '未知' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column
        prop="path"
        label="路由地址"
        min-width="140"
        show-overflow-tooltip
      />
      <el-table-column
        prop="component"
        label="组件路径"
        min-width="160"
        show-overflow-tooltip
      />
      <el-table-column
        prop="perms"
        label="权限标识"
        min-width="180"
        show-overflow-tooltip
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
        label="操作"
        width="200"
        fixed="right"
      >
        <template #default="{ row }">
          <el-button
            v-if="row.type !== 3"
            v-permission="'system:menu:create'"
            link
            type="primary"
            @click="openCreate(row)"
          >
            新增子级
          </el-button>
          <el-button
            v-permission="'system:menu:update'"
            link
            type="primary"
            @click="openEdit(row)"
          >
            编辑
          </el-button>
          <el-button
            v-permission="'system:menu:delete'"
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
      :title="isEdit ? '编辑菜单' : '新增菜单'"
      :form="form"
      :rules="rules"
      :submitting="submitting"
      @submit="handleSubmit"
    >
      <el-form-item label="父级菜单">
        <el-tree-select
          v-model="form.parentId"
          :data="parentOptions"
          :props="{ label: 'name', value: 'id', children: 'children' }"
          check-strictly
          :render-after-expand="false"
          placeholder="留空为根节点"
          clearable
          style="width: 100%"
        />
      </el-form-item>
      <el-form-item
        label="类型"
        prop="type"
      >
        <el-radio-group v-model="form.type">
          <el-radio :value="1">
            目录
          </el-radio>
          <el-radio :value="2">
            菜单
          </el-radio>
          <el-radio :value="3">
            按钮
          </el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item
        label="名称"
        prop="name"
      >
        <el-input
          v-model="form.name"
          placeholder="请输入菜单名称"
        />
      </el-form-item>
      <template v-if="form.type === 1 || form.type === 2">
        <el-form-item label="路由地址">
          <el-input
            v-model="form.path"
            placeholder="如 /system/user"
          />
        </el-form-item>
        <el-form-item label="图标">
          <el-input
            v-model="form.icon"
            placeholder="Element Plus 图标名，如 Odometer"
          />
        </el-form-item>
      </template>
      <el-form-item
        v-if="form.type === 2"
        label="组件路径"
      >
        <el-input
          v-model="form.component"
          placeholder="如 system/user/index"
        />
      </el-form-item>
      <el-form-item
        v-if="form.type === 3"
        label="权限标识"
        prop="perms"
      >
        <el-input
          v-model="form.perms"
          placeholder="如 system:user:create"
        />
      </el-form-item>
      <el-form-item label="排序">
        <el-input-number
          v-model="form.sort"
          :min="0"
        />
      </el-form-item>
      <el-form-item
        v-if="form.type !== 3"
        label="是否显示"
      >
        <el-radio-group v-model="form.visible">
          <el-radio :value="1">
            显示
          </el-radio>
          <el-radio :value="0">
            隐藏
          </el-radio>
        </el-radio-group>
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
import type { FormRules } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { createMenu, deleteMenu, getMenuList, updateMenu } from '@/api/system/menu'
import type { MenuPayload } from '@/api/system/menu'
import FormDialog from '@/components/FormDialog/index.vue'
import ProTable from '@/components/ProTable/index.vue'
import type { MenuItem } from '@/types/api'
import { listToTree } from '@/utils/tree'

/** 树节点类型：MenuItem 附加 children */
type MenuNode = MenuItem & { children?: MenuNode[] }

/** 类型 tag 映射：1目录 2菜单 3按钮 */
const typeTagMap: Record<number, { label: string; tag: 'primary' | 'success' | 'info' }> = {
  1: { label: '目录', tag: 'primary' },
  2: { label: '菜单', tag: 'success' },
  3: { label: '按钮', tag: 'info' },
}

const loading = ref(false)
const loadError = ref(false)
const list = ref<MenuItem[]>([])

const treeData = computed(() => listToTree(list.value) as MenuNode[])

async function load() {
  loading.value = true
  loadError.value = false
  try {
    list.value = await getMenuList()
  } catch {
    list.value = []
    loadError.value = true
  } finally {
    loading.value = false
  }
}
load()

// 父级下拉选项：过滤掉按钮（type=3）节点，按钮不可作父级
const parentOptions = computed(() => filterButtons(treeData.value))

function filterButtons(nodes: MenuNode[]): MenuNode[] {
  return nodes
    .filter((n) => n.type !== 3)
    .map((n) => ({ ...n, children: n.children ? filterButtons(n.children) : [] }))
}

const dialogVisible = ref(false)
const submitting = ref(false)
const isEdit = ref(false)
const editingId = ref<string>('')
const form = reactive({
  // 保持字符串与 tree-select 选项 value（id 为字符串）一致，提交时再转 number；
  // 若转 number 会导致选不中选项、反显原始数字
  parentId: undefined as string | undefined,
  type: 2,
  name: '',
  path: '',
  component: '',
  perms: '',
  icon: '',
  sort: 0,
  visible: 1,
  status: 1,
})

const rules = computed<FormRules>(() => ({
  name: [{ required: true, message: '请输入菜单名称', trigger: 'blur' }],
  perms:
    form.type === 3
      ? [{ required: true, message: '请输入权限标识', trigger: 'blur' }]
      : [],
}))

function resetForm() {
  form.parentId = undefined
  form.type = 2
  form.name = ''
  form.path = ''
  form.component = ''
  form.perms = ''
  form.icon = ''
  form.sort = 0
  form.visible = 1
  form.status = 1
}

function openCreate(parent?: MenuNode) {
  isEdit.value = false
  editingId.value = ''
  resetForm()
  form.parentId = parent ? parent.id : undefined
  dialogVisible.value = true
}

function openEdit(row: MenuNode) {
  isEdit.value = true
  editingId.value = row.id
  form.parentId = row.parentId === '0' ? undefined : row.parentId
  form.type = row.type
  form.name = row.name
  form.path = row.path ?? ''
  form.component = row.component ?? ''
  form.perms = row.perms ?? ''
  form.icon = row.icon ?? ''
  form.sort = row.sort
  form.visible = row.visible
  form.status = row.status
  dialogVisible.value = true
}

async function handleSubmit() {
  // 按类型组装提交字段，无关字段不下发
  const payload: MenuPayload = {
    parentId: form.parentId !== undefined ? Number(form.parentId) : 0,
    type: form.type,
    name: form.name,
    sort: form.sort,
    visible: form.visible,
    status: form.status,
  }
  if (form.type === 1 || form.type === 2) {
    payload.path = form.path
    payload.icon = form.icon
  }
  if (form.type === 2) {
    payload.component = form.component
  }
  if (form.type === 3) {
    payload.perms = form.perms
  }

  submitting.value = true
  try {
    if (isEdit.value) {
      await updateMenu(editingId.value, payload)
      ElMessage.success('编辑成功')
    } else {
      await createMenu(payload)
      ElMessage.success('新增成功')
    }
    dialogVisible.value = false
    load()
  } finally {
    submitting.value = false
  }
}

async function handleDelete(row: MenuNode) {
  await ElMessageBox.confirm(`确认删除菜单「${row.name}」吗？`, '提示', { type: 'warning' })
  await deleteMenu(row.id)
  ElMessage.success('删除成功')
  load()
}
</script>

<style scoped>
.v-menu-page {
  width: 100%;
}
</style>
