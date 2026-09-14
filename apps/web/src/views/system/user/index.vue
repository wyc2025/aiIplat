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
        <el-form-item label="用户名">
          <el-input
            v-model="query.username"
            placeholder="请输入用户名"
            clearable
            style="width: 180px"
          />
        </el-form-item>
        <el-form-item label="手机号">
          <el-input
            v-model="query.phone"
            placeholder="请输入手机号"
            clearable
            style="width: 180px"
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
          v-permission="'system:user:create'"
          type="primary"
          :icon="Plus"
          @click="openCreate"
        >
          新增用户
        </el-button>
      </template>

      <el-table-column
        prop="username"
        label="用户名"
        min-width="120"
      />
      <el-table-column
        prop="nickname"
        label="昵称"
        min-width="120"
      />
      <el-table-column
        label="部门"
        min-width="120"
      >
        <template #default="{ row }">
          {{ row.dept?.name ?? '-' }}
        </template>
      </el-table-column>
      <el-table-column
        label="角色"
        min-width="160"
      >
        <template #default="{ row }">
          <template v-if="row.roles?.length">
            <el-tag
              v-for="r in row.roles"
              :key="r.id"
              class="v-role-tag"
              size="small"
            >
              {{ r.name }}
            </el-tag>
          </template>
          <span v-else>-</span>
        </template>
      </el-table-column>
      <el-table-column
        label="状态"
        width="90"
        align="center"
      >
        <template #default="{ row }">
          <el-switch
            :model-value="row.status"
            :active-value="1"
            :inactive-value="0"
            :disabled="row.username === 'admin' || !hasPerm('system:user:update')"
            @change="(val: string | number | boolean) => handleStatusChange(row, Number(val))"
          />
        </template>
      </el-table-column>
      <el-table-column
        label="最后登录时间"
        width="180"
      >
        <template #default="{ row }">
          {{ row.lastLoginAt ? formatTime(row.lastLoginAt) : '-' }}
        </template>
      </el-table-column>
      <el-table-column
        label="操作"
        width="260"
        fixed="right"
      >
        <template #default="{ row }">
          <el-button
            v-permission="'system:user:update'"
            link
            type="primary"
            @click="openEdit(row)"
          >
            编辑
          </el-button>
          <el-button
            v-permission="'system:user:reset-password'"
            link
            type="primary"
            @click="handleResetPassword(row)"
          >
            重置密码
          </el-button>
          <el-button
            v-if="row.username !== 'admin'"
            v-permission="'system:user:assign-role'"
            link
            type="primary"
            @click="openAssign(row)"
          >
            分配角色
          </el-button>
          <!-- 云盘配额：admin 自己这一行也给入口（P4F R62，与「站点配额」同根因同一修法）；
               后端只校验 cloud:admin:quota 权限 + 「下限 = 当前已用」，调整自身同样安全 -->
          <el-button
            v-permission="'cloud:admin:quota'"
            link
            type="primary"
            @click="openQuota(row)"
          >
            配额
          </el-button>
          <!-- 站点配额：admin 自己这一行也给入口（否则超管永远卡在默认 SITE_DEFAULT_LIMIT=1，无法自测/自用多站）；
               后端只校验 site:admin:quota 权限 + 「下限 = 当前站点数」，调整自身同样安全 -->
          <el-button
            v-permission="'site:admin:quota'"
            link
            type="primary"
            @click="openSiteQuota(row)"
          >
            站点配额
          </el-button>
          <el-button
            v-if="row.username !== 'admin'"
            v-permission="'system:user:delete'"
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
      :title="isEdit ? '编辑用户' : '新增用户'"
      :form="form"
      :rules="rules"
      :submitting="submitting"
      width="640px"
      @submit="handleSubmit"
    >
      <el-form-item
        v-if="!isEdit"
        label="用户名"
        prop="username"
      >
        <el-input
          v-model="form.username"
          placeholder="请输入用户名"
        />
      </el-form-item>
      <el-form-item
        v-if="!isEdit"
        label="密码"
        prop="password"
      >
        <el-input
          v-model="form.password"
          type="password"
          show-password
          placeholder="8~32 位，须含字母和数字"
        />
      </el-form-item>
      <el-form-item
        label="昵称"
        prop="nickname"
      >
        <el-input
          v-model="form.nickname"
          placeholder="请输入昵称"
        />
      </el-form-item>
      <el-form-item
        label="邮箱"
        prop="email"
      >
        <el-input
          v-model="form.email"
          placeholder="请输入邮箱"
        />
      </el-form-item>
      <el-form-item
        label="手机号"
        prop="phone"
      >
        <el-input
          v-model="form.phone"
          placeholder="请输入手机号"
        />
      </el-form-item>
      <el-form-item label="性别">
        <el-select
          v-model="form.gender"
          placeholder="请选择性别"
          clearable
          style="width: 100%"
        >
          <el-option
            v-for="d in sys_user_gender"
            :key="d.value"
            :label="d.label"
            :value="Number(d.value)"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="部门">
        <el-tree-select
          v-model="form.deptId"
          :data="deptTree"
          :props="{ label: 'name', value: 'id', children: 'children' }"
          check-strictly
          :render-after-expand="false"
          placeholder="请选择部门"
          clearable
          style="width: 100%"
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
      <el-form-item label="角色">
        <el-select
          v-model="form.roleIds"
          multiple
          placeholder="请选择角色"
          clearable
          style="width: 100%"
        >
          <el-option
            v-for="r in roleOptions"
            :key="r.id"
            :label="r.name"
            :value="Number(r.id)"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="备注">
        <el-input
          v-model="form.remark"
          type="textarea"
          :rows="2"
          placeholder="请输入备注"
        />
      </el-form-item>
    </FormDialog>

    <!-- 分配角色弹窗 -->
    <el-dialog
      v-model="assignVisible"
      title="分配角色"
      width="480px"
      :close-on-click-modal="false"
      destroy-on-close
    >
      <el-form label-width="90px">
        <el-form-item label="用户">
          <span>{{ assignRow?.nickname }}（{{ assignRow?.username }}）</span>
        </el-form-item>
        <el-form-item label="角色">
          <el-select
            v-model="assignRoleIds"
            multiple
            placeholder="请选择角色"
            style="width: 100%"
          >
            <el-option
              v-for="r in roleOptions"
              :key="r.id"
              :label="r.name"
              :value="Number(r.id)"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="assignVisible = false">
          取 消
        </el-button>
        <el-button
          type="primary"
          :loading="assignSubmitting"
          @click="handleAssignSubmit"
        >
          确 定
        </el-button>
      </template>
    </el-dialog>

    <!-- 配额调整弹窗 -->
    <el-dialog
      v-model="quotaVisible"
      title="调整云盘配额"
      width="480px"
      :close-on-click-modal="false"
      destroy-on-close
    >
      <el-form
        v-loading="quotaLoading"
        label-width="96px"
      >
        <el-form-item label="用户">
          <span>{{ quotaRow?.nickname }}（{{ quotaRow?.username }}）</span>
        </el-form-item>
        <el-form-item label="已用容量">
          <span>{{ quotaUsedText }}</span>
          <span class="v-quota-hint">（配额下限）</span>
        </el-form-item>
        <el-form-item label="配额上限">
          <el-input-number
            v-model="quotaLimitMb"
            :min="Math.ceil(quotaUsedMb)"
            :step="100"
            :controls="true"
            style="width: 200px"
          />
          <span class="v-quota-unit">MB</span>
        </el-form-item>
        <!-- 配额对账（P4F T68/D59/R60）：公式值 / 当前值 / 差额；差额存在才出修正按钮 -->
        <el-form-item label="配额对账">
          <template v-if="quotaReconcile">
            <span class="v-quota-reconcile">
              公式值 {{ formatBytes(Number(quotaReconcile.expected)) }} / 当前值
              {{ formatBytes(Number(quotaReconcile.stored)) }} / 差额 {{ quotaDiffText }}
            </span>
            <el-button
              v-if="quotaDiffBytes !== 0"
              link
              type="primary"
              :loading="quotaFixing"
              @click="handleReconcileFix"
            >
              按公式值修正
            </el-button>
            <span
              v-else
              class="v-quota-hint"
            >一致</span>
          </template>
          <span
            v-else
            class="v-quota-hint"
          >对账数据加载失败</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="quotaVisible = false">
          取 消
        </el-button>
        <el-button
          type="primary"
          :loading="quotaSubmitting"
          @click="handleQuotaSubmit"
        >
          确 定
        </el-button>
      </template>
    </el-dialog>

    <!-- 站点配额调整弹窗（P4E T63：site:admin:quota） -->
    <el-dialog
      v-model="siteQuotaVisible"
      title="调整站点配额"
      width="480px"
      :close-on-click-modal="false"
      destroy-on-close
    >
      <el-form
        v-loading="siteQuotaLoading"
        label-width="96px"
      >
        <el-form-item label="用户">
          <span>{{ siteQuotaRow?.nickname }}（{{ siteQuotaRow?.username }}）</span>
        </el-form-item>
        <el-form-item label="已有站点数">
          <span>{{ siteQuotaUsed }}</span>
          <span class="v-quota-hint">（配额下限）</span>
        </el-form-item>
        <el-form-item label="站点数上限">
          <el-input-number
            v-model="siteQuotaLimit"
            :min="siteQuotaUsed"
            :step="1"
            :controls="true"
            style="width: 160px"
          />
          <span class="v-quota-unit">个</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="siteQuotaVisible = false">
          取 消
        </el-button>
        <el-button
          type="primary"
          :loading="siteQuotaSubmitting"
          @click="handleSiteQuotaSubmit"
        >
          确 定
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, type Ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import dayjs from 'dayjs'
import {
  assignUserRoles,
  createUser,
  deleteUser,
  fixUsageReconcile,
  getUserPage,
  getUserQuota,
  getUsageReconcile,
  resetUserPassword,
  updateUser,
  updateUserStatus,
  updateUserQuota,
  type UsageReconcileResult,
} from '@/api/system/user'
import { getAllRoles } from '@/api/system/role'
import { getDeptList } from '@/api/system/dept'
import { getUserSiteQuota, updateUserSiteQuota } from '@/api/site/site'
import FormDialog from '@/components/FormDialog/index.vue'
import ProTable from '@/components/ProTable/index.vue'
import { useTable } from '@/hooks/useTable'
import { useDict, type DictItem } from '@/hooks/useDict'
import type { DeptItem, RoleItem, UserRow } from '@/types/api'
import { listToTree } from '@/utils/tree'
import { isEmail, isPassword, isPhone } from '@/utils/validate'
import { usePermissionStore } from '@/stores/permission'

