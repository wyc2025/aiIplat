<template>
  <div class="v-site-article">
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
        <!-- P7 D73：内容归用户，列表默认出全部内容池文章；站点降为「已发表到该站」筛选 -->
        <el-form-item label="发表站点">
          <el-select
            v-model="filterSiteId"
            clearable
            style="width: 160px"
            placeholder="全部站点"
          >
            <el-option
              v-for="s in siteStore.sites"
              :key="s.id"
              :label="s.title"
              :value="Number(s.id)"
            />
          </el-select>
        </el-form-item>
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
        label="展示站点"
        min-width="180"
      >
        <template #default="{ row }">
          <span
            v-for="s in row.sites"
            :key="s.id"
            class="v-sa-site-tag"
          >
            <el-tag
              size="small"
              :type="s.isTop ? 'warning' : 'info'"
            >
              {{ s.name }}{{ s.isTop ? ' · 置顶' : '' }}
            </el-tag>
          </span>
          <span v-if="!row.sites.length">未发表</span>
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
          <el-col :span="24">
            <el-form-item label="发表站点">
              <el-select
                v-model="form.siteIds"
                multiple
                style="width: 100%"
                placeholder="不选 = 仅入内容池（各站不可见）"
              >
                <el-option
                  v-for="s in siteStore.sites"
                  :key="s.id"
                  :label="s.title"
                  :value="Number(s.id)"
                />
              </el-select>
              <div
                v-if="form.siteIds.length"
                class="v-sa-tops"
              >
                <el-checkbox
                  v-for="sid in form.siteIds"
                  :key="sid"
                  :model-value="form.topSiteIds.includes(sid)"
                  @change="(v: boolean) => toggleTop(sid, v)"
                >
                  {{ siteName(sid) }} 置顶
                </el-checkbox>
              </div>
              <div class="v-sa-tip">
                可发表到多个站点，每站独立置顶；不选 = 只进内容池，随时可再发表
              </div>
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
              <!-- P7：内容池化后封面上传仍要落到具体站点的 media/（D13），故保留「上传到哪个站」 -->
              <el-select
                v-if="siteStore.sites.length > 1"
                v-model="uploadSiteId"
                size="small"
                style="width: 100%; margin-bottom: 6px"
              >
                <el-option
                  v-for="s in siteStore.sites"
                  :key="s.id"
                  :label="`上传到：${s.title}`"
                  :value="Number(s.id)"
                />
              </el-select>
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
              <!-- 格式按钮（P6 T80/D71）：选中文本包裹 markdown 语法，零依赖 -->
              <el-button
                link
                type="primary"
                size="small"
                @click="wrapMarkdown('**', '**', '粗体')"
              >
                粗体
              </el-button>
              <el-button
                link
                type="primary"
                size="small"
                @click="wrapMarkdown('*', '*', '斜体')"
              >
                斜体
              </el-button>
              <el-button
                link
                type="primary"
                size="small"
                @click="wrapMarkdown('[', '](https://)', '链接文字')"
              >
                链接
              </el-button>
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
              <!-- P8 T88：导入已有文件（云盘选择或本地上传，解析后填入表单，不直接落库） -->
              <el-dropdown
                trigger="click"
                @command="onImportCommand"
              >
                <el-button
                  link
                  type="primary"
                  size="small"
                  :loading="importing"
                >
                  导入文件
                  <el-icon><ArrowDown /></el-icon>
                </el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="cloud">
                      从云盘选择
                    </el-dropdown-item>
                    <el-dropdown-item command="local">
                      上传本地文件
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
              <input
                ref="sourceInput"
                type="file"
                accept=".md,.markdown,.txt"
                hidden
                @change="onSourcePick"
              >
              <!-- P8 T89：一键排版（先出 diff 预览，确认后才改写正文） -->
              <el-button
                link
                type="primary"
                size="small"
                :loading="formatting"
                @click="runFormat"
              >
                一键排版
              </el-button>
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
            ref="contentInputRef"
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

    <!-- 从云盘选择要导入的文件（P8 T88：公共组件，按扩展名白名单过滤可选文件） -->
    <FilePicker
      v-model:visible="pickerVisible"
      title="选择要导入的 Markdown / 文本文件"
      :accept-exts="['md', 'markdown', 'txt']"
      @select="onPickCloudFile"
    />

    <!-- 一键排版 diff 预览（P8 T89：只读双栏，确认后才改写正文） -->
    <DiffView
      v-model:visible="diffVisible"
      title="一键排版预览"
      :before="diffBefore"
      :after="diffAfter"
      left-label="排版前"
      right-label="排版后"
    >
      <template #footer>
        <el-button @click="diffVisible = false">
          取消
        </el-button>
        <el-button
          type="primary"
          @click="applyFormat"
        >
          应用排版
        </el-button>
      </template>
    </DiffView>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { confirmDialog } from '@/utils/confirm'
