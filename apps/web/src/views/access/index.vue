<script setup lang="ts">
/**
 * 接入凭证管理（P15 T137 / D119~D128、API-P15 §1）。
 *
 * 凭证用于**外部系统**经 `/api/ext/v1` 只读读取数据应用已暴露的数据（一凭证一应用，D126）；
 * `scope` 只能是暴露范围（表 / 字段）的子集（R133，越界 50021）。
 *
 * 安全纪律（R130/R140）：`secret` 仅在**创建 / 轮换**响应出现一次——页面用独立弹窗醒目展示 +
 * 复制 + 「我已保存」确认后关闭，此后列表 / 详情只回显 `keyId` 与 `secret 前缀`；
 * 凭证管理**不提供 AI 工具**，AI 对话不是安全通道（本页也是唯一的自服务入口）。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { useClipboard } from '@vueuse/core'
import { ElMessage } from 'element-plus'
import { CopyDocument, Plus, Refresh, Search } from '@element-plus/icons-vue'
import {
  createCredential,
  listAudits,
  listCredentials,
  revokeCredential,
  rotateCredential,
  updateCredential,
  type AuditItem,
  type CredentialItem,
  type CredentialScopeInput,
} from '@/api/access'
import { getPubConfig, listApps, type PubConfigTable } from '@/api/app'
import { confirmDialog } from '@/utils/confirm'
import { formatTime } from '@/utils/format'

interface AppOption {
  appCode: string
  name: string
  isPublic: number
  status: string
}

/** 复制（legacy=true：非安全上下文自动降级 execCommand；失败如实提示） */
const { copy: copyToClipboard } = useClipboard({ legacy: true })

const loading = ref(false)
const loadError = ref(false)
const list = ref<CredentialItem[]>([])
const apps = ref<AppOption[]>([])

/** 创建 / 编辑弹窗（id 非空 = 编辑） */
const formDialog = reactive({
  visible: false,
  submitting: false,
  id: '',
  name: '',
  appCode: '',
  expiresAt: '',
  tables: [] as string[],
  fields: {} as Record<string, string[]>,
  /** 当前所选应用的暴露清单（编辑时按凭证绑定应用加载） */
  pubConfig: null as PubConfigTable[] | null,
  loadingSchema: false,
})

/** 密钥一次性展示弹窗 */
const secretDialog = reactive({
  visible: false,
  apiKey: '',
  name: '',
  rotated: false,
  saved: false,
})

/** 审计抽屉 */
const auditDrawer = reactive({
  visible: false,
  loading: false,
  loadError: false,
  list: [] as AuditItem[],
  total: 0,
  pageNo: 1,
  pageSize: 20,
  credentialId: '',
  resultCode: undefined as number | undefined,
})

const activeApps = computed(() => apps.value)

/** 当前所选应用**已暴露**的表（scope 只能从中选） */
const exposedTables = computed(() => (formDialog.pubConfig ?? []).filter((table) => table.isExposed === 1))

/** 应用列表项归一（`listApps` 的 isPublic/status 为扩展字段） */
function mapApp(app: { appCode: string; name: string }): AppOption {
  const extra = app as unknown as { isPublic?: number; status?: string }
  return {
    appCode: app.appCode,
    name: app.name,
    isPublic: Number(extra.isPublic ?? 0),
    status: String(extra.status ?? 'active'),
  }
}

/**
 * 刷新应用下拉（打开「新建凭证」时调用）。
 *
 * 必要性：本页数据只在 `onMounted` 取一次，而多页签 + keep-alive 下切回不会重挂载——
 * 用户刚在「我的应用」新建的应用会不可见（复验实测）。每次开弹窗重取一次即可闭合该场景。
 */
async function refreshApps(): Promise<void> {
  try {
    apps.value = (await listApps()).map(mapApp)
  } catch {
    // 保留原列表；请求层已提示
  }
}

