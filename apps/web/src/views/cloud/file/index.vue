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
        <!-- P4d T54：多选批量操作开关 -->
        <el-button
          :type="selectionMode ? 'warning' : 'default'"
          :icon="Select"
          @click="toggleSelectionMode"
        >
          {{ selectionMode ? '退出批量' : '批量操作' }}
        </el-button>
        <!-- P4d T53：粘贴（剪切板有内容时可用） -->
        <el-button
          v-if="clipHasItems"
          type="primary"
          plain
          :icon="DocumentCopy"
          :loading="pasting"
          @click="pasteHere"
        >
          粘贴到当前目录（{{ clipItems.length }}）
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

    <!-- 面包屑（P4d T53：同时是拖拽移动目标——拖到任意上级即可移入该目录） -->
    <div class="v-cf-crumbs">
      <el-breadcrumb separator="/">
        <el-breadcrumb-item>
          <a
            :class="{ 'is-drop': dragOverKey === 'crumb:0' }"
            @click="goDir(0)"
            @dragover.prevent="onCrumbDragOver('crumb:0')"
            @dragleave="onCrumbDragLeave('crumb:0')"
            @drop.prevent.stop="onCrumbDrop($event, 0)"
          >根目录</a>
        </el-breadcrumb-item>
        <el-breadcrumb-item
          v-for="c in crumbs"
          :key="c.id"
        >
          <a
            :class="{ 'is-drop': dragOverKey === `crumb:${c.id}` }"
            @click="goDir(Number(c.id))"
            @dragover.prevent="onCrumbDragOver(`crumb:${c.id}`)"
            @dragleave="onCrumbDragLeave(`crumb:${c.id}`)"
            @drop.prevent.stop="onCrumbDrop($event, Number(c.id))"
          >{{ c.name }}</a>
        </el-breadcrumb-item>
      </el-breadcrumb>
    </div>

    <!-- P4d T54：多选工具栏（批量删除 / 批量移动 / 打包下载） -->
    <div
      v-if="selectionMode"
      class="v-cf-bulk"
    >
      <span class="v-cf-bulk-info">已选 {{ selectedRows.length }} 项</span>
      <el-button
        link
        type="primary"
        @click="toggleAllSelected"
      >
        {{ allSelected ? '取消全选' : '全选' }}
      </el-button>
      <el-button
        v-permission="'cloud:file:delete'"
        link
        type="danger"
        :disabled="selectedRows.length === 0"
        :loading="batchBusy"
        @click="batchRemove"
      >
        批量删除
      </el-button>
      <el-button
        v-permission="'cloud:file:upload'"
        link
        type="primary"
        :disabled="selectedRows.length === 0"
        @click="batchMoveToClipboard"
      >
        批量移动
      </el-button>
      <el-button
        v-permission="'cloud:file:list'"
        link
        type="primary"
        :disabled="selectedRows.length === 0"
        :loading="packing"
        @click="batchPackDownload"
      >
        打包下载
      </el-button>
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
        :row-class-name="rowClassName"
        @retry="reload"
      >
        <!-- P4d T54：多选列（自带勾选状态，不依赖 el-table selection，避免穿透封装组件） -->
        <el-table-column
          v-if="selectionMode"
          width="44"
        >
          <template #default="{ row }">
            <el-checkbox
              :model-value="isSelected(row)"
              @change="toggleRow(row)"
            />
          </template>
        </el-table-column>
        <el-table-column
          label="名称"
          min-width="240"
        >
          <template #default="{ row }">
            <span
              class="v-cf-name"
              :class="{ 'is-cutting': isCutting(row), 'is-drop': dragOverKey === `row:${row.id}` }"
              :draggable="true"
              @dblclick="onDblClick(row)"
              @dragstart="onRowDragStart($event, row)"
              @dragend="onRowDragEnd"
              @dragover.prevent="onRowDragOver($event, row)"
              @dragleave="onRowDragLeave($event, row)"
              @drop.prevent.stop="onRowDrop($event, row)"
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
          width="560"
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
            <!-- P4d T53：剪切（进内存剪切板，切到目标目录后点「粘贴」） -->
            <el-button
              v-permission="'cloud:file:upload'"
              link
              type="primary"
              @click="cutRows([row])"
            >
              剪切
            </el-button>
            <!-- P4d D48：文件夹亦可分享（动态子树） -->
            <el-button
              v-permission="'cloud:share:create'"
              link
              type="primary"
              @click="openShare(row)"
            >
              分享管理
            </el-button>
            <!-- P4d T57/D49：公开语义分流（站点子树内=设为私有/取消私有；站点外=token 公开；站点根恒公开无按钮） -->
            <template v-if="row.inSite">
              <el-button
                v-if="!row.isSiteRoot && row.isPublic !== 2"
                v-permission="'cloud:file:public'"
                link
                type="warning"
                @click="onSetPrivate(row)"
              >
                设为私有
              </el-button>
              <el-button
                v-if="!row.isSiteRoot && row.isPublic === 2"
                v-permission="'cloud:file:public'"
                link
                type="primary"
                @click="onCancelPrivate(row)"
              >
                取消私有
              </el-button>
            </template>
            <template v-else>
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
            确认后将生成分享链接，访客凭链接免登录访问该{{ shareFile?.isDir ? '文件夹' : '文件' }}（可设 4~8 位提取码）。
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
          <!-- P4d T55：提取码（可选，4~8 位；留空 = 无密码） -->
          <div class="v-cf-share-row">
            <span class="v-cf-share-label">提取码：</span>
            <el-input
              v-model="sharePassword"
              placeholder="4~8 位，留空则无需提取码"
              maxlength="8"
              show-password
              style="width: 240px"
            />
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
            有效期至：{{ shareExpireText }}，访客凭链接免登录访问。
          </p>
          <!-- P4d T55：提取码管理（当前：已设置/未设置；留空保存 = 移除） -->
          <div class="v-cf-share-row">
            <span class="v-cf-share-label">提取码：</span>
            <el-input
              v-model="sharePasswordInput"
              placeholder="4~8 位；留空保存 = 移除提取码"
              maxlength="8"
              show-password
              style="width: 240px"
            />
            <el-button
              :loading="sharePwdSubmitting"
              @click="submitSharePassword"
            >
              保存
            </el-button>
          </div>
          <p class="v-cf-tip">
            当前：{{ shareHasPassword ? '已设置提取码' : '无提取码' }}（修改后已通过验证的访客需重新输入）
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
      <!-- 内容区：票据直链（W7）——浏览器原生加载，支持 Range（秒开 / 拖动进度 / 零内存驻留） -->
      <div
        v-loading="previewLoading"
        class="v-cf-preview"
      >
        <img
          v-if="isImage(previewRow)"
          :src="previewUrl"
          alt="预览"
          @error="onMediaError"
        >
        <video
          v-else-if="isVideo(previewRow)"
          :src="previewUrl"
          controls
          style="max-width: 100%"
          @error="onMediaError"
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
        <!-- 解码失败兜底：明确告知原因并给下载出口，不再停留在无限转圈 -->
        <el-alert
          v-if="previewMediaFailed"
          class="v-cf-preview-alert"
          type="warning"
          show-icon
          :closable="false"
          title="该文件无法在线播放/显示"
          description="该文件的格式在网页里无法播放，请下载后用本地播放器查看。"
        />
      </div>
      <template
        v-if="previewMediaFailed"
        #footer
      >
        <el-button
          type="primary"
          @click="download(previewRow!)"
        >
          下载查看
        </el-button>
      </template>
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
        公开「{{ pubDirRow?.name }}」后，访客可凭公开链接在线访问该文件夹及其中内容（其中的子文件夹是否可见，跟随本文件夹设置）。
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

    <!-- P4d T54：批量操作失败汇总面板 -->
    <el-dialog
      v-model="batchResultVisible"
      title="批量操作结果"
      width="480px"
    >
      <p>以下 {{ batchFailures.length }} 项未完成：</p>
      <ul class="v-cf-fail-list">
        <li
          v-for="f in batchFailures"
          :key="f.name"
        >
          {{ f.name }}：{{ f.reason }}
        </li>
      </ul>
      <template #footer>
        <el-button
          type="primary"
          @click="batchResultVisible = false"
        >
          知道了
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { confirmDialog } from '@/utils/confirm'
import { useClipboard } from '@vueuse/core'
import { Upload, FolderAdd, Refresh, FolderOpened, Document, Select, DocumentCopy } from '@element-plus/icons-vue'
import ProTable from '@/components/ProTable/index.vue'
import FileEditorDialog from '../components/FileEditorDialog.vue'
import UploadQueue from './UploadQueue.vue'
import { useUploadQueue } from './useUploadQueue'
import { useMoveClipboard } from './useMoveClipboard'
import { formatSize, formatTime } from '@/utils/format'
import { saveBlob, downloadByUrl } from '@/utils/download'
import {
  listFiles,
  filePath,
  mkdir as apiMkdir,
  renameFile,
  removeFile,
  moveFile,
  packDownloadBlob,
  createPublicLink,
  cancelPublicLink,
  setFilePublic,
  unzipFile,
  getFileTicket,
} from '@/api/cloud/file'
import { createShare, stopShare, extendShare, updateSharePassword } from '@/api/cloud/share'
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

