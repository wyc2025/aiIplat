<template>
  <div class="v-cloud-file">
    <!-- 顶部：配额 + 工具栏 -->
    <div class="v-cf-bar">
      <div class="v-cf-quota">
        已用 <b>{{ formatSize(used) }}</b> / {{ formatSize(quota) }}
        <el-progress
          :percentage="quotaPercent"
          :show-text="false"
          :stroke-width="8"
          style="width: 160px"
        />
      </div>
      <div class="v-cf-actions">
        <el-checkbox
          v-model="overwriteUpload"
          style="margin-right: 8px"
        >
          覆盖同名
        </el-checkbox>
        <el-button
          v-permission="'cloud:file:upload'"
          type="primary"
          :icon="Upload"
          @click="triggerUpload"
        >
          上传
        </el-button>
        <el-button
          v-permission="'cloud:file:mkdir'"
          :icon="FolderAdd"
          @click="openMkdir"
        >
          新建文件夹
        </el-button>
        <el-button
          :icon="Refresh"
          @click="reload"
        >
          刷新
        </el-button>
        <input
          ref="fileInput"
          type="file"
          hidden
          multiple
          @change="onPick"
        >
      </div>
    </div>

    <!-- 面包屑 -->
    <div class="v-cf-crumbs">
      <el-breadcrumb separator="/">
        <el-breadcrumb-item>
          <a @click="goDir(0)">根目录</a>
        </el-breadcrumb-item>
        <el-breadcrumb-item
          v-for="c in crumbs"
          :key="c.id"
        >
          <a @click="goDir(Number(c.id))">{{ c.name }}</a>
        </el-breadcrumb-item>
      </el-breadcrumb>
    </div>

    <!-- 文件列表（T48 drop zone：拖入文件批量入队上传；文件夹拖拽整批拒绝并提示 D35） -->
    <div
      class="v-cf-drop"
      :class="{ 'is-dragover': dragActive }"
      @dragenter="onDragEnter"
      @dragover.prevent="onDragOver"
      @dragleave="onDragLeave"
      @drop.prevent="onDrop"
    >
      <ProTable
        :data="list"
        :loading="loading"
        :load-error="loadError"
        :total="total"
        :page-no="pageNo"
        :page-size="pageSize"
        :pagination="false"
        @retry="reload"
      >
        <el-table-column
          label="名称"
          min-width="240"
        >
          <template #default="{ row }">
            <span
              class="v-cf-name"
              @dblclick="onDblClick(row)"
            >
              <el-icon v-if="row.isDir"><FolderOpened /></el-icon>
              <el-icon v-else><Document /></el-icon>
              {{ row.name }}
            </span>
            <el-tag
              v-if="row.shared"
              type="success"
              size="small"
              style="margin-left: 6px"
            >
              已分享
            </el-tag>
            <el-tag
              v-if="row.isPublic === 1"
              type="warning"
              size="small"
              style="margin-left: 6px"
            >
              公开
            </el-tag>
            <el-tag
              v-else-if="row.isPublic === 2"
              type="danger"
              size="small"
              style="margin-left: 6px"
            >
              已阻断
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column
          label="大小"
          width="120"
          :formatter="(r: CloudFile) => r.isDir ? '-' : formatSize(Number(r.size))"
        />
        <el-table-column
          label="修改时间"
          width="180"
          prop="updateTime"
          :formatter="(r: CloudFile) => r.updateTime ? formatTime(r.updateTime) : '-'"
        />
        <el-table-column
          label="操作"
          width="440"
          fixed="right"
        >
          <template #default="{ row }">
            <el-button
              v-if="!row.isDir"
              v-permission="'cloud:file:list'"
              link
              type="primary"
              @click="openPreview(row)"
            >
              预览
            </el-button>
            <el-button
              v-if="!row.isDir"
              v-permission="'cloud:file:list'"
              link
              type="primary"
              @click="download(row)"
            >
              下载
            </el-button>
            <el-button
              v-if="canEdit(row)"
              v-permission="'cloud:file:upload'"
              link
              type="primary"
              @click="openEditor(row)"
            >
              编辑
            </el-button>
            <!-- P4c T49：zip 文件在线解压（解压本质是写入，复用 cloud:file:upload） -->
            <el-button
              v-if="!row.isDir && row.ext === 'zip'"
              v-permission="'cloud:file:upload'"
              link
              type="primary"
              :loading="unzippingId === row.id"
              @click="onUnzip(row)"
            >
              解压
            </el-button>
            <el-button
              v-permission="'cloud:file:rename'"
              link
              type="primary"
              @click="openRename(row)"
            >
              重命名
            </el-button>
            <el-button
              v-if="!row.isDir"
              v-permission="'cloud:share:create'"
              link
              type="primary"
              @click="openShare(row)"
            >
              分享管理
            </el-button>
            <!-- P4c F1：设为公开（生成公开链接）/ 复制公开链接 / 取消公开（token 轮换） -->
            <el-button
              v-if="row.isPublic !== 1 || !row.publicToken"
              v-permission="'cloud:file:public'"
              link
              type="primary"
              @click="onSetPublic(row)"
            >
              设为公开
            </el-button>
            <template v-else>
              <el-button
                v-permission="'cloud:file:public'"
                link
                type="primary"
                @click="onCopyPublicLink(row)"
              >
                复制公开链接
              </el-button>
              <el-button
                v-permission="'cloud:file:public'"
                link
                type="warning"
                @click="onCancelPublic(row)"
              >
                取消公开
              </el-button>
            </template>
            <el-button
              v-permission="'cloud:file:delete'"
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
            description="将文件拖拽到此处，或点击上传"
          />
          <el-result
            v-else
            icon="error"
            title="加载失败"
            sub-title="请稍后重试"
          >
            <template #extra>
              <el-button
                type="primary"
                @click="reload"
              >
                重试
              </el-button>
            </template>
          </el-result>
        </template>
      </ProTable>
    </div>

    <!-- 上传队列面板（T48：逐文件进度 + 总进度 + 结果汇总） -->
    <UploadQueue
      :visible="queueVisible"
      :items="queueItems"
      :has-active="queueActive"
      :success-count="queueSuccess"
      :fail-count="queueFail"
      :total-percent="queuePercent"
      @clear="queueClearFinished"
      @close="queueVisible = false"
    />

    <!-- 新建文件夹 -->
    <el-dialog
      v-model="mkdirVisible"
      title="新建文件夹"
      width="420px"
    >
      <el-input
        v-model="mkdirName"
        placeholder="请输入文件夹名称"
        maxlength="64"
        @keyup.enter="submitMkdir"
      />
      <template #footer>
        <el-button @click="mkdirVisible = false">
          取消
        </el-button>
        <el-button
          type="primary"
          :loading="submitting"
          @click="submitMkdir"
        >
          确定
        </el-button>
      </template>
    </el-dialog>

    <!-- 重命名 -->
    <el-dialog
      v-model="renameVisible"
      title="重命名"
      width="420px"
    >
      <el-input
        v-model="renameName"
        maxlength="64"
        @keyup.enter="submitRename"
      />
      <template #footer>
        <el-button @click="renameVisible = false">
          取消
        </el-button>
        <el-button
          type="primary"
          :loading="submitting"
          @click="submitRename"
        >
          确定
        </el-button>
      </template>
    </el-dialog>

    <!-- 分享管理 -->
    <el-dialog
      v-model="shareVisible"
      title="分享管理"
      width="480px"
    >
      <div v-loading="shareLoading">
        <template v-if="shareMode === 'create'">
          <p class="v-cf-tip">
            确认后将生成公开链接，访客凭链接免登录下载该文件。
          </p>
          <div class="v-cf-share-row">
            <span class="v-cf-share-label">有效期：</span>
            <el-radio-group v-model="shareDays">
              <el-radio :value="1">
                1 天
              </el-radio>
              <el-radio :value="7">
                7 天
              </el-radio>
              <el-radio :value="30">
                30 天
              </el-radio>
              <el-radio :value="0">
                永久
              </el-radio>
            </el-radio-group>
          </div>
        </template>
        <template v-else>
          <el-input
            :model-value="shareUrl"
            readonly
          >
            <template #append>
              <el-button @click="copyShare">
                复制
              </el-button>
            </template>
          </el-input>
          <p class="v-cf-tip">
            有效期至：{{ shareExpireText }}，访客凭链接免登录下载。
          </p>
        </template>
      </div>
      <template #footer>
        <template v-if="shareMode === 'create'">
          <el-button @click="shareVisible = false">
            取消
          </el-button>
          <el-button
            type="primary"
            :loading="shareSubmitting"
            @click="submitShare"
          >
            确定分享
          </el-button>
        </template>
        <template v-else>
          <el-button
            type="danger"
            @click="onStopShare"
          >
            停止分享
          </el-button>
          <el-button
            type="primary"
            @click="onExtendShare"
          >
            延长有效期
          </el-button>
          <el-button @click="shareVisible = false">
            关闭
          </el-button>
        </template>
      </template>
    </el-dialog>

    <!-- 延长有效期 -->
    <el-dialog
      v-model="extendVisible"
      title="延长有效期"
      width="380px"
      append-to-body
    >
      <el-radio-group v-model="extendDays">
        <el-radio :value="1">
          1 天
        </el-radio>
        <el-radio :value="7">
          7 天
        </el-radio>
        <el-radio :value="30">
          30 天
        </el-radio>
        <el-radio :value="0">
          永久
        </el-radio>
      </el-radio-group>
      <template #footer>
        <el-button @click="extendVisible = false">
          取消
        </el-button>
        <el-button
          type="primary"
          :loading="extendSubmitting"
          @click="submitExtendShare"
        >
          确定
        </el-button>
      </template>
    </el-dialog>

    <!-- 预览弹层 -->
    <el-dialog
      v-model="previewVisible"
      :title="previewRow?.name"
      width="80%"
      top="5vh"
      @closed="closePreview"
    >
      <div
        v-loading="previewLoading"
        class="v-cf-preview"
      >
        <img
          v-if="isImage(previewRow)"
          :src="previewUrl"
          alt="预览"
        >
        <video
          v-else-if="isVideo(previewRow)"
          :src="previewUrl"
          controls
          style="max-width: 100%"
        />
        <iframe
          v-else-if="isText(previewRow)"
          :src="previewUrl"
          frameborder="0"
          style="width: 100%; height: 70vh"
        />
        <div v-else>
          该类型不支持在线预览，
          <el-button
            link
            type="primary"
            @click="download(previewRow!)"
          >
            点击下载
          </el-button>
        </div>
      </div>
    </el-dialog>

    <!-- 在线编辑（P4b T43：CodeMirror 6 全屏弹窗） -->
    <FileEditorDialog
      v-model:visible="editorVisible"
      :file="editorFile"
      @saved="reload"
    />

    <!-- 文件夹设为公开（P4c D32：allowListing 开关，默认开） -->
    <el-dialog
      v-model="pubDirVisible"
      title="设为公开"
      width="480px"
      append-to-body
    >
      <p class="v-cf-tip">
        公开「{{ pubDirRow?.name }}」后，访客可凭公开链接在线访问该文件夹及其中内容（子项公开性随公开链上溯判定）。
      </p>
      <el-checkbox v-model="pubDirAllowListing">
        允许访客浏览文件列表（关闭后仅知道完整路径可访问）
      </el-checkbox>
      <template #footer>
        <el-button @click="pubDirVisible = false">
          取消
        </el-button>
        <el-button
          type="primary"
          :loading="pubSubmitting"
          @click="submitSetPublic()"
        >
          确认公开
        </el-button>
      </template>
    </el-dialog>

    <!-- 公开链接结果（设为公开成功后展示 + 复制） -->
    <el-dialog
      v-model="pubLinkVisible"
      title="公开链接"
      width="560px"
      append-to-body
    >
      <el-input
        :model-value="pubLinkUrl"
        readonly
      >
        <template #append>
          <el-button @click="copyPublicLink">
            复制
          </el-button>
        </template>
      </el-input>
      <p class="v-cf-tip">
        访客免登录打开可在线查看 / 播放；取消公开后旧链接立即失效，重新公开会生成新链接。
      </p>
      <template #footer>
        <el-button
          type="primary"
          @click="pubLinkVisible = false"
        >
          完成
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useClipboard } from '@vueuse/core'
import { Upload, FolderAdd, Refresh, FolderOpened, Document } from '@element-plus/icons-vue'
import ProTable from '@/components/ProTable/index.vue'
import FileEditorDialog from '../components/FileEditorDialog.vue'
import UploadQueue from './UploadQueue.vue'
import { useUploadQueue } from './useUploadQueue'
import { formatSize, formatTime } from '@/utils/format'
import {
  listFiles,
  filePath,
  mkdir as apiMkdir,
  renameFile,
  removeFile,
  createPublicLink,
  cancelPublicLink,
  unzipFile,
  previewFileBlob,
  downloadFileBlob,
} from '@/api/cloud/file'
import { createShare, stopShare, extendShare } from '@/api/cloud/share'
import type { CloudFile, BreadcrumbItem } from '@/types/api'