/** 刷新凭证列表（打开审计抽屉时调用：筛选下拉须含刚创建 / 吊销的凭证） */
async function refreshCredentials(): Promise<void> {
  try {
    list.value = await listCredentials()
  } catch {
    // 保留原列表；请求层已提示
  }
}

async function load(): Promise<void> {
  loading.value = true
  loadError.value = false
  try {
    const [credentials, appList] = await Promise.all([listCredentials(), listApps()])
    list.value = credentials
    apps.value = appList.map(mapApp)
  } catch {
    list.value = []
    loadError.value = true
  } finally {
    loading.value = false
  }
}

onMounted(load)

// ==================== 表单（创建 / 编辑） ====================

/** 拉取所选应用的暴露清单（scope 选择器的数据源） */
async function loadSchema(appCode: string): Promise<void> {
  formDialog.pubConfig = null
  if (!appCode) return
  formDialog.loadingSchema = true
  try {
    const config = await getPubConfig(appCode)
    formDialog.pubConfig = config.tables ?? []
  } catch {
    formDialog.pubConfig = []
  } finally {
    formDialog.loadingSchema = false
  }
}

async function openCreate(): Promise<void> {
  formDialog.id = ''
  formDialog.name = ''
  formDialog.appCode = ''
  formDialog.expiresAt = ''
  formDialog.tables = []
  formDialog.fields = {}
  formDialog.pubConfig = null
  formDialog.visible = true
  // 下拉取最新：页面加载后（或另一页签里）新建的应用要能选到
  await refreshApps()
}

async function openEdit(item: CredentialItem): Promise<void> {
  formDialog.id = item.id
  formDialog.name = item.name
  formDialog.appCode = item.appCode
  formDialog.expiresAt = item.expiresAt ? item.expiresAt.slice(0, 19) : ''
  formDialog.tables = [...item.scope.tables]
  formDialog.fields = { ...(item.scope.fields ?? {}) }
  formDialog.visible = true
  await loadSchema(item.appCode)
}

/** 选中的应用变化（仅创建时可改） */
async function onAppChange(appCode: string): Promise<void> {
  formDialog.tables = []
  formDialog.fields = {}
  await loadSchema(appCode)
}

/** 表勾选变化：取消勾选时清掉该表的字段收窄 */
function onTableChange(tables: string[]): void {
  for (const key of Object.keys(formDialog.fields)) {
    if (!tables.includes(key)) delete formDialog.fields[key]
  }
}

function tableFields(table: PubConfigTable): Array<{ id: string; name: string; label: string }> {
  return table.fields.filter((field) => field.isExposed === 1)
}

function buildScope(): CredentialScopeInput | null {
  const tables = formDialog.tables.filter((name) => exposedTables.value.some((table) => table.tableCode === name))
  if (tables.length === 0) {
    ElMessage.warning('至少要选择 1 张已暴露的表')
    return null
  }
  const fields: Record<string, string[]> = {}
  for (const [table, picked] of Object.entries(formDialog.fields)) {
    if (picked.length > 0 && tables.includes(table)) fields[table] = picked
  }
  return { tables, fields }
}

async function submitForm(): Promise<void> {
  const name = formDialog.name.trim()
  if (!name) {
    ElMessage.warning('备注名必填')
    return
  }
  const scope = buildScope()
  if (!scope) return
  formDialog.submitting = true
  try {
    if (formDialog.id) {
      await updateCredential(formDialog.id, {
        name,
        scope,
        expiresAt: formDialog.expiresAt ? formDialog.expiresAt : null,
      })
      ElMessage.success('已保存（密钥未变）')
      formDialog.visible = false
      await load()
      return
    }
    if (!formDialog.appCode) {
      ElMessage.warning('请选择数据应用')
      return
    }
    const created = await createCredential({
      appCode: formDialog.appCode,
      name,
      scope,
      ...(formDialog.expiresAt ? { expiresAt: formDialog.expiresAt } : {}),
    })
    formDialog.visible = false
    openSecret(created.apiKey, name, false)
    await load()
  } catch {
    // 请求层已提示（50020 上限 / 50021 越界等）
  } finally {
    formDialog.submitting = false
  }
}