// ==================== P4d T53/T54：剪切板 + 多选批量状态 ====================
/** 内部移动的自定义 MIME（R40：与外部文件拖入的 'Files' 区分） */
const MOVE_MIME = 'application/x-iplat-move'

const {
  items: clipItems,
  hasItems: clipHasItems,
  idSet: clipIdSet,
  cut: clipCut,
  removeByIds: clipRemove,
} = useMoveClipboard()

const selectionMode = ref(false)
const selectedIds = ref<string[]>([])
const selectedRows = computed(() => list.value.filter((r) => selectedIds.value.includes(r.id)))
const allSelected = computed(() => list.value.length > 0 && selectedIds.value.length === list.value.length)
const batchBusy = ref(false)
const packing = ref(false)
const pasting = ref(false)

const dragOverKey = ref('')
const moveDragRow = ref<CloudFile | null>(null)

const batchResultVisible = ref(false)
const batchFailures = ref<Array<{ name: string; reason: string }>>([])

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
// P4d T55：提取码（创建时可选；详情态可修改/移除）
const sharePassword = ref('')
const sharePasswordInput = ref('')
const shareHasPassword = ref(false)
const sharePwdSubmitting = ref(false)
const extendVisible = ref(false)
const extendDays = ref(7)
const extendSubmitting = ref(false)