const route = useRoute()
const router = useRouter()

const loading = ref(false)
const loadError = ref(false)
const list = ref<CloudFile[]>([])
const total = ref(0)
const pageNo = ref(1)
const pageSize = ref(999)

const quota = ref(0)
const used = ref(0)
const quotaPercent = computed(() =>
  quota.value > 0 ? Math.min(100, Math.round((used.value / quota.value) * 100)) : 0,
)

const crumbs = ref<BreadcrumbItem[]>([])
const currentDir = ref(0)

const fileInput = ref<HTMLInputElement>()
const submitting = ref(false)

// ==================== 上传队列（P4c T48：并发 3、单失败不阻塞、汇总面板） ====================
const {
  items: queueItems,
  visible: queueVisible,
  hasActive: queueActive,
  successCount: queueSuccess,
  failCount: queueFail,
  totalPercent: queuePercent,
  enqueue: queueEnqueue,
  clearFinished: queueClearFinished,
} = useUploadQueue({
  overwrite: () => overwriteUpload.value,
  onAllSettled: () => reload(),
})

// drop zone（仅列表区域，非全页面；拖入高亮边框反馈）
const dragActive = ref(false)
let dragDepth = 0

function hasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files')
}
function onDragEnter(e: DragEvent): void {
  if (!hasFiles(e)) return
  dragDepth++
  dragActive.value = true
}
function onDragOver(): void {
  // dragover 仅为持续触发 preventDefault（模板已 .prevent），无需额外逻辑
}
function onDragLeave(): void {
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) dragActive.value = false
}
/** drop：文件夹检测（D35，webkitGetAsEntry 须在同步栈内调用）→ 含文件夹整批拒绝；纯文件批量入队 */
function onDrop(e: DragEvent): void {
  dragDepth = 0
  dragActive.value = false
  const dt = e.dataTransfer
  if (!dt) return
  const entries = Array.from(dt.items ?? []).map((i) => {
    const getter = (i as unknown as { webkitGetAsEntry?: () => { isDirectory?: boolean } | null })
      .webkitGetAsEntry
    return typeof getter === 'function' ? getter.call(i) : null
  })
  if (entries.some((en) => en?.isDirectory)) {
    ElMessage.warning('暂不支持文件夹拖拽，请压缩后上传或使用在线解压')
    return
  }
  const files = Array.from(dt.files ?? [])
  if (files.length > 0) queueEnqueue(files, currentDir.value)
}
/** 覆盖同名上传（R5：物理替换，URL 不变）；缺省同名自动 (1) */
const overwriteUpload = ref(false)

