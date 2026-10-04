<script setup lang="ts">
/**
 * 展示应用卡片流（我的应用 ▸ 展示应用 Tab）。
 *
 * 由原独立页 `views/display/index.vue` 迁移并卡片化（P14 T128 / D112~D116）。
 * 展示应用 = 挂在站点上的**静态展示页**（目录在站点内 `disp/{id}/`）；数据读取靠「数据应用 → 展示应用」授权。
 *
 * 卡片元素（全部取自真实接口字段）：
 * - 名称 + 挂靠状态（站点名 / 云盘暂存区）；
 * - 云盘目录路径（folderPath，写文件基点）；
 * - 访问入口（urlPreview，未挂靠时提示「挂靠站点后可用」）；
 * - 已授权数据应用（grants）与创建时间；
 * - 操作：**打开云盘目录**（仅挂靠时；folderId 优先，目录未创建退回站点根）、复制入口地址、
 *   挂靠 / 授权 / 删除。目录跳转靠 `?dir={folderId}` 直达云盘对应目录（cloud/file/index.vue 支持）。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  affiliateDisplay,
  createDisplay,
  deleteDisplay,
  grantDisplay,
  listDisplays,
  revokeDisplay,
  type DisplayItem,
} from '@/api/display'
import { listApps } from '@/api/app'
import { listSites, publishSiteDisplay } from '@/api/site/site'
import { confirmDialog } from '@/utils/confirm'
import { formatTime } from '@/utils/format'
import DisplayReleasesDialog from './DisplayReleasesDialog.vue'

interface SiteOption {
  id: string
  slug: string
  title: string
}

interface AppOption {
  appCode: string
  name: string
  isPublic: number
  status: string
}

const router = useRouter()
/** 版本（检查点）面板（P20 T167）：由卡片按钮按需打开 */
const releasesDialog = ref<{
  open: (id: string, name: string, site: string | null) => void
} | null>(null)

const loading = ref(false)
const loadError = ref(false)
const list = ref<DisplayItem[]>([])
const sites = ref<SiteOption[]>([])
const apps = ref<AppOption[]>([])

/** 创建对话框 */
const createDialog = reactive({ visible: false, submitting: false, name: '', siteSlug: '' })
/** 挂靠对话框（'' = 取消挂靠回暂存区） */
const affiliateDialog = reactive({
  visible: false,
  submitting: false,
  id: '',
  name: '',
  siteSlug: '',
})
/** 授权对话框 */
const grantDialog = reactive({
  visible: false,
  submitting: false,
  id: '',
  name: '',
  selected: [] as string[],
})

const readyApps = computed(() => apps.value.filter((app) => app.status === 'active'))

async function load(): Promise<void> {
  loading.value = true
  loadError.value = false
  try {
    const [displays, siteResult, appList] = await Promise.all([
      listDisplays(),
      listSites(),
      listApps(),
    ])
    list.value = displays
    sites.value = (siteResult.list ?? []).map((site) => ({
      id: String(site.id),
      slug: site.slug,
      title: site.title,
    }))
    apps.value = appList.map((app) => {
      const extra = app as unknown as { isPublic?: number; status?: string }
      return {
        appCode: app.appCode,
        name: app.name,
        isPublic: Number(extra.isPublic ?? 0),
        status: String(extra.status ?? 'active'),
      }
    })
  } catch {
    list.value = []
    loadError.value = true
  } finally {
    loading.value = false
  }
}

onMounted(load)

defineExpose({ reload: load })

// ==================== 云盘目录直达 ====================

/**
 * 打开该展示页在云盘的工作区目录（P20 B1：目录**独立于站点树**）。
 *
 * 建展示应用时即创建其工作区目录，故 `folderId` 恒有值、按钮**不再依赖挂靠状态**、
 * 也**不再退化为跳站点根**；仅在目录被手动移入回收站等极端情况为 null。
 */
/** 正在发布的展示页 id（按钮 loading；同时只允许一个，避免用户连点产生并发发布） */
const publishingId = ref<string | null>(null)

/**
 * 把该展示页发布到它挂靠的站点（P20 T168）。
 *
 * 语义是「**只发这一个**」：以后端当前版本为蓝本只替换它的内容，站点页面与别的展示页
 * 一律不受影响——这样用户不必为了更新一个展示页而担心把别的半成品一起推上线。
 */
