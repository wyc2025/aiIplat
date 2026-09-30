<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  confirmApp,
  createApp,
  deleteApp,
  getPubConfig,
  getSchema,
  listApps,
  publishApp,
  queryData,
  type PubConfig,
} from '@/api/app'
import { listMySubmissions, submitToMarket } from '@/api/market'
import { confirmDialog } from '@/utils/confirm'
import { formatTime } from '@/utils/format'
import type { AppDefItem } from '@/types/api'

/**
 * 应用中心 · 我的应用（P11 T106，ARCHITECTURE-P11 §6）：
 * 卡片流 + 空白创建 + 草稿确认入册 + 删除；跳结构编辑器 / 功能页编辑器 / 首个功能页。
 */
const router = useRouter()
const loading = ref(false)
const loadError = ref(false)
const list = ref<AppDefItem[]>([])
const dialogVisible = ref(false)
const submitting = ref(false)
const form = reactive<{ name: string; description: string; mode: 'blank' | 'draft' }>({
  name: '',
  description: '',
  mode: 'blank',
})
const rules = {
  name: [{ required: true, message: '请输入应用名称', trigger: 'blur' }],
}

/** 取数面弹窗（P14 T127：暴露明细 + 发布开关 + 缺项引导；公开链接与展示页已退役） */
const pubDialog = reactive<{
  visible: boolean
  appCode: string
  appName: string
  loading: boolean
  saving: boolean
  config: PubConfig | null
}>({ visible: false, appCode: '', appName: '', loading: false, saving: false, config: null })

async function openPub(item: AppDefItem): Promise<void> {
  pubDialog.visible = true
  pubDialog.appCode = item.appCode
  pubDialog.appName = item.name
  pubDialog.config = null
  await refreshPubConfig()
}

async function refreshPubConfig(): Promise<void> {
  pubDialog.loading = true
  try {
    pubDialog.config = await getPubConfig(pubDialog.appCode)
  } catch {
    pubDialog.config = null
  } finally {
    pubDialog.loading = false
  }
}

async function togglePublish(next: number): Promise<void> {
  pubDialog.saving = true
  try {
    await publishApp(pubDialog.appCode, next)
    ElMessage.success(next === 1 ? '已开启：可被授权给展示应用读取' : '已关闭：站点取数即时失效')
    await refreshPubConfig()
    await load()
  } catch {
    // 请求层已提示（50012 的 message 内含缺项清单）
    await refreshPubConfig()
  } finally {
    pubDialog.saving = false
  }
}

async function load(): Promise<void> {
  loading.value = true
  loadError.value = false
  try {
    list.value = await listApps()
  } catch {
    list.value = []
    loadError.value = true
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void load()
  void loadMyListings()
})

// ==================== P13 T121：发布到市场（R118 ~120） ====================

/** 与后端 market.demoMaxRowsPerTable 默认值一致（服务端为唯一权威，超限提交由后端 50015 拒绝） */
const DEMO_MAX_ROWS_PER_TABLE = 100

/** appCode → 活跃条目状态（pending / approved）；置灰提示用 */
const activeListing = ref<Record<string, 'pending' | 'approved'>>({})

const marketDialog = reactive<{
  visible: boolean
  appCode: string
  appName: string
  loading: boolean
  submitting: boolean
  withDemo: boolean
  tables: Array<{ name: string; label: string; rows: number | null }>
}>({
  visible: false,
  appCode: '',
  appName: '',
  loading: false,
  submitting: false,
  withDemo: false,
  tables: [],
})

/** 勾选演示数据且存在超限表 → 红字提示（提交仍会被后端拒绝，此处只做前置提醒） */
const demoOverflow = computed(
  () =>
    marketDialog.withDemo &&
    marketDialog.tables.some((table) => (table.rows ?? 0) > DEMO_MAX_ROWS_PER_TABLE),
)

async function loadMyListings(): Promise<void> {
  try {
    const rows = await listMySubmissions()
    const map: Record<string, 'pending' | 'approved'> = {}
    for (const row of rows) {
      if (!row.appCode) continue
      if (row.status === 'pending' || row.status === 'approved') map[row.appCode] = row.status
    }
    activeListing.value = map
  } catch {
    activeListing.value = {}
  }
}