const mkdirVisible = ref(false)
const mkdirName = ref('')
const renameVisible = ref(false)
const renameName = ref('')
const renameTarget = ref<CloudFile | null>(null)

const shareVisible = ref(false)
const shareUrl = ref('')
const shareExpireText = ref('')
/** 弹框模式：create=选择有效期确认分享（未分享/已停止/已过期），detail=展示链接管理（已分享） */
const shareMode = ref<'create' | 'detail'>('create')
const shareFile = ref<CloudFile | null>(null)
const shareId = ref('')
const shareDays = ref(7)
const shareLoading = ref(false)
const shareSubmitting = ref(false)
const extendVisible = ref(false)
const extendDays = ref(7)
const extendSubmitting = ref(false)

const previewVisible = ref(false)
const previewRow = ref<CloudFile | null>(null)
const previewUrl = ref('')
const previewLoading = ref(false)
let previewObjectUrl = ''

// ========== 在线编辑（P4b T43） ==========
/** 在线编辑文本扩展名白名单（§15.12：与后端 EDITABLE_TEXT_EXTS / site 域 SITE_FILE_TEXT_EXTS 同集，以架构增补为准对齐） */
const EDITABLE_EXTS: ReadonlySet<string> = new Set([
  'html', 'htm', 'css', 'js', 'mjs', 'txt', 'md', 'json', 'svg', 'xml', 'yml', 'yaml', 'csv',
])
/** 在线编辑内容上限（§15.12：1MB，按钮显示条件） */
const EDIT_MAX_BYTES = 1024 * 1024
const editorVisible = ref(false)
const editorFile = ref<{ id: string; name: string; ext: string | null; size: string } | null>(null)