import { ArrowDown, Plus, Refresh } from '@element-plus/icons-vue'
import type { FormInstance, FormRules } from 'element-plus'
import ProTable from '@/components/ProTable/index.vue'
import MarkdownView from '@/components/MarkdownView/index.vue'
import FilePicker from '@/components/FilePicker/index.vue'
import DiffView from '@/components/DiffView/index.vue'
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
  setArticleSites,
  importArticleFile,
  formatArticle,
} from '@/api/site/site'
import type { ArticleImportResult } from '@/api/site/site'
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

const filterSiteId = ref<number | undefined>()
const filterColumnId = ref<number | undefined>()
const filterStatus = ref<number | undefined>()
const filterKeyword = ref('')

const columns = ref<SiteColumnItem[]>([])
const tags = ref<SiteTagItem[]>([])
/** 封面/插图上传的落点站点（默认当前站；P7 内容池化后仅在多站时可切） */
const uploadSiteId = ref<number | undefined>(
  siteStore.currentSiteId ? Number(siteStore.currentSiteId) : undefined,
)
/** 上传目标站点对象（取 media 目录用） */
const currentSite = computed(
  () => siteStore.sites.find((s) => Number(s.id) === uploadSiteId.value) ?? siteStore.currentSite,
)

/** 站点名（置顶勾选回显用） */
function siteName(id: number): string {
  return siteStore.sites.find((s) => Number(s.id) === id)?.title ?? String(id)
}

/** 置顶开关（每站独立） */
function toggleTop(siteId: number, checked: boolean) {
  const exists = form.topSiteIds.includes(siteId)
  if (checked && !exists) form.topSiteIds.push(siteId)
  if (!checked && exists) form.topSiteIds = form.topSiteIds.filter((v) => v !== siteId)
}

const coverInput = ref<HTMLInputElement>()
const imageInput = ref<HTMLInputElement>()
const coverUploading = ref(false)
const imageUploading = ref(false)
/** 正文输入框（格式按钮需读取 textarea 的选区，P6 T80） */
const contentInputRef = ref<{ textarea?: HTMLTextAreaElement; $el?: HTMLElement }>()

/** 取正文 textarea 原生元素（Element Plus 暴露 textarea ref；兜底 DOM 查询） */
function textareaEl(): HTMLTextAreaElement | null {
  const instance = contentInputRef.value
  if (!instance) return null
  if (instance.textarea) return instance.textarea
  return instance.$el?.querySelector('textarea') ?? null
}

/**
 * 格式按钮（P6 T80/D71）：把选区包裹成 markdown 语法（粗体 `**` / 斜体 `*` / 链接 `[](url)`），
 * 无选区时插入占位文本；包裹后保持选中新插入的文本，便于继续输入替换。
 */
function wrapMarkdown(before: string, after: string, placeholder: string) {
  const textarea = textareaEl()
  if (!textarea) return
  const start = textarea.selectionStart ?? form.contentMd.length
  const end = textarea.selectionEnd ?? start
  const selected = form.contentMd.slice(start, end) || placeholder
  form.contentMd = `${form.contentMd.slice(0, start)}${before}${selected}${after}${form.contentMd.slice(end)}`
  requestAnimationFrame(() => {
    textarea.focus()
    textarea.setSelectionRange(start + before.length, start + before.length + selected.length)
  })
}