async function submitPublish(item: DisplayItem): Promise<void> {
  if (!item.siteId || publishingId.value) return
  const confirmed = await confirmDialog(
    `「${item.name}」现在的页面内容将替换到「${item.siteTitle ?? '站点'}」上对外生效。` +
      '站点里其它内容和别的展示页不受影响。',
    '发布这个展示页？',
  )
  if (!confirmed) return
  publishingId.value = item.id
  try {
    const release = await publishSiteDisplay(item.siteId, item.id)
    ElMessage.success(`已发布，站点当前版本为 v${release.versionNo}`)
  } catch {
    // 「站点还没发布过」这类原因由请求层统一提示（需先完整发布一次才能单独发布）
  } finally {
    publishingId.value = null
  }
}

/** 打开该展示页的版本（检查点）面板（P20 T167） */
function openVersions(item: DisplayItem): void {
  void releasesDialog.value?.open(item.id, item.name, item.siteTitle ?? null)
}

function openCloudDir(item: DisplayItem): void {
  const dir = item.folderId
  if (dir === null) {
    ElMessage.warning(
      '这个展示页的文件目录当前不可用（可能已被移入回收站）：在对话里写入页面文件可重新创建',
    )
    return
  }
  void router.push({ path: '/cloud/file', query: { dir } })
}

// ==================== 创建 ====================

function openCreate(): void {
  createDialog.name = ''
  createDialog.siteSlug = ''
  createDialog.visible = true
}

async function submitCreate(): Promise<void> {
  const name = createDialog.name.trim()
  if (!name) {
    ElMessage.warning('展示应用名必填')
    return
  }
  createDialog.submitting = true
  try {
    const created = await createDisplay({
      name,
      ...(createDialog.siteSlug ? { siteSlug: createDialog.siteSlug } : {}),
    })
    ElMessage.success(
      created.siteSlug
        ? `已创建，并挂到站点「${created.siteTitle ?? '所选站点'}」；写入页面文件后即可访问`
        : '已创建，页面文件暂存在云盘；挂到站点后即可对外访问',
    )
    createDialog.visible = false
    await load()
  } catch {
    // 请求层已提示（重名 50018 等）
  } finally {
    createDialog.submitting = false
  }
}

// ==================== 挂靠 ====================

function openAffiliate(item: DisplayItem): void {
  affiliateDialog.id = item.id
  affiliateDialog.name = item.name
  affiliateDialog.siteSlug = item.siteSlug ?? ''
  affiliateDialog.visible = true
}

async function submitAffiliate(): Promise<void> {
  affiliateDialog.submitting = true
  try {
    await affiliateDisplay(affiliateDialog.id, affiliateDialog.siteSlug || null)
    ElMessage.success(
      affiliateDialog.siteSlug
        ? '已挂到该站点，新的访问地址马上可用'
        : '已从站点取下，页面文件回到云盘',
    )
    affiliateDialog.visible = false
    await load()
  } catch {
    // 请求层已提示
  } finally {
    affiliateDialog.submitting = false
  }
}

// ==================== 授权 ====================

function openGrant(item: DisplayItem): void {
  grantDialog.id = item.id
  grantDialog.name = item.name
  grantDialog.selected = item.grants.map((grant) => grant.appCode)
  grantDialog.visible = true
}

async function submitGrant(): Promise<void> {
  const target = list.value.find((item) => item.id === grantDialog.id)
  const origin = new Set((target?.grants ?? []).map((grant) => grant.appCode))
  const next = new Set(grantDialog.selected)
  const toGrant = [...next].filter((code) => !origin.has(code))
  const toRevoke = [...origin].filter((code) => !next.has(code))
  if (toGrant.length === 0 && toRevoke.length === 0) {
    grantDialog.visible = false
    return
  }
  grantDialog.submitting = true
  const notes: string[] = []
  try {
    for (const appCode of toGrant) {
      const result = await grantDisplay(grantDialog.id, appCode)
      if (result.isPublic !== 1)
        notes.push(`${appNameOf(appCode)} 尚未开启「可被读取」，授权后站点仍读不到数据`)
    }
    for (const appCode of toRevoke) {
      await revokeDisplay(grantDialog.id, appCode)
    }
    ElMessage.success(`已保存授权（新增 ${toGrant.length} / 撤销 ${toRevoke.length}）`)
    if (notes.length > 0) ElMessage.warning(notes.join('；'))
    grantDialog.visible = false
    await load()
  } catch {
    // 请求层已提示
  } finally {
    grantDialog.submitting = false
  }
}