const previewVisible = ref(false)
const previewRow = ref<CloudFile | null>(null)
const previewUrl = ref('')
const previewLoading = ref(false)
/** 图片/视频解码失败标记（编码不受支持时给下载出口） */
const previewMediaFailed = ref(false)
/** 首次加载失败（票据过期等）时已自动重取一次，避免 onMediaError 死循环 */
const previewRetried = ref(false)

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
    selectedIds.value = []
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

// 预览类型判断：mime 优先；历史数据 mime 缺失/落成 octet-stream 时按扩展名兜底，
// 避免本可预览的文件被误判为「不支持在线预览」
const PREVIEW_IMAGE_EXTS: ReadonlySet<string> = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'])
const PREVIEW_VIDEO_EXTS: ReadonlySet<string> = new Set(['mp4', 'webm', 'ogg', 'ogv', 'mov', 'm4v'])
function isImage(r?: CloudFile | null) {
  if (r?.mime?.startsWith('image/')) return r.mime !== 'image/svg+xml'
  return !r?.mime && PREVIEW_IMAGE_EXTS.has((r?.ext ?? '').toLowerCase())
}
function isVideo(r?: CloudFile | null) {
  return r?.mime?.startsWith('video/') || PREVIEW_VIDEO_EXTS.has((r?.ext ?? '').toLowerCase())
}
function isText(r?: CloudFile | null) {
  return r?.mime?.startsWith('text/') || r?.mime === 'application/pdf'
}
async function openPreview(row: CloudFile) {
  previewRow.value = row
  previewVisible.value = true
  previewMediaFailed.value = false
  previewRetried.value = false
  previewUrl.value = ''
  // 不支持在线预览的类型不取票据，直接走下载引导
  if (!isImage(row) && !isVideo(row) && !isText(row)) return
  await loadPreviewUrl(row)
}

/** 取直链票据并赋给 <img>/<video>/<iframe>：浏览器原生请求，Range 生效（秒开/可拖动） */
async function loadPreviewUrl(row: CloudFile) {
  previewLoading.value = true
  try {
    const { previewUrl: url } = await getFileTicket(Number(row.id))
    previewUrl.value = url
  } catch {
    // 错误已由拦截器提示；同时给下载出口
    previewMediaFailed.value = true
  } finally {
    previewLoading.value = false
  }
}

/**
 * 图片/视频加载失败：常见原因是浏览器不支持该编码（H.265 等）；
 * 但也可能是票据过期（2h）——先自动重取一次票据，仍失败才提示并给下载出口。
 */
