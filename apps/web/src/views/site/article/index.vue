<template>
  <div class="v-site-article">
    <SiteSwitcher />
    <ProTable
      :data="list"
      :loading="loading"
      :load-error="loadError"
      :total="total"
      :page-no="pageNo"
      :page-size="pageSize"
      @retry="reload"
      @page-change="onPageChange"
      @size-change="onSizeChange"
    >
      <template #search>
        <el-form-item label="栏目">
          <el-select
            v-model="filterColumnId"
            clearable
            style="width: 160px"
          >
            <el-option
              v-for="c in flatColumns"
              :key="c.id"
              :label="c.name"
              :value="Number(c.id)"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select
            v-model="filterStatus"
            clearable
            style="width: 120px"
          >
            <el-option
              label="已发布"
              :value="1"
            />
            <el-option
              label="草稿"
              :value="0"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="关键词">
          <el-input
            v-model="filterKeyword"
            placeholder="按标题搜索"
            clearable
            style="width: 180px"
            @keyup.enter="reload"
            @clear="reload"
          />
        </el-form-item>
      </template>
      <template #toolbar>
        <el-button
          v-permission="'site:article:create'"
          type="primary"
          :icon="Plus"
          @click="openCreate"
        >
          新增文章
        </el-button>
        <el-button
          :icon="Refresh"
          @click="reload"
        >
          刷新
        </el-button>
      </template>
      <el-table-column
        label="标题"
        min-width="240"
      >
        <template #default="{ row }">
          <el-link
            type="primary"
            @click="openPreview(row)"
          >
            {{ row.title }}
          </el-link>
        </template>
      </el-table-column>
      <el-table-column
        label="栏目"
        width="120"
        prop="columnName"
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
            {{ row.status === 1 ? '已发布' : '草稿' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column
        label="字数"
        width="90"
        prop="wordCount"
      />
      <el-table-column
        label="查看数"
        width="90"
        prop="viewCount"
      />
      <el-table-column
        label="发布时间"
        width="170"
        :formatter="(r: SiteArticleItem) => r.publishedAt ? formatTime(r.publishedAt) : '-'"
      />
      <el-table-column
        label="更新时间"
        width="170"
        :formatter="(r: SiteArticleItem) => formatTime(r.updatedAt)"
      />
      <el-table-column
        label="操作"
        width="240"
        fixed="right"
      >
        <template #default="{ row }">
          <el-button
            v-permission="'site:article:update'"
            link
            type="primary"
            @click="openEdit(row)"
          >
            编辑
          </el-button>
          <el-button
            v-permission="'site:article:publish'"
            link
            :type="row.status === 1 ? 'warning' : 'success'"
            @click="onToggleStatus(row)"
          >
            {{ row.status === 1 ? '下架' : '发布' }}
          </el-button>
          <el-button
            v-permission="'site:article:delete'"
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
          :description="emptyText"
        />
      </template>
    </ProTable>

    <!-- 编辑弹窗：编辑 + 预览双栏 -->
    <el-dialog
      v-model="editorVisible"
      :title="editingId ? '编辑文章' : '新增文章'"
      width="82%"
      top="4vh"
      :close-on-click-modal="false"
      destroy-on-close
    >
      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-width="80px"
      >
        <el-row :gutter="16">
          <el-col :span="8">
            <el-form-item
              label="栏目"
              prop="columnId"
            >
              <el-select
                v-model="form.columnId"
                style="width: 100%"
              >
                <el-option
                  v-for="c in flatColumns"
                  :key="c.id"
                  :label="c.name"
                  :value="Number(c.id)"
                />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="10">
            <el-form-item
              label="标题"
              prop="title"
            >
              <el-input
                v-model="form.title"
                maxlength="100"
                show-word-limit
              />
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="标签">
              <el-select
                v-model="form.tagIds"
                multiple
                style="width: 100%"
                placeholder="可多选"
              >
                <el-option
                  v-for="t in tags"
                  :key="t.id"
                  :label="t.name"
                  :value="Number(t.id)"
                />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="18">
            <el-form-item label="摘要">
              <el-input
                v-model="form.summary"
                maxlength="200"
                show-word-limit
                placeholder="留空自动取正文纯文本前 100 字"
              />
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="封面">
              <div class="v-sa-cover">
                <img
                  v-if="form.coverPath"
                  class="v-sa-cover-img"
                  :src="coverPreviewUrl"
                  alt="cover"
                >
                <el-button
                  v-permission="'cloud:file:upload'"
                  :loading="coverUploading"
                  @click="coverInput?.click()"
                >
                  {{ form.coverPath ? '重新上传' : '上传封面' }}
                </el-button>
                <el-button
                  v-if="form.coverPath"
                  link
                  type="danger"
                  @click="form.coverPath = ''"
                >
                  清除
                </el-button>
                <input
                  ref="coverInput"
                  type="file"
                  accept="image/*"
                  hidden
                  @change="onCoverPick"
                >
              </div>
              <div class="v-sa-tip">
                落站点 media/ 目录，相对路径 {{ form.coverPath || 'media/xxx.png' }}
              </div>
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>

      <el-row :gutter="16">
        <el-col :span="12">
          <div class="v-sa-pane-title">
            <span>
              正文（markdown）
              <el-button
                v-permission="'cloud:file:upload'"
                link
                type="primary"
                size="small"
                :loading="imageUploading"
                @click="imageInput?.click()"
              >
                插入图片（落 media/）
              </el-button>
              <input
                ref="imageInput"
                type="file"
                accept="image/*"
                hidden
                @change="onImagePick"
              >
            </span>
            <el-radio-group
              v-model="form.status"
              size="small"
            >
              <el-radio-button :value="0">
                存草稿
              </el-radio-button>
              <el-radio-button :value="1">
                发布
              </el-radio-button>
            </el-radio-group>
          </div>
          <el-input
            v-model="form.contentMd"
            type="textarea"
            :rows="18"
            class="v-sa-editor"
            placeholder="支持 markdown 语法"
          />
        </el-col>
        <el-col :span="12">
          <div class="v-sa-pane-title">
            预览
            <span class="v-sa-tip">渲染禁用 raw HTML</span>
          </div>
          <div class="v-sa-preview">
            <MarkdownView :content="form.contentMd" />
          </div>
        </el-col>
      </el-row>

      <template #footer>
        <el-button @click="editorVisible = false">
          取消
        </el-button>
        <el-button
          type="primary"
          :loading="submitting"
          @click="submit"
        >
          {{ form.status === 1 ? '保存并发布' : '保存草稿' }}
        </el-button>
      </template>
    </el-dialog>

    <!-- 只读预览弹窗 -->
    <el-dialog
      v-model="previewVisible"
      :title="previewRow?.title"
      width="72%"
      top="4vh"
    >
      <p class="v-sa-meta">
        {{ previewRow?.columnName }} · {{ previewRow?.wordCount }} 字 ·
        {{ previewRow?.publishedAt ? formatTime(previewRow.publishedAt) : '未发布' }}
      </p>
      <p
        v-if="previewRow?.summary"
        class="v-sa-summary"
      >
        {{ previewRow.summary }}
      </p>
      <MarkdownView
        v-if="previewContent"
        :content="previewContent"
      />
      <div
        v-loading="previewLoading"
        class="v-sa-preview-loading"
      />
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Refresh } from '@element-plus/icons-vue'
import type { FormInstance, FormRules } from 'element-plus'
import ProTable from '@/components/ProTable/index.vue'
import MarkdownView from '@/components/MarkdownView/index.vue'
import SiteSwitcher from '@/components/SiteSwitcher/index.vue'
import { formatTime } from '@/utils/format'
import {
  listArticles,
  getArticle,
  createArticle,
  updateArticle,
  updateArticleStatus,
  removeArticle,
  listColumns,
  listTags,
} from '@/api/site/site'
import { uploadFile } from '@/api/cloud/file'
import { useSiteStore } from '@/stores/site'
import type { SiteArticleItem, SiteColumnItem, SiteTagItem } from '@/types/api'

const siteStore = useSiteStore()
const loading = ref(false)
const loadError = ref(false)
const list = ref<SiteArticleItem[]>([])
const total = ref(0)
const pageNo = ref(1)
const pageSize = ref(10)

const filterColumnId = ref<number | undefined>()
const filterStatus = ref<number | undefined>()
const filterKeyword = ref('')

const columns = ref<SiteColumnItem[]>([])
const tags = ref<SiteTagItem[]>([])
/** 当前站点（封面/插图上传落 media/ 用，D13；P4E 由 store 提供） */
const currentSite = computed(() => siteStore.currentSite)

const coverInput = ref<HTMLInputElement>()
const imageInput = ref<HTMLInputElement>()
const coverUploading = ref(false)
const imageUploading = ref(false)

/** 无站点时的空态文案（P4E：站点为 0 时不做接口请求） */
const emptyText = computed(() => (siteStore.empty ? '还没有站点，请先到「站点列表」创建' : '还没有文章'))

/** 封面回显：完整公开 URL（走开放静态链路） */
const coverPreviewUrl = computed(() =>
  form.coverPath && currentSite.value ? `/api/open/${currentSite.value.slug}/${form.coverPath}` : '',
)

const editorVisible = ref(false)
const previewVisible = ref(false)
const submitting = ref(false)
const formRef = ref<FormInstance>()
const editingId = ref(0)
const form = reactive({
  columnId: undefined as number | undefined,
  title: '',
  summary: '',
  tagIds: [] as number[],
  coverPath: '',
  contentMd: '',
  status: 0,
})
const rules: FormRules = {
  columnId: [{ required: true, message: '请选择栏目', trigger: 'change' }],
  title: [{ required: true, message: '请输入标题', trigger: 'blur' }],
  contentMd: [{ required: true, message: '请输入正文', trigger: 'blur' }],
}

const previewRow = ref<SiteArticleItem | null>(null)
const previewContent = ref('')
const previewLoading = ref(false)

/** 栏目平铺（下拉用，含缩进层级） */
const flatColumns = computed<SiteColumnItem[]>(() => {
  const result: SiteColumnItem[] = []
  const walk = (items: SiteColumnItem[], depth: number) => {
    for (const item of items) {
      result.push({ ...item, name: `${'　'.repeat(depth)}${item.name}` })
      walk(item.children ?? [], depth + 1)
    }
  }
  walk(buildTree(columns.value), 0)
  return result
})

function buildTree(items: SiteColumnItem[]): SiteColumnItem[] {
  const nodes = new Map<string, SiteColumnItem>()
  const roots: SiteColumnItem[] = []
  for (const c of items) nodes.set(c.id, { ...c, children: [] })
  for (const c of items) {
    const node = nodes.get(c.id)!
    if (c.parentId === '0' || !nodes.get(c.parentId)) roots.push(node)
    else nodes.get(c.parentId)!.children!.push(node)
  }
  return roots
}

async function reload() {
  loadError.value = false
  if (!siteStore.currentSiteId) {
    list.value = []
    total.value = 0
    return
  }
  loading.value = true
  try {
    const res = await listArticles({
      pageNo: pageNo.value,
      pageSize: pageSize.value,
      siteId: Number(siteStore.currentSiteId),
      columnId: filterColumnId.value,
      status: filterStatus.value,
      keyword: filterKeyword.value.trim() || undefined,
    })
    list.value = res.list
    total.value = res.total
  } catch {
    list.value = []
    loadError.value = true
  } finally {
    loading.value = false
  }
}

function onPageChange(page: number) {
  pageNo.value = page
  reload()
}

function onSizeChange(size: number) {
  pageSize.value = size
  pageNo.value = 1
  reload()
}

async function loadMeta() {
  if (!siteStore.currentSiteId) {
    columns.value = []
    tags.value = []
    return
  }
  const [cols, tgs] = await Promise.all([
    listColumns(siteStore.currentSiteId),
    listTags(siteStore.currentSiteId),
  ])
  columns.value = cols
  tags.value = tgs
}

/** 上传封面：落 media/（站点媒体目录），回填相对路径并回显（D13） */
async function onCoverPick(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  target.value = ''
  if (!file || !currentSite.value) return
  coverUploading.value = true
  try {
    const created = await uploadFile(Number(currentSite.value.mediaFolderId), file)
    form.coverPath = `media/${created.name}`
    ElMessage.success('封面上传完成')
  } catch {
    // 拦截器提示
  } finally {
    coverUploading.value = false
  }
}

/** 正文插入图片：上传至 media/ 后在光标处插入 markdown 图片语法（公开 URL 相对路径） */
async function onImagePick(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  target.value = ''
  if (!file || !currentSite.value) return
  imageUploading.value = true
  try {
    const created = await uploadFile(Number(currentSite.value.mediaFolderId), file)
    const snippet = `\n![${created.name}](media/${created.name})\n`
    form.contentMd = `${form.contentMd}${snippet}`
    ElMessage.success('图片已插入')
  } catch {
    // 拦截器提示
  } finally {
    imageUploading.value = false
  }
}

function openCreate() {
  editingId.value = 0
  form.columnId = flatColumns.value[0] ? Number(flatColumns.value[0].id) : undefined
  form.title = ''
  form.summary = ''
  form.tagIds = []
  form.coverPath = ''
  form.contentMd = ''
  form.status = 0
  editorVisible.value = true
}

async function openEdit(row: SiteArticleItem) {
  editingId.value = Number(row.id)
  try {
    const detail = await getArticle(Number(row.id))
    form.columnId = Number(detail.columnId)
    form.title = detail.title
    form.summary = detail.summary
    form.tagIds = detail.tagIds.map(Number)
    form.coverPath = detail.coverPath ?? ''
    form.contentMd = detail.contentMd
    form.status = detail.status
    editorVisible.value = true
  } catch {
    // 拦截器提示（40109）
  }
}

async function submit() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  submitting.value = true
  const payload = {
    columnId: form.columnId!,
    title: form.title,
    summary: form.summary || undefined,
    tagIds: form.tagIds,
    // 完整相对路径（media/xxx.png），media/ 前缀由后端 40105 兜底校验
    coverPath: form.coverPath || undefined,
    contentMd: form.contentMd,
    status: form.status,
  }
  try {
    if (editingId.value) {
      await updateArticle(editingId.value, payload)
      ElMessage.success(form.status === 1 ? '已保存并发布' : '已保存草稿')
    } else {
      // P4E：新建以请求 siteId 为准（更新按实体反查属主，不带 siteId）
      await createArticle({ ...payload, siteId: Number(siteStore.currentSiteId) })
      ElMessage.success(form.status === 1 ? '已发布' : '已存草稿')
    }
    editorVisible.value = false
    reload()
  } catch {
    // 拦截器提示（40105 封面 / 40106 栏目 / 40400 标签）
  } finally {
    submitting.value = false
  }
}