/** 是否可在线编辑：非目录 + 文本白名单扩展名 + ≤1MB（§15.12 按钮显示条件） */
function canEdit(row: CloudFile) {
  if (row.isDir) return false
  const ext = (row.ext ?? '').toLowerCase()
  return EDITABLE_EXTS.has(ext) && Number(row.size) <= EDIT_MAX_BYTES
}

function openEditor(row: CloudFile) {
  editorFile.value = { id: row.id, name: row.name, ext: row.ext, size: row.size }
  editorVisible.value = true
}

async function loadDir(dir: number) {
  loading.value = true
  loadError.value = false
  try {
    const filesRes = await listFiles(dir)
    list.value = filesRes.list ?? []
    total.value = list.value.length
    quota.value = Number(filesRes.quota)
    used.value = Number(filesRes.used)
    crumbs.value = dir === 0 ? [] : await filePath(dir)
  } catch {
    list.value = []
    loadError.value = true
  } finally {
    loading.value = false
  }
}

function reload() {
  loadDir(currentDir.value)
}

function goDir(id: number) {
  currentDir.value = id
  router.replace({ query: id === 0 ? {} : { dir: String(id) } })
  loadDir(id)
}

function onDblClick(row: CloudFile) {
  if (row.isDir) goDir(Number(row.id))
}