async function openMarket(item: AppDefItem): Promise<void> {
  marketDialog.visible = true
  marketDialog.appCode = item.appCode
  marketDialog.appName = item.name
  marketDialog.withDemo = false
  marketDialog.tables = []
  marketDialog.loading = true
  try {
    const schema = await getSchema(item.appCode)
    const tables = schema.tables
      .filter((table) => !table.isSystem)
      .map((table) => ({ name: table.name, label: table.label, rows: null as number | null }))
    marketDialog.tables = tables
    // 逐表行数预览（失败置 null，不阻塞提交）；必须遍历**响应式代理**（marketDialog.tables），
    // 遍历原始数组会改到裸对象上、不触发更新（表现为永远显示「读取失败」）
    for (const table of marketDialog.tables) {
      try {
        const result = await queryData({ appCode: item.appCode, op: 'count', table: table.name })
        table.rows = result.total ?? 0
      } catch {
        table.rows = null
      }
    }
  } catch {
    marketDialog.tables = []
  } finally {
    marketDialog.loading = false
  }
}

async function submitMarket(): Promise<void> {
  if (demoOverflow.value) {
    ElMessage.warning(`演示数据超出上限（单表 ${DEMO_MAX_ROWS_PER_TABLE} 行），请先清理数据或取消勾选`)
    return
  }
  marketDialog.submitting = true
  try {
    const result = await submitToMarket({
      appCode: marketDialog.appCode,
      withDemoData: marketDialog.withDemo,
    })
    ElMessage.success(`已提交（条目 ${result.listingCode}），等待管理员审核`)
    marketDialog.visible = false
    await Promise.all([load(), loadMyListings()])
  } catch {
    // 请求层已提示（50013 重复提交 / 50015 内容不合规）
  } finally {
    marketDialog.submitting = false
  }
}

function openCreate(): void {
  form.name = ''
  form.description = ''
  form.mode = 'blank'
  dialogVisible.value = true
}

async function submitCreate(): Promise<void> {
  if (!form.name.trim()) {
    ElMessage.warning('请输入应用名称')
    return
  }
  submitting.value = true
  try {
    const result = await createApp({
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      mode: form.mode,
    })
    ElMessage.success(
      result.status === 'draft' ? `草稿已创建：${result.appCode}` : `应用已创建：${result.appCode}`,
    )
    dialogVisible.value = false
    await load()
  } catch {
    // 请求层已提示
  } finally {
    submitting.value = false
  }
}

async function confirmDraft(item: AppDefItem): Promise<void> {
  if (!(await confirmDialog(`确认把「${item.name}」入册？入册后将占用一个正式应用额度。`, '确认入册'))) {
    return
  }
  await confirmApp(item.appCode)
  ElMessage.success('已入册，功能页已挂到应用中心菜单')
  await load()
}

async function removeApp(item: AppDefItem): Promise<void> {
  if (
    !(await confirmDialog(
      `删除应用「${item.name}」？表结构与数据将保留 30 天后物理清理，删除后立即不可访问。`,
      '删除确认',
      { type: 'warning' },
    ))
  ) {
    return
  }
  await deleteApp(item.appCode)
  ElMessage.success('已删除')
  await load()
}

function goSchema(item: AppDefItem): void {
  void router.push({ path: '/app-center/schema', query: { appCode: item.appCode } })
}

function goPages(item: AppDefItem): void {
  void router.push({ path: '/app-center/pages', query: { appCode: item.appCode } })
}
</script>