// ==================== 密钥一次性展示 ====================

function openSecret(apiKey: string, name: string, rotated: boolean): void {
  secretDialog.apiKey = apiKey
  secretDialog.name = name
  secretDialog.rotated = rotated
  secretDialog.saved = false
  secretDialog.visible = true
}

function onSecretClosed(): void {
  // 关闭后清空内存中的密钥（避免残留在 DOM / 响应式状态里）
  secretDialog.apiKey = ''
  secretDialog.name = ''
}

async function copyApiKey(): Promise<void> {
  try {
    await copyToClipboard(secretDialog.apiKey)
    secretDialog.saved = true
    ElMessage.success('密钥已复制')
  } catch {
    ElMessage.error('复制失败，请手动选中复制')
  }
}

// ==================== 轮换 / 吊销 ====================

async function onRotate(item: CredentialItem): Promise<void> {
  const ok = await confirmDialog(
    `轮换后旧密钥立即失效（外部系统需同步更新），确认轮换「${item.name}」？`,
    '提示',
    { type: 'warning' },
  )
  if (!ok) return
  try {
    const rotated = await rotateCredential(item.id)
    openSecret(rotated.apiKey, item.name, true)
    await load()
  } catch {
    // 请求层已提示
  }
}

async function onRevoke(item: CredentialItem): Promise<void> {
  const ok = await confirmDialog(`吊销后不可恢复，外部系统将立即无法取数，确认吊销「${item.name}」？`, '提示', {
    type: 'warning',
  })
  if (!ok) return
  try {
    await revokeCredential(item.id)
    ElMessage.success('已吊销（立即生效）')
    await load()
  } catch {
    // 请求层已提示
  }
}

function scopeSummary(item: CredentialItem): string {
  const narrowed = Object.entries(item.scope.fields ?? {}).filter(([, fields]) => fields.length > 0)
  if (narrowed.length === 0) return '全部已暴露字段'
  return narrowed.map(([table, fields]) => `${table}: ${fields.join('/')}`).join('；')
}

// ==================== 审计 ====================

const RESULT_CODES = [
  { value: 0, label: '成功' },
  { value: 40001, label: '参数越界' },
  { value: 40400, label: '不可见 / 未授权' },
  { value: 42900, label: '超配额' },
  { value: 50019, label: '凭证无效' },
]

function openAudit(): void {
  auditDrawer.visible = true
  auditDrawer.pageNo = 1
  auditDrawer.resultCode = undefined
  auditDrawer.credentialId = ''
  // 筛选下拉取最新凭证（刚创建 / 吊销的应立即可见）
  void refreshCredentials()
  void loadAudits()
}

async function loadAudits(): Promise<void> {
  auditDrawer.loading = true
  auditDrawer.loadError = false
  try {
    const page = await listAudits({
      ...(auditDrawer.credentialId ? { credentialId: auditDrawer.credentialId } : {}),
      ...(auditDrawer.resultCode !== undefined ? { resultCode: auditDrawer.resultCode } : {}),
      pageNo: auditDrawer.pageNo,
      pageSize: auditDrawer.pageSize,
    })
    auditDrawer.list = page.list
    auditDrawer.total = page.total
  } catch {
    auditDrawer.list = []
    auditDrawer.loadError = true
  } finally {
    auditDrawer.loading = false
  }
}

function onAuditPage(pageNo: number): void {
  auditDrawer.pageNo = pageNo
  void loadAudits()
}

function principalText(principal: string): string {
  const [type, id] = principal.split(':')
  if (type === 'cred') return `凭证 #${id}`
  if (type === 'display') return `展示应用 #${id}`
  return principal
}

function resultTagType(code: number): 'success' | 'warning' | 'danger' | 'info' {
  if (code === 0) return 'success'
  if (code === 42900) return 'warning'
  if (code === 50019 || code === 40400) return 'danger'
  return 'info'
}

function resultText(code: number): string {
  return RESULT_CODES.find((item) => item.value === code)?.label ?? String(code)
}
</script>