// URL 同步：进入页面时读 ?dir
onMounted(() => {
  const dir = Number(route.query.dir || 0)
  currentDir.value = dir
  loadDir(dir)
})

// 预览类型判断
function isImage(r?: CloudFile | null) {
  return r?.mime?.startsWith('image/') && r.mime !== 'image/svg+xml'
}
function isVideo(r?: CloudFile | null) {
  return r?.mime?.startsWith('video/')
}
function isText(r?: CloudFile | null) {
  return r?.mime?.startsWith('text/') || r?.mime === 'application/pdf'
}
async function openPreview(row: CloudFile) {
  previewRow.value = row
  previewVisible.value = true
  // 不支持在线预览的类型不拉流，直接走下载引导
  if (!isImage(row) && !isVideo(row) && !isText(row)) return
  previewLoading.value = true
  try {
    const blob = await previewFileBlob(Number(row.id))
    previewObjectUrl = URL.createObjectURL(blob)
    previewUrl.value = previewObjectUrl
  } catch {
    // 错误已由拦截器提示
  } finally {
    previewLoading.value = false
  }
}

/** 弹框关闭后释放 Blob URL，避免内存泄漏 */
function closePreview() {
  if (previewObjectUrl) {
    URL.revokeObjectURL(previewObjectUrl)
    previewObjectUrl = ''
  }
  previewUrl.value = ''
}

async function download(row: CloudFile) {
  try {
    const blob = await downloadFileBlob(Number(row.id))
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = row.name
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  } catch {
    // 错误已由拦截器提示
  }
}

// 上传（T48：多选/拖入统一入队；并发 3 由队列调度，结果见上传队列面板）
function triggerUpload() {
  fileInput.value?.click()
}
function onPick(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files || [])
  input.value = ''
  if (!files.length) return
  queueEnqueue(files, currentDir.value)
}

// 在线解压（P4c T49：zip → 同目录包名文件夹；同步执行，timeout 0）
const unzippingId = ref('')
async function onUnzip(row: CloudFile) {
  try {
    await ElMessageBox.confirm(
      `确认解压「${row.name}」？将在当前目录创建同名文件夹，解压内容进入该文件夹（同名自动 "(1)"）`,
      '在线解压',
      { type: 'info' },
    )
  } catch {
    return
  }
  unzippingId.value = row.id
  try {
    const res = await unzipFile(Number(row.id))
    ElMessage.success(
      `解压完成：${res.fileCount} 个文件（${formatSize(res.totalSize)}），已解压到「${res.folderName}」`,
    )
    reload()
  } catch {
    // 错误已由拦截器提示
  } finally {
    unzippingId.value = ''
  }
}