// ==================== 删除 / 复制入口 ====================

async function removeDisplay(item: DisplayItem): Promise<void> {
  const ok = await confirmDialog(
    `删除展示应用「${item.name}」？删除后它会从站点上取下、已授权的数据应用一并解除；页面文件仍保留在云盘，需要时可再建一个挂上去。`,
    '删除确认',
  )
  if (!ok) return
  try {
    await deleteDisplay(item.id)
    ElMessage.success('已删除（页面文件仍保留在云盘）')
    await load()
  } catch {
    // 请求层已提示
  }
}

async function copyUrl(item: DisplayItem): Promise<void> {
  const url = item.urlPreview ? `${window.location.origin}${item.urlPreview}` : ''
  if (!url) return
  try {
    await navigator.clipboard.writeText(url)
    ElMessage.success('访问链接已复制，可直接发给他人')
  } catch {
    ElMessage.error('复制失败，请手动选择后复制')
  }
}

/**
 * 授权项显示**应用名称**（面向用户，不暴露 `appCode` 这类内部标识）。
 * 名称取自本页已加载的「我的数据应用」清单；应用已被删除时退化显示 code（罕见，避免空标签）。
 */
function appNameOf(appCode: string): string {
  return apps.value.find((app) => app.appCode === appCode)?.name ?? appCode
}
</script>

