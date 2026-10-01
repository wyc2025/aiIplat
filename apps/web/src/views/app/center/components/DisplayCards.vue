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
import { listSites } from '@/api/site/site'
import { confirmDialog } from '@/utils/confirm'
import { formatTime } from '@/utils/format'

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
 * 打开该展示应用在云盘的目录（仅挂靠时有意义）。
 * 目录节点 id 由后端按 `{slug}/disp/{id}` 解析；**目录尚未创建**（挂靠本身不建目录，写文件时才
 * `mkdir -p`）时退回站点根目录，让用户仍能看到站点目录结构。
 */
function openCloudDir(item: DisplayItem): void {
  const dir = item.folderId ?? item.siteRootFolderId
  if (dir === null) {
    ElMessage.warning('站点目录尚未创建（写入第一个页面文件后自动创建）')
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
        ? `已创建并挂靠站点「${created.siteSlug}」：文件写到 ${created.writePath}/`
        : `已创建（云盘暂存区）：文件写到 ${created.writePath}/`,
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
      affiliateDialog.siteSlug ? '已挂靠（目录已移动）' : '已取消挂靠（回到暂存区）',
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
      if (result.isPublic !== 1) notes.push(`${appCode} 尚未开启「可被读取」，站点取数仍会 40400`)
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
    `删除展示应用「${item.name}」？授权关系一并清除（目录保留在云盘）`,
    '删除确认',
  )
  if (!ok) return
  try {
    await deleteDisplay(item.id)
    ElMessage.success('已删除')
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
    ElMessage.success('入口地址已复制')
  } catch {
    ElMessage.error('复制失败，请手动复制')
  }
}
</script>

<template>
  <div class="v-display-cards">
    <div class="v-display-cards__bar">
      <el-button
        type="primary"
        @click="openCreate"
      >
        新建展示应用
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
      description="还没有展示应用"
    >
      <el-button
        type="primary"
        @click="openCreate"
      >
        新建展示应用
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

        <div class="v-disp-card__meta">
          <span>目录：{{ item.folderPath }}</span>
          <span v-if="item.urlPreview"> 入口：{{ item.urlPreview }} </span>
          <span v-else>入口：挂靠站点后可用</span>
          <span>创建：{{ formatTime(item.createdAt) }}</span>
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
              {{ grant.appCode }}
            </el-tag>
          </template>
          <span
            v-else
            class="v-disp-card__hint"
          > 未授权（站点页读不到数据） </span>
        </div>

        <div class="v-disp-card__actions">
          <el-button
            v-if="item.siteSlug"
            size="small"
            type="primary"
            plain
            @click="openCloudDir(item)"
          >
            打开云盘目录
          </el-button>
          <el-button
            v-if="item.urlPreview"
            size="small"
            plain
            @click="copyUrl(item)"
          >
            复制入口地址
          </el-button>
          <el-button
            size="small"
            @click="openAffiliate(item)"
          >
            {{ item.siteSlug ? '换挂靠' : '挂靠' }}
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
        <el-form-item label="挂靠站点">
          <el-select
            v-model="createDialog.siteSlug"
            clearable
            placeholder="留空 = 云盘暂存区（稍后可挂靠）"
            style="width: 100%"
          >
            <el-option
              v-for="site in sites"
              :key="site.id"
              :label="`${site.title}（${site.slug}）`"
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

    <!-- 挂靠 / 换挂靠 / 取消挂靠 -->
    <el-dialog
      v-model="affiliateDialog.visible"
      :title="`挂靠设置 · ${affiliateDialog.name}`"
      width="480px"
    >
      <el-form label-width="90px">
        <el-form-item label="目标站点">
          <el-select
            v-model="affiliateDialog.siteSlug"
            clearable
            placeholder="留空 = 取消挂靠（回到暂存区）"
            style="width: 100%"
          >
            <el-option
              v-for="site in sites"
              :key="site.id"
              :label="`${site.title}（${site.slug}）`"
              :value="site.slug"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <el-alert
        type="warning"
        :closable="false"
        show-icon
        title="挂靠 = 把展示应用目录移动到目标站点目录（同一事务；中断自动回滚）。换站后旧地址即刻 404、新地址即刻可用。"
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

    <!-- 授权 -->
    <el-dialog
      v-model="grantDialog.visible"
      :title="`授权数据应用 · ${grantDialog.name}`"
      width="560px"
    >
      <el-checkbox-group v-model="grantDialog.selected">
        <div
          v-for="app in readyApps"
          :key="app.appCode"
          class="v-disp-card__grant-row"
        >
          <el-checkbox :value="app.appCode">
            {{ app.name }}（{{ app.appCode }}）
          </el-checkbox>
          <el-tag
            v-if="app.isPublic !== 1"
            size="small"
            type="warning"
          >
            未开启「可被读取」
          </el-tag>
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
  </div>
</template>

<style scoped>
.v-display-cards__bar {
  margin-bottom: 12px;
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