async function onMediaError() {
  if (previewRetried.value || !previewRow.value) {
    previewMediaFailed.value = true
    return
  }
  previewRetried.value = true
  await loadPreviewUrl(previewRow.value)
}

/** 弹框关闭后清空直链（URL 由后端签发，无需 revoke） */
function closePreview() {
  previewUrl.value = ''
  previewMediaFailed.value = false
  previewRetried.value = false
}

/**
 * 单文件下载（W7）：走票据直链，由浏览器原生下载——大文件不再整包驻留内存，
 * 天然支持断点续传与浏览器下载管理；文件名由后端 Content-Disposition 决定。
 */
async function download(row: CloudFile) {
  try {
    const { downloadUrl } = await getFileTicket(Number(row.id))
    downloadByUrl(downloadUrl)
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
  const confirmed = await confirmDialog(
    `确认解压「${row.name}」？将在当前目录创建同名文件夹，解压内容进入该文件夹（同名自动 "(1)"）`,
    '在线解压',
    { type: 'info' },
  )
  if (!confirmed) return
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
  if (!(await confirmDialog(`确认删除「${row.name}」？将移入回收站`, '提示', { type: 'warning' }))) return
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
  const confirmed = await confirmDialog(
    `确认取消公开「${row.name}」？旧公开链接将立即失效，重新公开会生成新链接`,
    '提示',
    { type: 'warning' },
  )
  if (!confirmed) return
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
  sharePassword.value = ''
  sharePasswordInput.value = ''
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
        shareHasPassword.value = res.hasPassword
      })
      .catch(() => {
        shareVisible.value = false
      })
      .finally(() => {
        shareLoading.value = false
      })
  } else {
    // 未分享（或已停止/已过期）：先选有效期（可填提取码），确定后才真正创建分享
    shareMode.value = 'create'
    shareId.value = ''
    shareUrl.value = ''
    shareExpireText.value = ''
    shareHasPassword.value = false
    shareVisible.value = true
  }
}

/** 确认分享：此时才调创建接口（提取码 4~8 位，留空 = 无密码） */
async function submitShare() {
  if (!shareFile.value) return
  const password = sharePassword.value.trim()
  if (password && (password.length < 4 || password.length > 8)) {
    ElMessage.warning('提取码需为 4~8 位')
    return
  }
  shareSubmitting.value = true
  try {
    const res = await createShare(Number(shareFile.value.id), shareDays.value, password || undefined)
    shareId.value = res.id
    shareUrl.value = `${window.location.origin}${res.url}`
    shareExpireText.value = res.expireAt ? new Date(res.expireAt).toLocaleString() : '永久'
    shareHasPassword.value = res.hasPassword
    shareMode.value = 'detail'
    // 首次分享是一次性动作：设置确认后直接关闭弹框，不再停在「已分享」详情态；
    // 需要复制链接/延长/停止时，再从列表「已分享」标签重新打开（openShare 会拉现存有效链接）
    shareVisible.value = false
    ElMessage.success('分享成功，可在「分享管理」中查看链接')
    reload()
  } catch {
    // 拦截器提示
  } finally {
    shareSubmitting.value = false
  }
}