<template>
  <div class="v-display-cards">
    <div class="v-display-cards__bar">
      <el-button
        type="primary"
        @click="openCreate"
      >
        新建应用
      </el-button>
      <el-button @click="load">
        刷新
      </el-button>
    </div>

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
      description="还没有展示应用（挂在站点上的展示页）"
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
      v-loading="loading"
      class="v-disp-grid"
    >
      <el-card
        v-for="item in list"
        :key="item.id"
        shadow="hover"
        class="v-disp-card"
      >
        <div class="v-disp-card__head">
          <span class="v-disp-card__name">{{ item.name }}</span>
          <el-tag
            v-if="item.siteSlug"
            size="small"
            type="success"
          >
            {{ item.siteTitle || item.siteSlug }}
          </el-tag>
          <el-tag
            v-else
            size="small"
            type="info"
          >
            云盘暂存区
          </el-tag>
        </div>

        <!-- 状态说明：只讲用户关心的事，不出现目录写路径、接口地址这类实现细节 -->
        <div class="v-disp-card__meta">
          <span v-if="item.folderId">
            页面文件在它自己的云盘目录里，可点「打开目录」查看；挂到站点并发布后才会对外访问。
          </span>
          <span v-else>页面文件还没开始写，写入后会出现在它的云盘目录里。</span>
          <span v-if="item.urlPreview">访问地址已生成，点「复制链接」即可分享。</span>
          <span v-else>挂到站点后才会生成访问地址。</span>
          <span>创建于 {{ formatTime(item.createdAt) }}</span>
        </div>

        <div class="v-disp-card__grants">
          <span class="v-disp-card__label">已授权数据应用</span>
          <template v-if="item.grants.length > 0">
            <el-tag
              v-for="grant in item.grants"
              :key="grant.appId"
              size="small"
              class="v-disp-card__tag"
            >
              {{ appNameOf(grant.appCode) }}
            </el-tag>
          </template>
          <span
            v-else
            class="v-disp-card__hint"
          > 还没授权：这个展示页目前读不到数据 </span>
        </div>

        <div class="v-disp-card__actions">
          <el-button
            size="small"
            type="primary"
            plain
            @click="openCloudDir(item)"
          >
            打开目录
          </el-button>
          <el-button
            v-if="item.urlPreview"
            size="small"
            plain
            @click="copyUrl(item)"
          >
            复制链接
          </el-button>
          <el-button
            size="small"
            plain
            @click="openVersions(item)"
          >
            版本
          </el-button>
          <el-button
            v-if="item.siteSlug"
            size="small"
            type="success"
            plain
            :loading="publishingId === item.id"
            @click="submitPublish(item)"
          >
            发布到站点
          </el-button>
          <el-button
            size="small"
            @click="openAffiliate(item)"
          >
            {{ item.siteSlug ? '更换站点' : '挂到站点' }}
          </el-button>
          <el-button
            size="small"
            @click="openGrant(item)"
          >
            授权
          </el-button>
          <el-button
            size="small"
            type="danger"
            text
            @click="removeDisplay(item)"
          >
            删除
          </el-button>
        </div>
      </el-card>
    </div>

    <!-- 创建 -->
    <el-dialog
      v-model="createDialog.visible"
      title="新建展示应用"
      width="480px"
    >
      <el-form label-width="90px">
        <el-form-item label="名称">
          <el-input
            v-model="createDialog.name"
            placeholder="如：作品展示、书单页"
            maxlength="40"
          />
        </el-form-item>
        <el-form-item label="挂到站点">
          <el-select
            v-model="createDialog.siteSlug"
            clearable
            placeholder="暂时不挂，以后再选也行"
            style="width: 100%"
          >
            <el-option
              v-for="site in sites"
              :key="site.id"
              :label="site.title"
              :value="site.slug"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createDialog.visible = false">
          取消
        </el-button>
        <el-button
          type="primary"
          :loading="createDialog.submitting"
          @click="submitCreate"
        >
          创建
        </el-button>
      </template>
    </el-dialog>

    <!-- 挂到站点 / 改挂 / 从站点取下 -->
    <el-dialog
      v-model="affiliateDialog.visible"
      :title="`挂到站点 · ${affiliateDialog.name}`"
      width="480px"
    >
      <el-form label-width="100px">
        <el-form-item label="挂到哪个站点">
          <el-select
            v-model="affiliateDialog.siteSlug"
            clearable
            placeholder="不选择 = 从站点上取下"
            style="width: 100%"
          >
            <el-option
              v-for="site in sites"
              :key="site.id"
              :label="site.title"
              :value="site.slug"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <el-alert
        type="warning"
        :closable="false"
        show-icon
        title="挂到站点后，这个展示页就能通过该站点访问：原访问地址立即失效，新访问地址马上可用。不选择站点则从站点上取下（页面文件会回到云盘，不再对外访问）。"
      />
      <template #footer>
        <el-button @click="affiliateDialog.visible = false">
          取消
        </el-button>
        <el-button
          type="primary"
          :loading="affiliateDialog.submitting"
          @click="submitAffiliate"
        >
          保存
        </el-button>
      </template>
    </el-dialog>

    <!-- 授权数据应用 -->
    <el-dialog
      v-model="grantDialog.visible"
      :title="`授权数据应用 · ${grantDialog.name}`"
      width="560px"
    >
      <p class="v-disp-card__grant-tip">
        勾选后，这个展示页就能读取对应数据应用里的数据。
      </p>
      <el-checkbox-group v-model="grantDialog.selected">
        <div
          v-for="app in readyApps"
          :key="app.appCode"
          class="v-disp-card__grant-row"
        >
          <el-checkbox :value="app.appCode">
            {{ app.name }}
          </el-checkbox>
          <el-tooltip
            v-if="app.isPublic !== 1"
            content="该数据应用还没开启「可被读取」，此时授权也不会生效——请先到数据应用里打开该开关。"
            placement="top"
          >
            <el-tag
              size="small"
              type="warning"
            >
              未开启「可被读取」
            </el-tag>
          </el-tooltip>
        </div>
      </el-checkbox-group>
      <el-empty
        v-if="readyApps.length === 0"
        description="还没有已入册的数据应用"
      />
      <template #footer>
        <el-button @click="grantDialog.visible = false">
          取消
        </el-button>
        <el-button
          type="primary"
          :loading="grantDialog.submitting"
          @click="submitGrant"
        >
          保存
        </el-button>
      </template>
    </el-dialog>

    <DisplayReleasesDialog ref="releasesDialog" />
  </div>
</template>

<style scoped>
.v-display-cards__bar {
  margin-bottom: 12px;
}

.v-disp-card__grant-tip {
  margin: 0 0 8px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

/* 卡片流（与「我的应用」数据应用卡片同一视觉语言） */
.v-disp-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 12px;
}

.v-disp-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.v-disp-card__name {
  font-weight: 600;
  font-size: 15px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.v-disp-card__meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  margin-bottom: 8px;
}

.v-disp-card__grants {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding-top: 8px;
  border-top: 1px solid var(--el-border-color-lighter);
}

.v-disp-card__label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.v-disp-card__tag {
  margin-right: 0;
}

.v-disp-card__hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.v-disp-card__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

.v-disp-card__actions :deep(.el-button + .el-button) {
  margin-left: 0;
}

.v-disp-card__grant-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 0;
}
</style>