// 新建文件夹
function openMkdir() {
  mkdirName.value = ''
  mkdirVisible.value = true
}
async function submitMkdir() {
  if (!mkdirName.value.trim()) return
  submitting.value = true
  try {
    await apiMkdir(currentDir.value, mkdirName.value.trim())
    ElMessage.success('已创建')
    mkdirVisible.value = false
    reload()
  } catch {
    // 拦截器提示
  } finally {
    submitting.value = false
  }
}

// 重命名
function openRename(row: CloudFile) {
  renameTarget.value = row
  renameName.value = row.name
  renameVisible.value = true
}
async function submitRename() {
  if (!renameTarget.value || !renameName.value.trim()) return
  submitting.value = true
  try {
    await renameFile(Number(renameTarget.value.id), renameName.value.trim())
    ElMessage.success('已重命名')
    renameVisible.value = false
    reload()
  } catch {
    // 拦截器提示
  } finally {
    submitting.value = false
  }
}

// 删除（软删入回收站）
async function onRemove(row: CloudFile) {
  await ElMessageBox.confirm(`确认删除「${row.name}」？将移入回收站`, '提示', { type: 'warning' })
  await removeFile(Number(row.id))
  ElMessage.success('已删除')
  reload()
}

// ==================== 公开链接（P4c F1/D32/R27） ====================

const pubDirVisible = ref(false)
const pubDirRow = ref<CloudFile | null>(null)
const pubDirAllowListing = ref(true)
const pubSubmitting = ref(false)
const pubLinkVisible = ref(false)
const pubLinkUrl = ref('')

/** 复用 useClipboard（legacy=true：非安全上下文降级 execCommand） */
const { copy: copyPubText } = useClipboard({ legacy: true })

/** 设为公开：文件直接生成；文件夹先弹 allowListing 开关弹窗（默认开） */
function onSetPublic(row: CloudFile) {
  if (row.isDir) {
    pubDirRow.value = row
    pubDirAllowListing.value = row.allowListing !== 0
    pubDirVisible.value = true
    return
  }
  void submitSetPublic(row)
}

/** 生成/获取公开链接（幂等：已公开且有 token 返回既有 token），成功展示链接弹窗 */
async function submitSetPublic(row?: CloudFile) {
  const target = row ?? pubDirRow.value
  if (!target) return
  pubSubmitting.value = true
  try {
    const res = await createPublicLink(Number(target.id), target.isDir ? pubDirAllowListing.value : undefined)
    pubLinkUrl.value = `${window.location.origin}${res.viewUrl}`
    pubDirVisible.value = false
    pubLinkVisible.value = true
    reload()
  } catch {
    // 拦截器提示
  } finally {
    pubSubmitting.value = false
  }
}

/** 复制公开链接（行内按钮直取 publicToken 组装） */
async function onCopyPublicLink(row: CloudFile) {
  if (!row.publicToken) return
  const url = `${window.location.origin}${row.isDir ? '/view/d/' : '/view/f/'}${row.publicToken}`
  try {
    await copyPubText(url)
    ElMessage.success('已复制')
  } catch {
    ElMessage.error('复制失败，请手动复制链接')
  }
}

/** 取消公开（R27：token 轮换，旧链接立即失效；重新公开生成新链接） */
async function onCancelPublic(row: CloudFile) {
  try {
    await ElMessageBox.confirm(
      `确认取消公开「${row.name}」？旧公开链接将立即失效，重新公开会生成新链接`,
      '提示',
      { type: 'warning' },
    )
  } catch {
    return
  }
  try {
    await cancelPublicLink(Number(row.id))
    ElMessage.success('已取消公开')
    reload()
  } catch {
    // 拦截器提示
  }
}

/** 公开链接弹窗内的复制 */
async function copyPublicLink() {
  try {
    await copyPubText(pubLinkUrl.value)
    ElMessage.success('已复制')
  } catch {
    ElMessage.error('复制失败，请手动复制链接')
  }
}

