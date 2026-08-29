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

    <!-- 上传进度 -->
    <el-progress
      v-if="uploading"
      :percentage="uploadPercent"
      :stroke-width="10"
      style="margin: 8px 0"
    />

    <!-- 文件列表 -->
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
            v-if="row.isPublic"
            type="warning"
            size="small"
            style="margin-left: 6px"
          >
            公开
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
        width="390"
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
          <el-button
            v-permission="'cloud:file:public'"
            link
            :type="row.isPublic ? 'warning' : 'primary'"
            @click="onTogglePublic(row)"
          >
            {{ row.isPublic ? '取消公开' : '设为公开' }}
          </el-button>
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
          description="空空如也，上传点什么吧"
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
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Upload, FolderAdd, Refresh, FolderOpened, Document } from '@element-plus/icons-vue'
import ProTable from '@/components/ProTable/index.vue'
import { formatSize, formatTime } from '@/utils/format'
import {
  listFiles,
  filePath,
  mkdir as apiMkdir,
  renameFile,
  removeFile,
  uploadFile,
  setFilePublic,
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
const uploading = ref(false)
const uploadPercent = ref(0)
const submitting = ref(false)
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

// 上传
function triggerUpload() {
  fileInput.value?.click()
}
async function onPick(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files || [])
  input.value = ''
  if (!files.length) return
  uploading.value = true
  uploadPercent.value = 0
  try {
    for (const f of files) {
      await uploadFile(currentDir.value, f, (p) => (uploadPercent.value = p), overwriteUpload.value)
    }
    ElMessage.success(overwriteUpload.value ? '上传完成（同名文件已覆盖）' : '上传完成')
    reload()
  } catch {
    // 错误已由拦截器提示
  } finally {
    uploading.value = false
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

// 设为公开 / 取消公开（P4a：仅标记自身；站点公开目录机制用）
async function onTogglePublic(row: CloudFile) {
  const makingPublic = !row.isPublic
  if (makingPublic) {
    await ElMessageBox.confirm(
      `确认将「${row.name}」设为公开？站点开放层将可访问该${row.isDir ? '目录及其中内容（子目录/文件默认继承）' : '文件'}`,
      '提示',
      { type: 'info' },
    )
  }
  try {
    await setFilePublic(Number(row.id), makingPublic)
    ElMessage.success(makingPublic ? '已设为公开' : '已取消公开')
    reload()
  } catch {
    // 拦截器提示
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

function copyShare() {
  navigator.clipboard?.writeText(shareUrl.value)
  ElMessage.success('已复制')
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