/** 保存提取码（P4d T55：留空 = 移除；修改后旧访问凭证失效） */
async function submitSharePassword() {
  if (!shareId.value) return
  const value = sharePasswordInput.value.trim()
  if (value && (value.length < 4 || value.length > 8)) {
    ElMessage.warning('提取码需为 4~8 位')
    return
  }
  sharePwdSubmitting.value = true
  try {
    const res = await updateSharePassword(Number(shareId.value), value || null)
    shareHasPassword.value = res.hasPassword
    sharePasswordInput.value = ''
    ElMessage.success(res.hasPassword ? '提取码已更新' : '提取码已移除')
  } catch {
    // 拦截器提示
  } finally {
    sharePwdSubmitting.value = false
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
  const confirmed = await confirmDialog('停止后访客将无法访问该链接，确认停止？', '提示', {
    type: 'warning',
  })
  if (!confirmed) return
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

// ==================== P4d T53：剪切 / 粘贴 / 拖拽移动 ====================

function isCutting(row: CloudFile): boolean {
  return clipIdSet.value.has(row.id)
}

/** 剪切中的行整行半透明（PRD F1：剪切后列表行半透明显示） */
function rowClassName({ row }: { row: CloudFile }): string {
  return isCutting(row) ? 'is-cutting-row' : ''
}

/** 剪切（单行与批量共用）：入剪切板 → 进入目标目录 → 点「粘贴」 */
function cutRows(rows: CloudFile[]): void {
  clipCut(rows.map((r) => ({ id: r.id, name: r.name, isDir: r.isDir })))
  ElMessage.success(`已剪切 ${rows.length} 项，请进入目标目录后点击「粘贴」`)
}

/** 拖拽内外区分（R40）：dataTransfer.types 含自定义 MIME = 内部移动；含 Files = 外部上传（走 T48 队列） */
function isInternalDrag(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes(MOVE_MIME)
}

function onRowDragStart(e: DragEvent, row: CloudFile): void {
  moveDragRow.value = row
  e.dataTransfer?.setData(MOVE_MIME, row.id)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

function onRowDragEnd(): void {
  moveDragRow.value = null
  dragOverKey.value = ''
}

/** 文件夹行悬停高亮（移动样式，与上传的列表区整框高亮区分） */
function onRowDragOver(e: DragEvent, row: CloudFile): void {
  if (!isInternalDrag(e) || !row.isDir) return
  dragOverKey.value = `row:${row.id}`
}

function onRowDragLeave(_e: DragEvent, row: CloudFile): void {
  if (dragOverKey.value === `row:${row.id}`) dragOverKey.value = ''
}

async function onRowDrop(e: DragEvent, row: CloudFile): Promise<void> {
  if (!isInternalDrag(e) || !row.isDir) return
  const source = moveDragRow.value
  dragOverKey.value = ''
  moveDragRow.value = null
  if (!source || source.id === row.id) return
  await doMove([source], Number(row.id))
}

/** 面包屑悬停高亮（拖到任意上级即可移入） */
function onCrumbDragOver(key: string): void {
  if (moveDragRow.value) dragOverKey.value = key
}

function onCrumbDragLeave(key: string): void {
  if (dragOverKey.value === key) dragOverKey.value = ''
}

async function onCrumbDrop(e: DragEvent, id: number): Promise<void> {
  if (!isInternalDrag(e)) return
  const source = moveDragRow.value
  dragOverKey.value = ''
  moveDragRow.value = null
  if (!source) return
  await doMove([source], id)
}

/**
 * 移动（单条/多条共用，D42 队列逐条）：
 * 先试一批（不带 confirmPublic）；命中公开目标（R39 targetPublic）的项**整批一次确认**后带 confirmPublic 重发。
 */
async function doMove(targets: Array<{ id: string }>, targetParentId: number): Promise<void> {
  if (targets.length === 0) return
  pasting.value = true
  try {
    const pending: Array<{ id: string }> = []
    let moved = 0
    for (const target of targets) {
      const res = await moveFile(Number(target.id), targetParentId)
      if (res.targetPublic) pending.push(target)
      else moved++
    }
    if (pending.length > 0) {
      const confirmed = await confirmDialog(
        '目标目录处于公开状态，移入后内容将对外可见（可被公开访问）。确认继续？',
        '公开继承警告',
        { type: 'warning', confirmButtonText: '仍然移入', cancelButtonText: '取消' },
      )
      if (!confirmed) {
        // 用户取消：已移动的保留，未执行项留在剪切板便于改投他处
        clipRemove(targets.filter((t) => !pending.includes(t)).map((t) => t.id))
        if (moved > 0) reload()
        return
      }
      for (const target of pending) {
        await moveFile(Number(target.id), targetParentId, true)
        moved++
      }
    }
    clipRemove(targets.map((t) => t.id))
    if (moved > 0) {
      ElMessage.success(`已移动 ${moved} 项`)
      reload()
    }
  } catch {
    // 错误已由拦截器提示；失败项保留在剪切板
  } finally {
    pasting.value = false
  }
}

/** 粘贴到当前目录 */
async function pasteHere(): Promise<void> {
  await doMove(clipItems.value, currentDir.value)
}

// ==================== P4d T54：多选 / 批量操作 ====================

function isSelected(row: CloudFile): boolean {
  return selectedIds.value.includes(row.id)
}

function toggleRow(row: CloudFile): void {
  selectedIds.value = isSelected(row)
    ? selectedIds.value.filter((id) => id !== row.id)
    : [...selectedIds.value, row.id]
}

function toggleAllSelected(): void {
  selectedIds.value = allSelected.value ? [] : list.value.map((r) => r.id)
}

function toggleSelectionMode(): void {
  selectionMode.value = !selectionMode.value
  if (!selectionMode.value) selectedIds.value = []
}

/** 批量移动：复用剪切粘贴链路（批量入剪切板） */
function batchMoveToClipboard(): void {
  if (selectedRows.value.length === 0) return
  cutRows(selectedRows.value)
  selectedIds.value = []
}

/** 批量删除：前端队列（并发 3，单失败独立记录）→ 汇总面板 */
async function batchRemove(): Promise<void> {
  const rows = selectedRows.value
  if (rows.length === 0) return
  const confirmed = await confirmDialog(`确认删除选中的 ${rows.length} 项？将移入回收站`, '提示', {
    type: 'warning',
  })
  if (!confirmed) return
  batchBusy.value = true
  const failures: Array<{ name: string; reason: string }> = []
  let ok = 0
  await runWithConcurrency(rows, 3, async (row) => {
    try {
      await removeFile(Number(row.id))
      ok++
    } catch (error) {
      failures.push({ name: row.name, reason: (error as Error).message || '删除失败' })
    }
  })
  batchBusy.value = false
  selectedIds.value = []
  ElMessage.success(`已删除 ${ok} 项${failures.length > 0 ? `，失败 ${failures.length} 项` : ''}`)
  reload()
  if (failures.length > 0) {
    batchFailures.value = failures
    batchResultVisible.value = true
  }
}

/** 打包下载（P4d T54/D45）：流式 zip，浏览器下载 */
async function batchPackDownload(): Promise<void> {
  const rows = selectedRows.value
  if (rows.length === 0) return
  packing.value = true
  try {
    const blob = await packDownloadBlob(rows.map((r) => r.id))
    saveBlob(blob, buildPackFilename())
    ElMessage.success('打包完成，开始下载')
  } catch (error) {
    ElMessage.error((error as Error).message || '打包下载失败')
  } finally {
    packing.value = false
  }
}

/** 并发受限的队列执行（D42：批量操作前端队列，并发 3） */
async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      await worker(items[index])
    }
  })
  await Promise.all(runners)
}