// 分享管理
function openShare(row: CloudFile) {
  shareFile.value = row
  shareDays.value = 7
  if (row.shared) {
    // 已分享：幂等取现存有效链接展示（后端 findActiveShare 保证不重复建行）
    shareMode.value = 'detail'
    shareVisible.value = true
    shareLoading.value = true
    createShare(Number(row.id))
      .then((res) => {
        shareId.value = res.id
        shareUrl.value = `${window.location.origin}${res.url}`
        shareExpireText.value = res.expireAt ? new Date(res.expireAt).toLocaleString() : '永久'
      })
      .catch(() => {
        shareVisible.value = false
      })
      .finally(() => {
        shareLoading.value = false
      })
  } else {
    // 未分享（或已停止/已过期）：先选有效期，确定后才真正创建分享
    shareMode.value = 'create'
    shareId.value = ''
    shareUrl.value = ''
    shareExpireText.value = ''
    shareVisible.value = true
  }
}

/** 确认分享：此时才调创建接口 */
async function submitShare() {
  if (!shareFile.value) return
  shareSubmitting.value = true
  try {
    const res = await createShare(Number(shareFile.value.id), shareDays.value)
    shareId.value = res.id
    shareUrl.value = `${window.location.origin}${res.url}`
    shareExpireText.value = res.expireAt ? new Date(res.expireAt).toLocaleString() : '永久'
    shareMode.value = 'detail'
    ElMessage.success('分享成功')
    reload()
  } catch {
    // 拦截器提示
  } finally {
    shareSubmitting.value = false
  }
}

// legacy=true：非安全上下文（HTTP 部署，navigator.clipboard 为 undefined）自动降级
// document.execCommand('copy')；await 等待结果，失败如实提示，不再无条件报"已复制"
const { copy: copyToClipboard } = useClipboard({ legacy: true })
async function copyShare() {
  try {
    await copyToClipboard(shareUrl.value)
    ElMessage.success('已复制')
  } catch {
    ElMessage.error('复制失败，请手动复制链接')
  }
}

async function onStopShare() {
  try {
    await ElMessageBox.confirm('停止后访客将无法访问该链接，确认停止？', '提示', {
      type: 'warning',
    })
  } catch {
    return
  }
  try {
    await stopShare(Number(shareId.value))
    ElMessage.success('已停止分享')
    shareMode.value = 'create'
    shareId.value = ''
    shareUrl.value = ''
    shareExpireText.value = ''
    reload()
  } catch {
    // 拦截器提示
  }
}

function onExtendShare() {
  extendDays.value = 7
  extendVisible.value = true
}

async function submitExtendShare() {
  if (!shareId.value) return
  extendSubmitting.value = true
  try {
    const res = await extendShare(Number(shareId.value), extendDays.value)
    shareExpireText.value = res.expireAt ? new Date(res.expireAt).toLocaleString() : '永久'
    ElMessage.success('已延长')
    extendVisible.value = false
    reload()
  } catch {
    // 拦截器提示
  } finally {
    extendSubmitting.value = false
  }
}

// 路由 query 变化（浏览器前进后退）同步
watch(
  () => route.query.dir,
  (v) => {
    const dir = Number(v || 0)
    if (dir !== currentDir.value) {
      currentDir.value = dir
      loadDir(dir)
    }
  },
)
</script>

<style scoped>
.v-cf-share-row {
  display: flex;
  align-items: center;
}
.v-cf-share-label {
  flex-shrink: 0;
  color: var(--el-text-color-regular);
}

.v-cloud-file {
  padding: 16px;
  background: #fff;
  border-radius: 6px;
  min-height: 100%;
}
.v-cf-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.v-cf-quota {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #606266;
  font-size: 13px;
}
.v-cf-crumbs {
  margin-bottom: 12px;
}
/* T48 drop zone：拖入高亮反馈（仅列表区域） */
.v-cf-drop.is-dragover {
  outline: 2px dashed var(--el-color-primary);
  outline-offset: -2px;
  border-radius: 4px;
  background: var(--el-color-primary-light-9);
}
.v-cf-name {
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.v-cf-name:hover {
  color: #409eff;
}
.v-cf-tip {
  color: #909399;
  font-size: 12px;
  margin-top: 8px;
}
.v-cf-preview {
  text-align: center;
}
.v-cf-preview img {
  max-width: 100%;
  max-height: 70vh;
}
</style>