/** 发布/下架（状态机：首次发布由后端写发布时间，下架再上架不刷新） */
async function onToggleStatus(row: SiteArticleItem) {
  const publishing = row.status !== 1
  if (publishing) {
    await ElMessageBox.confirm(`确认发布「${row.title}」？`, '提示', { type: 'info' })
  }
  try {
    await updateArticleStatus(Number(row.id), publishing ? 1 : 0)
    ElMessage.success(publishing ? '已发布' : '已下架')
    reload()
  } catch {
    // 拦截器提示
  }
}

async function onRemove(row: SiteArticleItem) {
  await ElMessageBox.confirm(`确认删除「${row.title}」？正文、标签关联与全部评论将被物理删除，不可恢复`, '警告', {
    type: 'warning',
  })
  try {
    await removeArticle(Number(row.id))
    ElMessage.success('已删除')
    reload()
  } catch {
    // 拦截器提示
  }
}

/** 只读预览：复用 MarkdownView 渲染正文 */
async function openPreview(row: SiteArticleItem) {
  previewRow.value = row
  previewContent.value = ''
  previewVisible.value = true
  previewLoading.value = true
  try {
    const detail = await getArticle(Number(row.id))
    previewContent.value = detail.contentMd
  } catch {
    previewContent.value = ''
  } finally {
    previewLoading.value = false
  }
}