/** 包名与后端同格式：iplat-pack-yyyyMMdd-HHmm.zip */
function buildPackFilename(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `iplat-pack-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.zip`
}

// ==================== P4d T57：公开语义分流（D49/R45） ====================

/** 站点子树内：设为私有（is_public → 2 显式阻断，R45） */
async function onSetPrivate(row: CloudFile): Promise<void> {
  const confirmed = await confirmDialog(
    `确认将「${row.name}」设为私有？其内容将不再对外公开。`,
    '设为私有',
    { type: 'warning' },
  )
  if (!confirmed) return
  try {
    await setFilePublic(Number(row.id), false)
    ElMessage.success('已设为私有')
    reload()
  } catch {
    // 拦截器提示
  }
}

/** 站点子树内：取消私有（is_public → 0 继承，随站点根公开；复用取消公开接口的归 0 语义） */
async function onCancelPrivate(row: CloudFile): Promise<void> {
  try {
    await cancelPublicLink(Number(row.id))
    ElMessage.success('已取消私有（跟随所在站点的公开设置）')
    reload()
  } catch {
    // 拦截器提示
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
/* P4d T53：剪切中的行半透明（PRD F1） */
:deep(.el-table .is-cutting-row) {
  opacity: 0.5;
}
/* 移动拖拽目标高亮（文件夹行 / 面包屑项；与上传的列表区整框高亮样式区分 R40） */
.v-cf-name.is-drop,
.v-cf-crumbs a.is-drop {
  background: var(--el-color-primary-light-8);
  border-radius: 3px;
  outline: 1px dashed var(--el-color-primary);
  outline-offset: 1px;
}
/* P4d T54：多选工具栏 */
.v-cf-bulk {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  padding: 6px 10px;
  background: var(--el-color-warning-light-9);
  border: 1px solid var(--el-color-warning-light-7);
  border-radius: 4px;
  font-size: 13px;
}
.v-cf-bulk-info {
  color: #606266;
}
/* 批量操作失败汇总 */
.v-cf-fail-list {
  margin: 8px 0 0;
  padding-left: 20px;
  color: var(--el-color-danger);
  font-size: 13px;
  max-height: 240px;
  overflow: auto;
}

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
.v-cf-preview-alert {
  margin-top: 12px;
  text-align: left;
}
</style>