<template>
  <div class="v-access">
    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="接入凭证用于外部系统经 /api/ext/v1 只读读取数据应用已暴露的数据"
    >
      <template #default>
        密钥只在创建 / 轮换时展示一次，请立即妥善保存；此后任何页面都不再回显。授权范围只能<b>收窄</b>
        （表 / 字段须为已暴露项）。
      </template>
    </el-alert>

    <div class="v-access__toolbar">
      <el-button
        type="primary"
        :icon="Plus"
        @click="openCreate"
      >
        新建凭证
      </el-button>
      <el-button
        :icon="Search"
        @click="openAudit"
      >
        调用审计
      </el-button>
      <el-button
        :icon="Refresh"
        @click="load"
      >
        刷新
      </el-button>
    </div>

    <el-table
      v-loading="loading"
      :data="list"
      :empty-text="loadError ? '加载失败，请重试' : '还没有接入凭证'"
    >
      <el-table-column
        prop="name"
        label="备注名"
        min-width="140"
      />
      <el-table-column
        label="数据应用"
        min-width="170"
      >
        <template #default="{ row }">
          {{ row.appName }}
          <span class="v-access__hint">{{ row.appCode }}</span>
        </template>
      </el-table-column>
      <el-table-column
        label="Key"
        min-width="200"
      >
        <template #default="{ row }">
          <span class="v-access__mono">{{ row.keyId }}.{{ row.secretPrefix }}…</span>
        </template>
      </el-table-column>
      <el-table-column
        label="授权范围"
        min-width="230"
      >
        <template #default="{ row }">
          <el-tag
            v-for="table in row.scope.tables"
            :key="table"
            class="v-access__tag"
            size="small"
          >
            {{ table }}
          </el-tag>
          <div class="v-access__hint">
            {{ scopeSummary(row as CredentialItem) }}
          </div>
        </template>
      </el-table-column>
      <el-table-column
        label="状态"
        width="96"
      >
        <template #default="{ row }">
          <el-tag
            :type="row.status === 1 ? 'success' : 'info'"
            size="small"
          >
            {{ row.status === 1 ? '有效' : '已吊销' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column
        label="过期时间"
        width="170"
      >
        <template #default="{ row }">
          {{ row.expiresAt ? formatTime(row.expiresAt) : '不过期' }}
        </template>
      </el-table-column>
      <el-table-column
        label="最近使用"
        width="170"
      >
        <template #default="{ row }">
          {{ row.lastUsedAt ? formatTime(row.lastUsedAt) : '未使用' }}
        </template>
      </el-table-column>
      <el-table-column
        label="今日用量"
        width="150"
      >
        <template #default="{ row }">
          <template v-if="row.usageToday">
            {{ row.usageToday.requests }} 次 / {{ row.usageToday.rows }} 行
          </template>
          <span
            v-else
            class="v-access__hint"
          >
            —
          </span>
        </template>
      </el-table-column>
      <el-table-column
        label="操作"
        width="200"
        fixed="right"
      >
        <template #default="{ row }">
          <el-button
            link
            type="primary"
            @click="openEdit(row as CredentialItem)"
          >
            编辑范围
          </el-button>
          <el-button
            link
            type="primary"
            :disabled="row.status !== 1"
            @click="onRotate(row as CredentialItem)"
          >
            轮换
          </el-button>
          <el-button
            link
            type="danger"
            :disabled="row.status !== 1"
            @click="onRevoke(row as CredentialItem)"
          >
            吊销
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 创建 / 编辑 -->
    <el-dialog
      v-model="formDialog.visible"
      :title="formDialog.id ? '编辑凭证' : '新建凭证'"
      width="680px"
    >
      <el-form
        label-width="96px"
        label-position="right"
      >
        <el-form-item label="数据应用">
          <el-select
            v-model="formDialog.appCode"
            :disabled="!!formDialog.id"
            placeholder="选择自己的数据应用"
            class="v-access__field"
            @change="onAppChange"
          >
            <el-option
              v-for="app in activeApps"
              :key="app.appCode"
              :label="`${app.name}（${app.appCode}）`"
              :value="app.appCode"
            />
          </el-select>
          <span
            v-if="formDialog.id"
            class="v-access__hint"
          >
            凭证绑定应用不可更改（改应用请新建凭证）
          </span>
        </el-form-item>

        <el-form-item label="备注名">
          <el-input
            v-model="formDialog.name"
            maxlength="64"
            placeholder="如「ERP 对接」"
            class="v-access__field"
          />
        </el-form-item>

        <el-form-item label="过期时间">
          <el-date-picker
            v-model="formDialog.expiresAt"
            type="datetime"
            value-format="YYYY-MM-DDTHH:mm:ss"
            placeholder="留空 = 不过期"
            class="v-access__field"
          />
        </el-form-item>

        <el-form-item label="可读表">
          <div
            v-loading="formDialog.loadingSchema"
            class="v-access__scope"
          >
            <template v-if="exposedTables.length > 0">
              <el-checkbox-group
                v-model="formDialog.tables"
                @change="onTableChange(formDialog.tables)"
              >
                <el-checkbox
                  v-for="table in exposedTables"
                  :key="table.tableCode"
                  :value="table.tableCode"
                >
                  {{ table.label }}（{{ table.tableCode }}）
                </el-checkbox>
              </el-checkbox-group>
            </template>
            <span
              v-else
              class="v-access__hint"
            >
              该应用还没有已暴露的表（请先到「我的应用 ▸ 结构」暴露表与字段，或发布应用）
            </span>
          </div>
        </el-form-item>

        <el-form-item
          v-for="table in exposedTables.filter((item) => formDialog.tables.includes(item.tableCode))"
          :key="table.tableCode"
          :label="`${table.tableCode} 字段`"
        >
          <el-checkbox-group v-model="formDialog.fields[table.tableCode]">
            <el-checkbox
              v-for="field in tableFields(table)"
              :key="field.id"
              :value="field.name"
            >
              {{ field.label }}
            </el-checkbox>
          </el-checkbox-group>
          <div class="v-access__hint">
            不勾选 = 该表全部已暴露字段
          </div>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="formDialog.visible = false">
          取消
        </el-button>
        <el-button
          type="primary"
          :loading="formDialog.submitting"
          @click="submitForm"
        >
          {{ formDialog.id ? '保存' : '创建并生成密钥' }}
        </el-button>
      </template>
    </el-dialog>

    <!-- 密钥一次性展示 -->
    <el-dialog
      v-model="secretDialog.visible"
      :title="secretDialog.rotated ? '新密钥已生成（仅显示一次）' : '密钥已生成（仅显示一次）'"
      width="580px"
      :close-on-click-modal="false"
      :show-close="false"
      @closed="onSecretClosed"
    >
      <el-alert
        type="warning"
        :closable="false"
        show-icon
        title="请立即复制并妥善保存：关闭本窗口后，平台不再显示密钥"
      />
      <div class="v-access__secret">
        <div class="v-access__secret-label">
          凭证「{{ secretDialog.name }}」
          <span v-if="secretDialog.rotated">（旧密钥已立即失效）</span>
        </div>
        <div class="v-access__secret-value">
          {{ secretDialog.apiKey }}
        </div>
        <el-button
          type="primary"
          :icon="CopyDocument"
          @click="copyApiKey"
        >
          复制密钥
        </el-button>
        <div class="v-access__hint">
          外部系统调用：<code>Authorization: Bearer {{ secretDialog.apiKey }}</code>
        </div>
      </div>
      <template #footer>
        <el-button
          type="primary"
          :disabled="!secretDialog.saved"
          @click="secretDialog.visible = false"
        >
          {{ secretDialog.saved ? '我已保存，关闭' : '请先复制密钥' }}
        </el-button>
      </template>
    </el-dialog>

    <!-- 审计抽屉 -->
    <el-drawer
      v-model="auditDrawer.visible"
      title="调用审计（最多保留 90 天）"
      size="72%"
    >
      <div class="v-access__filters">
        <el-select
          v-model="auditDrawer.credentialId"
          clearable
          placeholder="全部凭证"
          class="v-access__filter"
        >
          <el-option
            v-for="item in list"
            :key="item.id"
            :label="`${item.name}（${item.keyId}）`"
            :value="item.id"
          />
        </el-select>
        <el-select
          v-model="auditDrawer.resultCode"
          clearable
          placeholder="全部结果"
          class="v-access__filter"
        >
          <el-option
            v-for="code in RESULT_CODES"
            :key="code.value"
            :label="`${code.label}（${code.value}）`"
            :value="code.value"
          />
        </el-select>
        <el-button
          type="primary"
          :icon="Search"
          @click="auditDrawer.pageNo = 1; loadAudits()"
        >
          查询
        </el-button>
        <el-button
          :icon="Refresh"
          @click="loadAudits"
        >
          刷新
        </el-button>
      </div>

      <el-table
        v-loading="auditDrawer.loading"
        :data="auditDrawer.list"
        :empty-text="auditDrawer.loadError ? '加载失败，请重试' : '没有调用记录'"
      >
        <el-table-column
          label="时间"
          width="170"
        >
          <template #default="{ row }">
            {{ formatTime(row.createdAt) }}
          </template>
        </el-table-column>
        <el-table-column
          label="调用方"
          width="130"
        >
          <template #default="{ row }">
            {{ principalText(row.principal) }}
          </template>
        </el-table-column>
        <el-table-column
          prop="endpoint"
          label="端点"
          width="100"
        />
        <el-table-column
          label="表"
          width="120"
        >
          <template #default="{ row }">
            {{ row.tableName || '—' }}
          </template>
        </el-table-column>
        <el-table-column
          prop="rows"
          label="行数"
          width="80"
        />
        <el-table-column
          label="耗时"
          width="90"
        >
          <template #default="{ row }">
            {{ row.durationMs }}ms
          </template>
        </el-table-column>
        <el-table-column
          label="结果"
          width="130"
        >
          <template #default="{ row }">
            <el-tag
              :type="resultTagType(row.resultCode)"
              size="small"
            >
              {{ resultText(row.resultCode) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column
          prop="ip"
          label="IP"
          width="130"
        />
        <el-table-column
          label="参数摘要"
          min-width="200"
        >
          <template #default="{ row }">
            <span class="v-access__mono">{{ row.paramsSummary || '—' }}</span>
          </template>
        </el-table-column>
      </el-table>

      <div class="v-access__pager">
        <el-pagination
          layout="total, prev, pager, next"
          :total="auditDrawer.total"
          :page-size="auditDrawer.pageSize"
          :current-page="auditDrawer.pageNo"
          @current-change="onAuditPage"
        />
      </div>
    </el-drawer>
  </div>
</template>

<style scoped>
.v-access__toolbar {
  display: flex;
  gap: 8px;
  margin: 12px 0;
}

.v-access__field {
  width: 320px;
}

.v-access__tag {
  margin-right: 4px;
}

.v-access__hint {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.v-access__mono {
  font-family: var(--el-font-family-mono, monospace);
  font-size: 12px;
}

.v-access__scope {
  width: 100%;
  min-height: 32px;
}

.v-access__secret {
  margin-top: 12px;
  padding: 12px;
  border: 1px dashed var(--el-border-color);
  border-radius: 4px;
}

.v-access__secret-label {
  margin-bottom: 8px;
  color: var(--el-text-color-secondary);
  font-size: 13px;
}

.v-access__secret-value {
  margin-bottom: 10px;
  padding: 8px;
  background: var(--el-fill-color-light);
  border-radius: 4px;
  font-family: var(--el-font-family-mono, monospace);
  font-size: 13px;
  word-break: break-all;
}

.v-access__filters {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.v-access__filter {
  width: 200px;
}

.v-access__pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}
</style>