onMounted(async () => {
  await siteStore.ensureLoaded().catch(() => undefined)
  reload()
  await loadMeta().catch(() => undefined)
})

// 切换当前站点 → 回到第一页、重拉列表与栏目/标签元数据（P4E D54）
watch(
  () => siteStore.currentSiteId,
  () => {
    pageNo.value = 1
    reload()
    loadMeta().catch(() => undefined)
  },
)
</script>

<style scoped>
.v-site-article {
  padding: 16px;
  background: #fff;
  border-radius: 6px;
  min-height: 100%;
}
.v-sa-pane-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  color: var(--el-text-color-regular);
  font-size: 13px;
}
.v-sa-tip {
  color: #909399;
  font-size: 12px;
}
.v-sa-editor :deep(textarea) {
  font-family: Consolas, Monaco, monospace;
  font-size: 13px;
}
.v-sa-preview {
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
  padding: 12px;
  height: 480px;
  overflow: auto;
}
.v-sa-meta {
  color: #909399;
  font-size: 13px;
  margin-bottom: 8px;
}
.v-sa-summary {
  color: #606266;
  font-size: 13px;
  background: #f5f7fa;
  border-radius: 4px;
  padding: 8px 12px;
  margin-bottom: 12px;
}
.v-sa-preview-loading {
  min-height: 60px;
}
.v-sa-cover {
  display: flex;
  align-items: center;
  gap: 8px;
}
.v-sa-cover-img {
  width: 64px;
  height: 40px;
  object-fit: cover;
  border-radius: 4px;
  border: 1px solid var(--el-border-color-lighter);
}
</style>