<template>
  <div class="v-app-center">
    <div class="v-app-center__header">
      <div>
        <h3 class="v-app-center__title">
          我的应用
        </h3>
        <p class="v-app-center__desc">
          用空白表单或 AI 对话创建数据应用，平台自动生成管理后台。
        </p>
      </div>
      <el-button
        type="primary"
        @click="openCreate"
      >
        新建应用
      </el-button>
    </div>

    <div
      v-loading="loading"
      class="v-app-center__body"
    >
      <el-result
        v-if="loadError"
        icon="error"
        title="加载失败"
        sub-title="请稍后重试"
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
        v-else-if="list.length === 0 && !loading"
        description="还没有应用，先新建一个吧"
      >
        <el-button
          type="primary"
          @click="openCreate"
        >
          新建应用
        </el-button>
      </el-empty>

      <div
        v-else
        class="v-app-grid"
      >
        <el-card
          v-for="item in list"
          :key="item.appCode"
          shadow="hover"
          class="v-app-card"
        >
          <div class="v-app-card__head">
            <span class="v-app-card__name">{{ item.name }}</span>
            <el-tag
              :type="item.status === 'active' ? 'success' : 'warning'"
              size="small"
            >
              {{ item.status === 'active' ? '已入册' : '草稿' }}
            </el-tag>
          </div>
          <p class="v-app-card__desc">
            {{ item.description || '（无描述）' }}
          </p>
          <div class="v-app-card__meta">
            <span>code：{{ item.appCode }}</span>
            <span>表 {{ item.tableCount }} · 行 {{ item.rowCount }} · 页 {{ item.pageCount }}</span>
            <span>更新：{{ formatTime(item.updatedAt) }}</span>
          </div>
          <div class="v-app-card__actions">
            <el-button
              size="small"
              @click="goSchema(item)"
            >
              结构
            </el-button>
            <el-button
              size="small"
              @click="goPages(item)"
            >
              功能页
            </el-button>
            <el-button
              size="small"
              type="success"
              plain
              @click="openPub(item)"
            >
              公开
            </el-button>
            <!-- P13 T121：发布到市场（未提交过显示主按钮；已有活跃条目置灰提示） -->
            <el-tooltip
              v-if="item.status === 'active' && activeListing[item.appCode]"
              :content="
                activeListing[item.appCode] === 'approved'
                  ? '已在市场在架（可重新提交需先下架）'
                  : '已提交，等待审核'
              "
            >
              <span>
                <el-button
                  size="small"
                  plain
                  disabled
                >
                  已提交市场
                </el-button>
              </span>
            </el-tooltip>
            <el-button
              v-else-if="item.status === 'active'"
              size="small"
              type="primary"
              plain
              @click="openMarket(item)"
            >
              发布到市场
            </el-button>
            <el-button
              v-if="item.status === 'draft'"
              size="small"
              type="primary"
              @click="confirmDraft(item)"
            >
              确认入册
            </el-button>
            <el-button
              size="small"
              type="danger"
              text
              @click="removeApp(item)"
            >
              删除
            </el-button>
          </div>
        </el-card>
      </div>
    </div>

    <el-dialog
      v-model="dialogVisible"
      title="新建数据应用"
      width="480px"
    >
      <el-form
        :model="form"
        :rules="rules"
        label-width="90px"
      >
        <el-form-item
          label="应用名称"
          prop="name"
        >
          <el-input
            v-model="form.name"
            maxlength="50"
            show-word-limit
            placeholder="如：书单"
          />
        </el-form-item>
        <el-form-item label="用途描述">
          <el-input
            v-model="form.description"
            maxlength="200"
            show-word-limit
          />
        </el-form-item>
        <el-form-item label="创建方式">
          <el-radio-group v-model="form.mode">
            <el-radio value="blank">
              直接入册（占正式额度）
            </el-radio>
            <el-radio value="draft">
              存为草稿（不占额度，限 3 个）
            </el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">
          取消
        </el-button>
        <el-button
          type="primary"
          :loading="submitting"
          @click="submitCreate"
        >
          创建
        </el-button>
      </template>
    </el-dialog>

    <!-- P12 T113：公开与发布（R100/R103/R108） -->
    <el-dialog
      v-model="pubDialog.visible"
      :title="`取数设置 · ${pubDialog.appName}`"
      width="640px"
    >
      <div v-loading="pubDialog.loading">
        <el-alert
          v-if="pubDialog.config && pubDialog.config.missing.length > 0"
          type="warning"
          :closable="false"
          show-icon
          class="pub-missing"
        >
          <template #title>
            发布前还差 {{ pubDialog.config.missing.length }} 项
          </template>
          <ul class="pub-missing__list">
            <li
              v-for="(item, index) in pubDialog.config.missing.slice(0, 6)"
              :key="index"
            >
              {{ item }}
            </li>
          </ul>
        </el-alert>

        <el-form label-width="90px">
          <el-form-item label="可被读取">
            <el-switch
              :model-value="pubDialog.config?.isPublic ?? 0"
              :active-value="1"
              :inactive-value="0"
              :loading="pubDialog.saving"
              @change="(value: number | string | boolean) => togglePublish(Number(value))"
            />
            <span class="pub-hint">开启后可将本应用授权给展示应用：站点展示页只读读取其已暴露的表与字段</span>
          </el-form-item>

          <el-form-item label="暴露表">
            <el-tag
              v-for="table in pubDialog.config?.exposedTables ?? []"
              :key="table.id"
              class="pub-tag"
              type="success"
              size="small"
            >
              {{ table.label }}（{{ table.tableCode }}）
            </el-tag>
            <span
              v-if="(pubDialog.config?.exposedTables?.length ?? 0) === 0"
              class="pub-hint"
            >
              暂无暴露表，请在「结构」编辑器里为表开启公开
            </span>
          </el-form-item>
        </el-form>
      </div>

      <template #footer>
        <el-button @click="pubDialog.visible = false">
          关闭
        </el-button>
      </template>
    </el-dialog>

    <!-- P13 T121：发布到市场（withDemoData 勾选 + 逐表行数预览，R118） -->
    <el-dialog
      v-model="marketDialog.visible"
      :title="`发布到市场 · ${marketDialog.appName}`"
      width="560px"
    >
      <div v-loading="marketDialog.loading">
        <el-alert
          type="info"
          :closable="false"
          show-icon
          class="market-tip"
        >
          <template #title>
            提交即冻结结构快照（之后修改源应用不影响该条目），进入人工审核队列
          </template>
        </el-alert>

        <el-form label-width="110px">
          <el-form-item label="附带演示数据">
            <el-switch v-model="marketDialog.withDemo" />
            <span class="pub-hint">勾选后把现有数据一并提交（每表 ≤ {{ DEMO_MAX_ROWS_PER_TABLE }} 行；附件字段不随复制迁移）</span>
          </el-form-item>
          <el-form-item label="数据行预览">
            <div
              v-if="marketDialog.tables.length === 0"
              class="pub-hint"
            >
              该应用没有逻辑表，将只分享结构
            </div>
            <div
              v-else
              class="market-tables"
            >
              <div
                v-for="table in marketDialog.tables"
                :key="table.name"
                class="market-tables__row"
              >
                <span>{{ table.label }}（{{ table.name }}）</span>
                <span
                  :class="{
                    'market-tables__count--over':
                      marketDialog.withDemo && (table.rows ?? 0) > DEMO_MAX_ROWS_PER_TABLE,
                  }"
                >
                  {{ table.rows === null ? '读取失败' : `${table.rows} 行` }}
                </span>
              </div>
            </div>
          </el-form-item>
        </el-form>

        <p
          v-if="demoOverflow"
          class="market-overflow"
        >
          存在超过 {{ DEMO_MAX_ROWS_PER_TABLE }} 行的表：提交会被拒绝，请先清理数据或取消勾选
        </p>
      </div>

      <template #footer>
        <el-button @click="marketDialog.visible = false">
          取消
        </el-button>
        <el-button
          type="primary"
          :loading="marketDialog.submitting"
          :disabled="demoOverflow"
          @click="submitMarket"
        >
          提交审核
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.v-app-center__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 16px;
}
.v-app-center__title {
  margin: 0 0 4px;
}
.v-app-center__desc {
  margin: 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.v-app-center__body {
  min-height: 200px;
}
.v-app-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}
.v-app-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.v-app-card__name {
  font-weight: 600;
}
.v-app-card__desc {
  margin: 8px 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  min-height: 20px;
}
.v-app-card__meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.v-app-card__actions {
  margin-top: 12px;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.pub-missing {
  margin-bottom: 12px;
}
.pub-missing__list {
  margin: 4px 0 0;
  padding-left: 18px;
  font-size: 12px;
}
.pub-hint {
  margin-left: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.pub-tag {
  margin: 0 6px 6px 0;
}
.market-tip {
  margin-bottom: 12px;
}
.market-tables {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  color: var(--el-text-color-regular);
}
.market-tables__row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.market-tables__count--over {
  color: var(--el-color-danger);
  font-weight: 600;
}
.market-overflow {
  margin: 0;
  font-size: 12px;
  color: var(--el-color-danger);
}
</style>
