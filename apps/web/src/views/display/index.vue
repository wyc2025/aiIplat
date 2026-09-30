<script setup lang="ts">
/**
 * 展示应用管理（P14 T128 / D112~D116，API-P14 §21.1-1~6）。
 *
 * 展示应用 = 挂在站点上的**静态展示页**（AI 生成 HTML/CSS/JS，文件在站点目录 `disp/{id}/`）；
 * 数据读取靠「数据应用 → 展示应用」授权（授权两跳的第一跳），站点页经同源取数面只读读取。
 */
import { computed, onMounted, reactive, ref } from 'vue'
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
    const [displays, siteResult, appList] = await Promise.all([listDisplays(), listSites(), listApps()])
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
    ElMessage.success(affiliateDialog.siteSlug ? '已挂靠（目录已移动）' : '已取消挂靠（回到暂存区）')
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
  const ok = await confirmDialog(`删除展示应用「${item.name}」？授权关系一并清除（目录保留在云盘）`, '删除确认')
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
  <div class="v-display">
    <el-alert
      type="info"
      :closable="false"
      show-icon
      class="v-display__tip"
    >
      <template #title>
        展示应用 = 挂在站点上的静态展示页（HTML/CSS/JS，目录在站点内 disp/ 下）。页面文件由 AI 写入
        （对话里说「建一个展示应用」）；要读数据时把「我的应用」里的数据应用授权给它。
      </template>
    </el-alert>

    <div class="v-display__bar">
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

    <el-table
      v-loading="loading"
      :data="list"
      :empty-text="loadError ? '加载失败，请重试' : '还没有展示应用'"
    >
      <el-table-column
        prop="name"
        label="名称"
        min-width="140"
      />
      <el-table-column
        label="挂靠站点"
        min-width="160"
      >
        <template #default="{ row }">
          <el-tag
            v-if="row.siteSlug"
            size="small"
            type="success"
          >
            {{ row.siteTitle || row.siteSlug }}
          </el-tag>
          <el-tag
            v-else
            size="small"
            type="info"
          >
            云盘暂存区（不对外）
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column
        label="访问入口"
        min-width="220"
      >
        <template #default="{ row }">
          <template v-if="row.urlPreview">
            <el-button
              link
              type="primary"
              @click="copyUrl(row as DisplayItem)"
            >
              复制入口地址
            </el-button>
            <span class="v-display__hint">{{ row.urlPreview }}</span>
          </template>
          <span
            v-else
            class="v-display__hint"
          >
            挂靠站点后可用
          </span>
        </template>
      </el-table-column>
      <el-table-column
        label="已授权数据应用"
        min-width="180"
      >
        <template #default="{ row }">
          <el-tag
            v-for="grant in row.grants"
            :key="grant.appId"
            class="v-display__tag"
            size="small"
          >
            {{ grant.appCode }}
          </el-tag>
          <span
            v-if="row.grants.length === 0"
            class="v-display__hint"
          >
            未授权
          </span>
        </template>
      </el-table-column>
      <el-table-column
        label="创建时间"
        width="160"
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
          <el-button
            link
            type="primary"
            @click="openAffiliate(row as DisplayItem)"
          >
            挂靠
          </el-button>
          <el-button
            link
            type="primary"
            @click="openGrant(row as DisplayItem)"
          >
            授权
          </el-button>
          <el-button
            link
            type="danger"
            @click="removeDisplay(row as DisplayItem)"
          >
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>

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
          class="v-display__grant-row"
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
.v-display__tip {
  margin-bottom: 12px;
}

.v-display__bar {
  margin-bottom: 12px;
}

.v-display__tag {
  margin-right: 6px;
}

.v-display__hint {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  margin-left: 6px;
}

.v-display__grant-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 2px 0;
}
</style>
