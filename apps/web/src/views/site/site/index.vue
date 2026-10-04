<template>
  <div class="v-site-list">
    <ProTable
      :data="store.sites"
      :loading="store.loading"
      :load-error="loadError"
      :pagination="false"
      @retry="reload"
    >
      <template #toolbar>
        <el-tooltip
          :disabled="!store.quotaFull"
          :content="`站点数已达上限（${store.used}/${store.limit}），请联系管理员调整配额`"
          placement="top"
        >
          <span>
            <el-button
              v-permission="'site:site:manage'"
              type="primary"
              :icon="Plus"
              :disabled="store.quotaFull"
              @click="openCreate"
            >
              新建站点
            </el-button>
          </span>
        </el-tooltip>
        <span class="v-sl-quota">站点配额：{{ store.used }} / {{ store.limit }}</span>
        <el-button
          :icon="Refresh"
          @click="reload"
        >
          刷新
        </el-button>
      </template>

      <el-table-column
        label="站点标识"
        width="150"
        prop="slug"
      />
      <el-table-column
        label="站点标题"
        min-width="160"
        prop="title"
      />
      <el-table-column
        label="状态"
        width="90"
      >
        <template #default="{ row }">
          <el-tag
            :type="row.status === 1 ? 'success' : 'info'"
            size="small"
          >
            {{ row.status === 1 ? '启用中' : '已停用' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column
        label="文章数"
        width="90"
        prop="articleCount"
      />
      <el-table-column
        label="创建时间"
        width="170"
        :formatter="(r: SiteSiteInfo) => formatTime(r.createdAt)"
      />
      <el-table-column
        label="站点地址"
        min-width="220"
      >
        <template #default="{ row }">
          <el-link
            type="primary"
            :href="siteUrl(row)"
            target="_blank"
          >
            {{ row.siteUrl }}
          </el-link>
          <el-button
            link
            type="primary"
            size="small"
            @click="onCopy(row)"
          >
            复制
          </el-button>
        </template>
      </el-table-column>
      <el-table-column
        label="操作"
        width="270"
        fixed="right"
      >
        <template #default="{ row }">
          <el-button
            v-permission="'site:site:manage'"
            link
            type="primary"
            @click="onManage(row)"
          >
            管理
          </el-button>
          <el-button
            v-permission="'site:site:manage'"
            link
            type="primary"
            @click="openReleases(row)"
          >
            发布与版本
          </el-button>
          <el-button
            v-permission="'site:site:manage'"
            link
            type="primary"
            @click="openEdit(row)"
          >
            编辑
          </el-button>
          <el-button
            v-permission="'site:site:manage'"
            link
            type="danger"
            @click="onRemove(row)"
          >
            删除
          </el-button>
        </template>
      </el-table-column>
      <template #empty>
        <el-empty
          v-if="!loadError"
          description="还没有站点，点击「新建站点」开始"
        />
      </template>
    </ProTable>

    <!-- 新建站点 -->
    <el-dialog
      v-model="createVisible"
      title="新建站点"
      width="520px"
      :close-on-click-modal="false"
    >
      <el-form
        ref="createFormRef"
        :model="createForm"
        :rules="formRules"
        label-width="100px"
      >
        <el-form-item
          label="站点标识"
          prop="slug"
        >
          <el-input
            v-model="createForm.slug"
            placeholder="3~32 位小写字母/数字/连字符"
            maxlength="32"
          />
          <div class="v-sl-tip">
            将成为站点地址的一部分：<b>{{ createForm.slug || '你的标识' }}</b> ，创建后可修改
          </div>
        </el-form-item>
        <el-form-item
          label="站点标题"
          prop="title"
        >
          <el-input
            v-model="createForm.title"
            maxlength="50"
            show-word-limit
          />
        </el-form-item>
        <el-form-item label="站点描述">
          <el-input
            v-model="createForm.description"
            type="textarea"
            :rows="3"
            maxlength="200"
            show-word-limit
          />
        </el-form-item>
        <!-- P7 D73：开站即灌内容（默认把内容池里全部已发布文章发表到新站） -->
        <el-form-item label="初始内容">
          <el-radio-group v-model="createForm.publishMode">
            <el-radio-button value="all">
              发表全部已发布文章
            </el-radio-button>
            <el-radio-button value="none">
              先空站（仅建模板）
            </el-radio-button>
          </el-radio-group>
          <div class="v-sl-tip">
            内容池里的文章不随站点删除而消失，可随时再发表到任意站点
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">
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

    <!-- 编辑站点 -->
    <el-dialog
      v-model="editVisible"
      title="编辑站点信息"
      width="520px"
      :close-on-click-modal="false"
    >
      <el-form
        ref="editFormRef"
        :model="editForm"
        :rules="formRules"
        label-width="100px"
      >
        <el-form-item
          label="站点标识"
          prop="slug"
        >
          <el-input
            v-model="editForm.slug"
            maxlength="32"
          />
          <div class="v-sl-tip">
            修改后旧地址立即全部失效
          </div>
        </el-form-item>
        <el-form-item
          label="站点标题"
          prop="title"
        >
          <el-input
            v-model="editForm.title"
            maxlength="50"
            show-word-limit
          />
        </el-form-item>
        <el-form-item label="站点描述">
          <el-input
            v-model="editForm.description"
            type="textarea"
            :rows="3"
            maxlength="200"
            show-word-limit
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">
          取消
        </el-button>
        <el-button
          type="primary"
          :loading="submitting"
          @click="submitEdit"
        >
          保存
        </el-button>
      </template>
    </el-dialog>

    <!-- 发布与版本（P19 T161 / API-P19 §4）：发布快照 + 版本列表 + 切换当前版本 + 锁定/删除 -->
    <el-drawer
      v-model="releaseDrawer.visible"
      :title="`发布与版本 · ${releaseDrawer.siteTitle}`"
      size="760px"
    >
      <el-alert
        v-if="releaseDrawer.loaded && releaseDrawer.list.length === 0"
        type="warning"
        :closable="false"
        show-icon
        title="当前为草稿直出"
        description="站点还没发布过任何版本，访客看到的就是云盘里的工作文件（改动即时生效）。发布一个版本后，线上内容固定为该快照，之后改文件不会直接影响访客。"
      />
      <div class="v-sl-rel-head">
        <el-button
          type="primary"
          :icon="Upload"
          :loading="releaseDrawer.publishing"
          @click="onPublish"
        >
          发布新版本
        </el-button>
        <el-button
          :icon="Refresh"
          :loading="releaseDrawer.loading"
          @click="loadReleases"
        >
          刷新
        </el-button>
      </div>

      <el-table
        v-loading="releaseDrawer.loading"
        :data="releaseDrawer.list"
        :empty-text="releaseDrawer.loadError ? '加载失败，请重试' : '还没有发布过版本'"
      >
        <el-table-column
          label="当前"
          width="86"
        >
          <template #default="{ row }">
            <el-tag
              v-if="row.active"
              type="success"
              size="small"
            >
              在线
            </el-tag>
            <el-button
              v-else
              link
              type="primary"
              @click="onActivate(row)"
            >
              切到此版
            </el-button>
          </template>
        </el-table-column>
        <el-table-column
          label="版本"
          width="76"
        >
          <template #default="{ row }">
            v{{ row.versionNo }}
          </template>
        </el-table-column>
        <el-table-column
          label="备注"
          min-width="140"
        >
          <template #default="{ row }">
            {{ row.label || '—' }}
          </template>
        </el-table-column>
        <el-table-column
          label="文件数"
          width="86"
          prop="fileCount"
        />
        <el-table-column
          label="大小"
          width="96"
        >
          <template #default="{ row }">
            {{ formatBytes(Number(row.totalBytes)) }}
          </template>
        </el-table-column>
        <el-table-column
          label="发布时间"
          width="160"
        >
          <template #default="{ row }">
            {{ formatTime(row.createdAt) }}
          </template>
        </el-table-column>
        <el-table-column
          label="锁"
          width="70"
        >
          <template #default="{ row }">
            <el-tag
              v-if="row.pinned"
              type="warning"
              size="small"
            >
              已锁
            </el-tag>
            <span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column
          label="操作"
          width="130"
          fixed="right"
        >
          <template #default="{ row }">
            <el-button
              link
              type="primary"
              @click="onTogglePin(row)"
            >
              {{ row.pinned ? '解锁' : '锁定' }}
            </el-button>
            <el-button
              link
              type="danger"
              :disabled="row.active || row.pinned"
              @click="onDeleteRelease(row)"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="v-sl-tip">
        点「切到此版」即把线上内容换回该版本（也就是回滚），即时生效、可反复切换。锁定版本不会被自动清理，当前版本不可删除。
        版本快照包含站点文件夹里的全部内容（含图片），展示应用不受版本影响。
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useClipboard } from '@vueuse/core'
import { ElMessage, ElMessageBox } from 'element-plus'
import { confirmDialog } from '@/utils/confirm'
import { Plus, Refresh, Upload } from '@element-plus/icons-vue'
import type { FormInstance, FormRules } from 'element-plus'
import ProTable from '@/components/ProTable/index.vue'
import { formatTime } from '@/utils/format'
import { listDisplays, type DisplayItem } from '@/api/display'
import {
  activateSiteRelease,
  createSite,
  deleteSite,
  deleteSiteRelease,
  listSiteReleases,
  pinSiteRelease,
  publishSiteRelease,
  updateSite,
} from '@/api/site/site'
import { useSiteStore } from '@/stores/site'
import type { SiteReleaseItem, SiteSiteInfo } from '@/types/api'

/**
 * 站点列表页（P4E T63 / API §10.2）：站点 CRUD 入口 + 当前站设置 + admin 配额提示。
 * 单站用户与现状零差异（本页为新增菜单项）；多站用户在此新建/编辑/删除/进入管理。
 */
const router = useRouter()
const store = useSiteStore()

const loadError = ref(false)
const submitting = ref(false)

const createVisible = ref(false)
const editVisible = ref(false)
const createFormRef = ref<FormInstance>()
const editFormRef = ref<FormInstance>()
const editingId = ref('')

const origin = window.location.origin
/** publishMode：P7 D73 建站内容初始化（'all' = 发表全部已发布文章 / 'none' = 先空站） */
const createForm = reactive({
  slug: '',
  title: '',
  description: '',
  publishMode: 'all' as 'all' | 'none',
})
const editForm = reactive({ slug: '', title: '', description: '' })

const { copy: copyToClipboard } = useClipboard({ legacy: true })

// ==================== 发布与版本（P19 T161 / API-P19 §4） ====================

/** 抽屉状态（按站点打开时加载版本列表） */
const releaseDrawer = reactive({
  visible: false,
  siteId: '',
  siteTitle: '',
  loading: false,
  /** 是否已完成过一次加载（用于「从未发布」提示条的判定） */
  loaded: false,
  publishing: false,
  loadError: false,
  list: [] as SiteReleaseItem[],
})

function openReleases(row: SiteSiteInfo): void {
  releaseDrawer.siteId = String(row.id)
  releaseDrawer.siteTitle = row.title
  releaseDrawer.list = []
  releaseDrawer.loaded = false
  releaseDrawer.visible = true
  void loadReleases()
}

async function loadReleases(): Promise<void> {
  if (!releaseDrawer.siteId) return
  releaseDrawer.loading = true
  releaseDrawer.loadError = false
  try {
    releaseDrawer.list = await listSiteReleases(releaseDrawer.siteId)
  } catch {
    releaseDrawer.loadError = true
  } finally {
    releaseDrawer.loading = false
    releaseDrawer.loaded = true
  }
}

/** 发布新版本（备注可选；并发发布后端 40121，由拦截器提示） */
async function onPublish(): Promise<void> {
  const label = await promptLabel()
  if (label === null) return
  releaseDrawer.publishing = true
  try {
    await publishSiteRelease(releaseDrawer.siteId, label || undefined)
    ElMessage.success('已发布，线上内容已更新')
    await loadReleases()
  } catch {
    // 拦截器提示（40121「发布进行中」等）
  } finally {
    releaseDrawer.publishing = false
  }
}

/** 切换当前版本（= 回滚；即时生效，可反复横跳） */
async function onActivate(row: SiteReleaseItem): Promise<void> {
  const confirmed = await confirmDialog(
    `把线上内容切回 v${row.versionNo}？访客会立刻看到这个版本，之后可随时再切回来。`,
    '提示',
    { type: 'warning' },
  )
  if (!confirmed) return
  try {
    await activateSiteRelease(releaseDrawer.siteId, row.id)
    ElMessage.success(`已切到 v${row.versionNo}`)
    await loadReleases()
  } catch {
    // 拦截器提示
  }
}

/** 锁定 / 解锁（锁定版豁免自动清理与手动删除） */
async function onTogglePin(row: SiteReleaseItem): Promise<void> {
  try {
    await pinSiteRelease(releaseDrawer.siteId, row.id, !row.pinned)
    ElMessage.success(row.pinned ? '已解锁' : '已锁定，不会被自动清理')
    await loadReleases()
  } catch {
    // 拦截器提示
  }
}

/** 删除版本（当前版本 / 锁定版后端拒绝；前端按钮已禁用） */
async function onDeleteRelease(row: SiteReleaseItem): Promise<void> {
  const confirmed = await confirmDialog(
    `删除 v${row.versionNo}？该版本的快照会被一并清理，且不可恢复。`,
    '提示',
    { type: 'warning' },
  )
  if (!confirmed) return
  try {
    await deleteSiteRelease(releaseDrawer.siteId, row.id)
    ElMessage.success('已删除')
    await loadReleases()
  } catch {
    // 拦截器提示
  }
}

/** 发布备注输入（取消返回 null；留空表示不写备注） */
async function promptLabel(): Promise<string | null> {
  try {
    const result = await ElMessageBox.prompt('给这个版本写个备注（可留空）', '发布新版本', {
      confirmButtonText: '发布',
      cancelButtonText: '取消',
      inputPlaceholder: '例如：首页改版上线',
      inputValidator: (value: string) => (value ?? '').length <= 100 || '备注不超过 100 字',
    })
    return result.value ?? ''
  } catch {
    return null
  }
}

/** 字节数显示（版本大小列） */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`
}

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{2,31}$/
const SLUG_BLACKLIST = [
  'api',
  'www',
  'admin',
  'manage',
  'system',
  'open',
  'static',
  'assets',
  'public',
  'login',
  's',
  'site',
]
const slugValidator = (_rule: unknown, value: string, callback: (err?: Error) => void) => {
  if (!SLUG_PATTERN.test(value)) {
    callback(new Error('需为 3~32 位小写字母/数字/连字符，且以字母或数字开头'))
  } else if (SLUG_BLACKLIST.includes(value)) {
    callback(new Error('该标识为系统保留字'))
  } else {
    callback()
  }
}
const formRules: FormRules = {
  slug: [{ required: true, validator: slugValidator, trigger: 'blur' }],
  title: [{ required: true, message: '请输入站点标题', trigger: 'blur' }],
}

/** 站点完整访问地址（siteUrl 为 /api/open/{slug}/，补源站前缀便于复制分享） */
function siteUrl(row: SiteSiteInfo) {
  return `${origin}${row.siteUrl}`
}

async function reload() {
  loadError.value = false
  try {
    await store.load()
  } catch {
    loadError.value = true
  }
}

async function onCopy(row: SiteSiteInfo) {
  try {
    await copyToClipboard(siteUrl(row))
    ElMessage.success('已复制')
  } catch {
    ElMessage.error('复制失败，请手动复制链接')
  }
}

function openCreate() {
  createForm.slug = ''
  createForm.title = ''
  createForm.description = ''
  createForm.publishMode = 'all'
  createVisible.value = true
}

async function submitCreate() {
  const valid = await createFormRef.value?.validate().catch(() => false)
  if (!valid) return
  submitting.value = true
  try {
    const created = await createSite({
      slug: createForm.slug,
      title: createForm.title,
      description: createForm.description || undefined,
      publishArticleIds: createForm.publishMode === 'none' ? [] : 'all',
    })
    ElMessage.success('站点创建成功，已生成默认模板')
    createVisible.value = false
    await store.load()
    // 新建后直接切到新站点（便于随后进入管理）
    store.setCurrent(created.id)
  } catch {
    // 拦截器提示（40118 配额满 / 40102 占用 / 40103 非法）
  } finally {
    submitting.value = false
  }
}

function openEdit(row: SiteSiteInfo) {
  editingId.value = row.id
  editForm.slug = row.slug
  editForm.title = row.title
  editForm.description = row.description ?? ''
  editVisible.value = true
}

async function submitEdit() {
  const valid = await editFormRef.value?.validate().catch(() => false)
  if (!valid) return
  submitting.value = true
  try {
    await updateSite(editingId.value, {
      slug: editForm.slug,
      title: editForm.title,
      description: editForm.description,
    })
    ElMessage.success('已保存')
    editVisible.value = false
    await store.load()
  } catch {
    // 拦截器提示
  } finally {
    submitting.value = false
  }
}

/** 管理 = 设为当前站 + 跳站点设置（D54） */
function onManage(row: SiteSiteInfo) {
  store.setCurrent(row.id)
  router.push('/site/setting')
}

/**
 * 删站二次确认（R50：逐条列明影响，尤其是「文件可还原 / 文章评论不可恢复」的差异）。
 *
 * P16 追加：**先查本站挂靠的展示应用并逐一点名**——它们的目录在站点目录内（`disp/{id}/`），
 * 会随站点文件一并进回收站，且挂靠关系即刻失效。属主自服务数据，查询失败不阻断删除（降级为不点名）。
 */
async function onRemove(row: SiteSiteInfo) {
  let affiliated: DisplayItem[] = []
  try {
    affiliated = (await listDisplays()).filter((item) => item.siteId === String(row.id))
  } catch {
    affiliated = []
  }
  const displayNote =
    affiliated.length > 0
      ? `④ 本站挂着 ${affiliated.length} 个展示应用（${affiliated.map((item) => item.name).join('、')}）：` +
        '站点删除后它们会从站点上消失、页面文件随站点文件一并移入回收站；如需继续使用，请先从回收站还原文件，再重新挂到其他站点。'
      : '④ 本站没有挂着展示应用。'

  const confirmed = await confirmDialog(
    `确认删除站点「${row.title}（${row.slug}）」？` +
      '① 该站的评论将被彻底删除、文章将从本站下架（文章/栏目/标签本体保留在内容池，可再发表）；' +
      '② 站点文件（含 media/）移入云盘回收站，可还原为普通文件夹；' +
      `③ 站点标识会立即释放，他人可再次注册；` +
      displayNote,
    '删除站点',
    { type: 'warning', confirmButtonText: '确认删除', confirmButtonClass: 'el-button--danger' },
  )
  if (!confirmed) return
  try {
    const res = await deleteSite(row.id)
    ElMessage.success(
      `站点已删除（${res.unpublishedArticles} 篇文章已从本站下架、${res.deletedComments} 条评论已删除，站点文件已移入回收站` +
        (affiliated.length > 0 ? `；${affiliated.length} 个展示应用的页面文件已移入回收站` : '') +
        '）',
    )
    await store.load()
  } catch {
    // 拦截器提示
  }
}

onMounted(reload)
</script>

<style scoped>
.v-site-list {
  padding: 16px;
  background: #fff;
  border-radius: 6px;
  min-height: 100%;
}
.v-sl-quota {
  margin: 0 12px 0 4px;
  font-size: 13px;
  color: #909399;
}
.v-sl-tip {
  color: #909399;
  font-size: 12px;
  line-height: 1.7;
}
.v-sl-rel-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 12px 0;
}
</style>