const MB = 1024 * 1024
function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`
  return `${bytes} B`
}

// useDict 返回动态键，TS 无法推导，按文档用法做类型收窄
const { sys_user_gender } = useDict('sys_user_gender') as unknown as {
  sys_user_gender: Ref<DictItem[]>
}
const { hasPerm } = usePermissionStore()

// ========== 列表（三态 + 分页由 useTable/ProTable 驱动） ==========
const {
  list,
  total,
  pageNo,
  pageSize,
  loading,
  loadError,
  query,
  load,
  search,
  reset,
  handlePageChange,
  handleSizeChange,
} = useTable<UserRow, { username?: string; phone?: string; status?: number }>({
  fetchApi: getUserPage,
  query: { username: undefined, phone: undefined, status: undefined },
})

// ========== 下拉选项数据 ==========
const roleOptions = ref<RoleItem[]>([])
const deptList = ref<DeptItem[]>([])
const deptTree = computed(() => listToTree(deptList.value))

async function loadOptions() {
  const [roles, depts] = await Promise.all([getAllRoles(), getDeptList()])
  roleOptions.value = roles
  deptList.value = depts
}
loadOptions()

function formatTime(t: string) {
  return dayjs(t).format('YYYY-MM-DD HH:mm:ss')
}

// ========== 新增/编辑 ==========
const dialogVisible = ref(false)
const submitting = ref(false)
const isEdit = ref(false)
const editingId = ref<string>('')
const form = reactive({
  username: '',
  password: '',
  nickname: '',
  email: '',
  phone: '',
  gender: undefined as number | undefined,
  deptId: undefined as string | undefined,
  status: 1,
  remark: '',
  roleIds: [] as number[],
})

const rules = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { min: 2, max: 50, message: '长度 2~50 个字符', trigger: 'blur' },
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    {
      validator: (_r: unknown, value: string, cb: (e?: Error) => void) => {
        if (!isPassword(value)) return cb(new Error('8~32 位，须含字母和数字'))
        cb()
      },
      trigger: 'blur',
    },
  ],
  nickname: [{ required: true, message: '请输入昵称', trigger: 'blur' }],
  email: [
    {
      validator: (_r: unknown, value: string, cb: (e?: Error) => void) => {
        if (value && !isEmail(value)) return cb(new Error('邮箱格式不正确'))
        cb()
      },
      trigger: 'blur',
    },
  ],
  phone: [
    {
      validator: (_r: unknown, value: string, cb: (e?: Error) => void) => {
        if (value && !isPhone(value)) return cb(new Error('手机号格式不正确'))
        cb()
      },
      trigger: 'blur',
    },
  ],
}

function resetForm() {
  form.username = ''
  form.password = ''
  form.nickname = ''
  form.email = ''
  form.phone = ''
  form.gender = undefined
  form.deptId = undefined
  form.status = 1
  form.remark = ''
  form.roleIds = []
}

function openCreate() {
  isEdit.value = false
  editingId.value = ''
  resetForm()
  dialogVisible.value = true
}

function openEdit(row: UserRow) {
  isEdit.value = true
  editingId.value = row.id
  resetForm()
  form.nickname = row.nickname
  form.email = row.email ?? ''
  form.phone = row.phone ?? ''
  form.gender = row.gender
  form.deptId = row.dept?.id
  form.status = row.status
  form.remark = row.remark ?? ''
  form.roleIds = row.roles.map((r) => Number(r.id))
  dialogVisible.value = true
}

async function handleSubmit() {
  submitting.value = true
  try {
    const payload = {
      nickname: form.nickname,
      email: form.email || undefined,
      phone: form.phone || undefined,
      gender: form.gender,
      deptId: form.deptId ? Number(form.deptId) : undefined,
      status: form.status,
      remark: form.remark || undefined,
      roleIds: form.roleIds.length ? form.roleIds : undefined,
    }
    if (isEdit.value) {
      await updateUser(editingId.value, payload)
      ElMessage.success('编辑成功')
    } else {
      await createUser({ ...payload, username: form.username, password: form.password })
      ElMessage.success('新增成功')
    }
    dialogVisible.value = false
    load()
  } finally {
    submitting.value = false
  }
}

// ========== 状态切换 ==========
async function handleStatusChange(row: UserRow, status: number) {
  try {
    await updateUserStatus(row.id, status)
    row.status = status
    ElMessage.success(status === 1 ? '已启用' : '已禁用')
  } catch {
    // 失败时刷新恢复原值
    load()
  }
}

// ========== 重置密码 ==========
async function handleResetPassword(row: UserRow) {
  await ElMessageBox.confirm(`确认重置用户「${row.username}」的密码吗？`, '提示', { type: 'warning' })
  const res = await resetUserPassword(row.id)
  ElMessageBox.alert(`新密码：${res.password}，请立即复制保存，此密码仅展示一次。`, '重置成功', {
    confirmButtonText: '我已保存',
    type: 'success',
  })
}

// ========== 分配角色 ==========
const assignVisible = ref(false)
const assignSubmitting = ref(false)
const assignRow = ref<UserRow | null>(null)
const assignRoleIds = ref<number[]>([])

function openAssign(row: UserRow) {
  assignRow.value = row
  assignRoleIds.value = row.roles.map((r) => Number(r.id))
  assignVisible.value = true
}

async function handleAssignSubmit() {
  if (!assignRow.value) return
  assignSubmitting.value = true
  try {
    await assignUserRoles(assignRow.value.id, assignRoleIds.value)
    ElMessage.success('分配成功')
    assignVisible.value = false
    load()
  } finally {
    assignSubmitting.value = false
  }
}

// ========== 删除 ==========
async function handleDelete(row: UserRow) {
  await ElMessageBox.confirm(`确认删除用户「${row.username}」吗？`, '提示', { type: 'warning' })
  await deleteUser(row.id)
  ElMessage.success('删除成功')
  load()
}

// ========== 配额调整（cloud:admin:quota） ==========
const quotaVisible = ref(false)
const quotaLoading = ref(false)
const quotaSubmitting = ref(false)
const quotaFixing = ref(false)
const quotaRow = ref<UserRow | null>(null)
const quotaUsedBytes = ref(0)
const quotaLimitMb = ref(0)
// 配额对账诊断（P4F T68/D59/R60）：公式值 / 当前值 / 差额；差额 ≠ 0 才出现修正按钮
const quotaReconcile = ref<UsageReconcileResult | null>(null)

const quotaUsedMb = computed(() => quotaUsedBytes.value / MB)
const quotaUsedText = computed(() => formatBytes(quotaUsedBytes.value))
const quotaDiffBytes = computed(() => Number(quotaReconcile.value?.diff ?? 0))
const quotaDiffText = computed(() => {
  if (quotaDiffBytes.value === 0) return '0'
  const abs = Math.abs(quotaDiffBytes.value)
  return `${quotaDiffBytes.value > 0 ? '+' : '-'}${formatBytes(abs)}`
})

/** 配额与对账并行拉取（对账失败不阻塞配额调整，仅对账行退化为提示） */
async function loadQuotaData(row: UserRow) {
  const [res, reconcile] = await Promise.all([
    getUserQuota(row.id),
    getUsageReconcile(row.id).catch(() => null),
  ])
  quotaUsedBytes.value = Number(res.quotaUsed)
  quotaReconcile.value = reconcile
  // 配额上限初值：不低于已用，缺省取已用向上取整到 100MB
  const ceil = Math.ceil(quotaUsedBytes.value / MB)
  const def = Math.max(ceil, Math.ceil(res.quotaLimit ? Number(res.quotaLimit) / MB : ceil))
  quotaLimitMb.value = def
}

async function openQuota(row: UserRow) {
  quotaRow.value = row
  quotaReconcile.value = null
  quotaVisible.value = true
  quotaLoading.value = true
  try {
    await loadQuotaData(row)
  } catch {
    // 错误已由拦截器提示
  } finally {
    quotaLoading.value = false
  }
}

/** 按公式值修正（P4F R61）：显式二次确认 → 只写 used → 重载弹窗数据 */
async function handleReconcileFix() {
  if (!quotaRow.value || !quotaReconcile.value) return
  try {
    await ElMessageBox.confirm(
      `确认按公式值修正配额？当前值 ${formatBytes(Number(quotaReconcile.value.stored))} → 公式值 ${formatBytes(Number(quotaReconcile.value.expected))}（差额 ${quotaDiffText.value}）`,
      '配额对账修正',
      { type: 'warning' },
    )
  } catch {
    // 用户取消：ElMessageBox 以 reject 表示取消，必须吞掉否则 Vue 报未处理的事件处理错误
    return
  }
  quotaFixing.value = true
  try {
    await fixUsageReconcile(quotaRow.value.id)
    ElMessage.success('已按公式值修正')
    await loadQuotaData(quotaRow.value)
  } catch {
    // 错误已由拦截器提示
  } finally {
    quotaFixing.value = false
  }
}

async function handleQuotaSubmit() {
  if (!quotaRow.value) return
  if (quotaLimitMb.value * MB < quotaUsedBytes.value) {
    ElMessage.warning('配额下限为当前已用容量，不可更低')
    return
  }
  quotaSubmitting.value = true
  try {
    await updateUserQuota({
      userId: quotaRow.value.id,
      quotaLimit: quotaLimitMb.value * MB,
    })
    ElMessage.success('配额已更新')
    quotaVisible.value = false
  } catch {
    // 错误已由拦截器提示
  } finally {
    quotaSubmitting.value = false
  }
}

// ========== 站点配额调整（site:admin:quota，P4E T63） ==========
const siteQuotaVisible = ref(false)
const siteQuotaLoading = ref(false)
const siteQuotaSubmitting = ref(false)
const siteQuotaRow = ref<UserRow | null>(null)
const siteQuotaUsed = ref(0)
const siteQuotaLimit = ref(1)

async function openSiteQuota(row: UserRow) {
  siteQuotaRow.value = row
  siteQuotaVisible.value = true
  siteQuotaLoading.value = true
  try {
    const res = await getUserSiteQuota(row.id)
    siteQuotaUsed.value = res.used
    // 上限初值：不低于已有站点数
    siteQuotaLimit.value = Math.max(res.limit, res.used)
  } catch {
    // 错误已由拦截器提示
  } finally {
    siteQuotaLoading.value = false
  }
}

async function handleSiteQuotaSubmit() {
  if (!siteQuotaRow.value) return
  if (siteQuotaLimit.value < siteQuotaUsed.value) {
    ElMessage.warning('配额下限为当前站点数，不可更低')
    return
  }
  siteQuotaSubmitting.value = true
  try {
    await updateUserSiteQuota({ userId: siteQuotaRow.value.id, limit: siteQuotaLimit.value })
    ElMessage.success('站点配额已更新')
    siteQuotaVisible.value = false
  } catch {
    // 错误已由拦截器提示
  } finally {
    siteQuotaSubmitting.value = false
  }
}
</script>

<style scoped>
.v-role-tag {
  margin-right: 4px;
}
.v-quota-hint {
  margin-left: 4px;
  font-size: 12px;
  color: #909399;
}
.v-quota-reconcile {
  margin-right: 8px;
  font-size: 13px;
  color: #606266;
}
.v-quota-unit {
  margin-left: 8px;
  font-size: 13px;
  color: #606266;
}
</style>