/** 空态文案（P7 D73：内容池化后列表不再依赖站点，无站点也可撰写内容） */
const emptyText = computed(() => '还没有文章')

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
  /** 发表站点（P7 D73：替换式） */
  siteIds: [] as number[],
  /** 置顶站点子集 */
  topSiteIds: [] as number[],
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
  loading.value = true
  try {
    const res = await listArticles({
      pageNo: pageNo.value,
      pageSize: pageSize.value,
      // P7 D73：不传 siteId = 全部内容池文章；传 = 只出已发表到该站的
      siteId: filterSiteId.value,
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

/** 栏目/标签元数据（P7 D73：用户级，与站点无关） */
async function loadMeta() {
  const [cols, tgs] = await Promise.all([listColumns(), listTags()])
  columns.value = cols
  tags.value = tgs
  if (!uploadSiteId.value && siteStore.currentSiteId) {
    uploadSiteId.value = Number(siteStore.currentSiteId)
  }
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

// ========== P8：文件导入（T88）与一键排版（T89） ==========

/** 导入可选类型（与后端白名单一致） */
const IMPORT_EXTS = ['md', 'markdown', 'txt'] as const

const pickerVisible = ref(false)
const sourceInput = ref<HTMLInputElement>()
/** 导入解析中（云盘选择与本地导入共用同一 loading） */
const importing = ref(false)
const formatting = ref(false)
const diffVisible = ref(false)
const diffBefore = ref('')
const diffAfter = ref('')

/** 导入入口：从云盘选 / 上传本地文件 */
function onImportCommand(command: string | number | object): void {
  if (command === 'cloud') {
    pickerVisible.value = true
    return
  }
  if (command === 'local') sourceInput.value?.click()
}

/**
 * 本地文件导入：**先上传到云盘根留档**，再走同一套解析。
 * 这样"导入"不会丢掉源文件（可随时重新导入或直接用云盘编辑器改）。
 */
async function onSourcePick(event: Event): Promise<void> {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  target.value = ''
  if (!file) return
  const ext = (file.name.split('.').pop() ?? '').toLowerCase()
  if (!IMPORT_EXTS.includes(ext as (typeof IMPORT_EXTS)[number])) {
    ElMessage.warning('仅支持 .md / .markdown / .txt 文件')
    return
  }
  importing.value = true
  try {
    const created = await uploadFile(0, file)
    await importByFileId(Number(created.id))
  } catch {
    // 上传或解析失败：拦截器/业务码已给提示
  } finally {
    importing.value = false
  }
}

/** 云盘文件选择结果 → 导入解析 */
async function onPickCloudFile(file: { id: string }): Promise<void> {
  importing.value = true
  try {
    await importByFileId(Number(file.id))
  } catch {
    // 拦截器提示
  } finally {
    importing.value = false
  }
}

async function importByFileId(fileId: number): Promise<void> {
  const result = await importArticleFile(fileId)
  await applyImportResult(result)
}

/**
 * 把解析结果填进表单：**覆盖前逐项确认**（导入是破坏性动作，可能冲掉正在写的草稿），
 * 标签只勾选平台已有的（未匹配的提示，不自动创建）。
 */
async function applyImportResult(result: ArticleImportResult): Promise<void> {
  if (result.title && result.title !== form.title) {
    const overwrite =
      form.title.trim() === '' ||
      (await confirmDialog(`将标题覆盖为「${result.title}」？`, '导入确认', { type: 'warning' }))
    if (overwrite) form.title = result.title
  }

  if (result.contentMd) {
    const overwrite =
      form.contentMd.trim() === '' ||
      (await confirmDialog('将用导入内容覆盖当前正文，确认继续？', '导入确认', { type: 'warning' }))
    if (overwrite) form.contentMd = result.contentMd
  }

  // 摘要仅在没有时补，避免覆盖用户手写的摘要
  if (result.summary && form.summary.trim() === '') form.summary = result.summary

  if (result.matchedTags.length) {
    const ids = new Set(form.tagIds)
    for (const tag of result.matchedTags) ids.add(Number(tag.id))
    form.tagIds = [...ids]
  }
  if (result.unmatchedTags.length) {
    ElMessage.warning(`未匹配到标签：${result.unmatchedTags.join('、')}（不会自动创建）`)
  }
  for (const warning of result.warnings.slice(0, 3)) {
    ElMessage.warning(warning)
  }
  ElMessage.success(`已解析「${result.filename}」，共 ${result.wordCount} 字，请确认后保存`)
}

/** 一键排版：调接口 → diff 预览 → 用户确认后才改写正文（textarea 原生撤销可回退） */
async function runFormat(): Promise<void> {
  if (form.contentMd.trim() === '') {
    ElMessage.warning('正文为空，无需排版')
    return
  }
  formatting.value = true
  try {
    const result = await formatArticle(form.contentMd, {
      structure: true,
      punctuation: true,
      cjkSpacing: true,
    })
    if (!result.changed) {
      ElMessage.success('正文已经足够规整，无需改动')
      return
    }
    diffBefore.value = form.contentMd
    diffAfter.value = result.contentMd
    diffVisible.value = true
  } catch {
    // 拦截器提示
  } finally {
    formatting.value = false
  }
}

/** 应用排版结果（用户已在只读 diff 里确认过） */
function applyFormat(): void {
  form.contentMd = diffAfter.value
  diffVisible.value = false
  ElMessage.success('已应用排版（Ctrl+Z 可撤销）')
}

function openCreate() {
  editingId.value = 0
  form.columnId = flatColumns.value[0] ? Number(flatColumns.value[0].id) : undefined
  form.title = ''
  form.summary = ''
  form.tagIds = []
  // P7：新建默认发表到当前站（无站则仅入内容池）
  form.siteIds = siteStore.currentSiteId ? [Number(siteStore.currentSiteId)] : []
  form.topSiteIds = []
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
    form.siteIds = detail.sites.map((s) => Number(s.id))
    form.topSiteIds = detail.sites.filter((s) => s.isTop).map((s) => Number(s.id))
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
  // 置顶是发表关联属性（每站独立），正文/字段走 update，置顶走 :id/sites
  const sitePayload = {
    sites: form.siteIds.map((id) => ({ siteId: id, isTop: form.topSiteIds.includes(id) })),
  }
  try {
    if (editingId.value) {
      await updateArticle(editingId.value, { ...payload, siteIds: form.siteIds })
      if (form.siteIds.length) await setArticleSites(editingId.value, sitePayload)
      ElMessage.success(form.status === 1 ? '已保存并发布' : '已保存草稿')
    } else {
      const created = await createArticle({ ...payload, siteIds: form.siteIds })
      if (form.siteIds.length) await setArticleSites(Number(created.id), sitePayload)
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
    const confirmed = await confirmDialog(`确认发布「${row.title}」？`, '提示', { type: 'info' })
    if (!confirmed) return
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
  const confirmed = await confirmDialog(
    `确认删除「${row.title}」？正文、标签关联与全部评论将被物理删除，不可恢复`,
    '警告',
    {
      type: 'warning',
    },
  )
  if (!confirmed) return
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
  // P7：站点只用于上传落点与站点筛选，不再决定列表内容
  await siteStore.ensureLoaded().catch(() => undefined)
  reload()
  await loadMeta().catch(() => undefined)
})

// 站点筛选变化 → 回到第一页重拉（栏目/标签/关键词沿用既有交互：回车或清空时刷新）
watch(filterSiteId, () => {
  pageNo.value = 1
  reload()
})
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
.v-sa-site-tag + .v-sa-site-tag {
  margin-left: 4px;
}
.v-sa-tops {
  margin-top: 6px;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.v-sa-cover-img {
  width: 64px;
  height: 40px;
  object-fit: cover;
  border-radius: 4px;
  border: 1px solid var(--el-border-color-lighter);
}
</style>
