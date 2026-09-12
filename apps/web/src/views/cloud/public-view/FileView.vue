<template>
  <div class="pv-file">
    <div
      v-loading="loading"
      class="pv-body"
    >
      <!-- 失败态：统一 404 提示（不区分原因，防探测口径） -->
      <el-result
        v-if="!loading && failed"
        icon="warning"
        title="链接无效或已失效"
        sub-title="请向分享者确认链接"
      />

      <template v-else-if="!loading && info">
        <h3 class="pv-name">
          {{ info.name }}
        </h3>
        <p class="pv-meta">
          {{ formatSize(info.size) }}<span v-if="info.updatedAt"> · {{ formatTime(info.updatedAt) }}</span>
        </p>

        <!-- 内容区：按类型分支（D33 瘦版：video/audio 原生 controls，img 直显，PDF 内嵌，文本预格式化，其他图标） -->
        <div class="pv-content">
          <video
            v-if="branch === 'video'"
            :src="rawUrl"
            controls
            class="pv-media"
          />
          <audio
            v-else-if="branch === 'audio'"
            :src="rawUrl"
            controls
            class="pv-audio"
          />
          <img
            v-else-if="branch === 'image'"
            :src="rawUrl"
            :alt="info.name"
            class="pv-image"
          >
          <iframe
            v-else-if="branch === 'pdf'"
            :src="rawUrl"
            class="pv-pdf"
          />
          <!-- md/markdown：markdown-it 渲染（复用公共组件 MarkdownView，html:false 防 XSS） -->
          <div
            v-else-if="branch === 'markdown'"
            class="pv-md"
          >
            <MarkdownView :content="textBody" />
            <span
              v-if="textTruncated"
              class="pv-truncate"
            >（内容过长，仅展示前 {{ TEXT_TRUNCATE }} 字符，完整内容请下载查看）</span>
          </div>
          <div
            v-else-if="branch === 'text'"
            class="pv-textwrap"
          >
            <!-- 插值渲染（Vue 文本转义，与 textContent 同级防 XSS）；禁用 DOM 注入：内容加载时
                 loading 尚未结束、v-if 未渲染，模板 ref 拿不到元素会静默丢失内容（2026-09-10 修复） -->
            <pre class="pv-text">{{ textBody }}</pre>
            <span
              v-if="textTruncated"
              class="pv-truncate"
            >（内容过长，仅展示前 {{ TEXT_TRUNCATE }} 字符，完整内容请下载查看）</span>
          </div>
          <div
            v-else
            class="pv-other"
          >
            <el-icon :size="56">
              <Document />
            </el-icon>
            <p>该类型不支持在线查看，请下载后打开</p>
          </div>
        </div>

        <el-button
          type="primary"
          size="large"
          :icon="Download"
          @click="onDownload"
        >
          下载
        </el-button>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Download, Document } from '@element-plus/icons-vue'
import MarkdownView from '@/components/MarkdownView/index.vue'
import type { PubFileInfo } from '@/types/api'
import { createPublicSource, type PublicSource } from './usePublicSource'

/** 类型分支白名单（F2；文本/音视频集合与后端 R26 口径对齐，以 ext 为准） */
const VIDEO_EXTS = new Set(['mp4', 'webm', 'ogg'])
const AUDIO_EXTS = new Set(['mp3', 'wav', 'm4a'])
const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp'])
const MD_EXTS = new Set(['md', 'markdown'])
const TEXT_EXTS = new Set(['txt', 'json', 'js', 'ts', 'vue', 'css', 'xml', 'yml', 'yaml', 'csv', 'log'])
/** 文本分支截断展示上限（完整内容走下载） */
const TEXT_TRUNCATE = 100_000
/** 需提取码（P4d 30017：分享页据此回退到密码门禁） */
const CODE_NEED_PASSWORD = 30017

/**
 * 数据源适配（D46）：公开页（pub）由路由 token 自建；分享页（share）由父级传入自带 sid 的 source。
 * path 缺省：公开落地页直接文件；文件夹内子文件页从 query.path 取。
 */
const props = defineProps<{ source?: PublicSource; path?: string }>()
const emit = defineEmits<{ (e: 'need-password'): void }>()

const route = useRoute()
const source = computed<PublicSource>(
  () =>
    props.source ??
    createPublicSource({ kind: 'pub', token: route.params.token as string }),
)
/** 子项寻址路径（分享页由父级传入；公开落地页取 route.query.path） */
const targetPath = computed<string | undefined>(() => {
  if (props.path !== undefined) return props.path
  if (props.source) return undefined
  return route.name === 'public-subfile-view' ? ((route.query.path as string) ?? '') : undefined
})

const loading = ref(true)
const failed = ref(false)
const info = ref<PubFileInfo | null>(null)
const textBody = ref('')
const textTruncated = ref(false)

const rawUrl = computed(() => source.value.rawUrl(targetPath.value))

/** 渲染分支（ext 小写；空 ext 走 other） */
const branch = computed(() => {
  const ext = (info.value?.ext ?? '').toLowerCase()
  if (VIDEO_EXTS.has(ext)) return 'video'
  if (AUDIO_EXTS.has(ext)) return 'audio'
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (MD_EXTS.has(ext)) return 'markdown'
  if (TEXT_EXTS.has(ext)) return 'text'
  return 'other'
})

function formatSize(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B'
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(2)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString()
}

function onDownload() {
  const a = document.createElement('a')
  a.href = source.value.downloadUrl(targetPath.value)
  a.download = info.value?.name ?? ''
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/** 文本分支：fetch raw 填充响应式内容（插值渲染自动文本转义，防 XSS 等效 textContent） */
async function loadText(): Promise<void> {
  try {
    const res = await fetch(rawUrl.value)
    if (!res.ok) throw new Error()
    const text = await res.text()
    textTruncated.value = text.length > TEXT_TRUNCATE
    textBody.value = textTruncated.value ? text.slice(0, TEXT_TRUNCATE) : text
  } catch {
    textBody.value = '（内容加载失败，请下载查看）'
  }
}

/** 落地页极简无 SEO 诉求（PRD F2：noindex） */
function ensureNoindex(): void {
  if (document.querySelector('meta[name="robots"]')) return
  const meta = document.createElement('meta')
  meta.name = 'robots'
  meta.content = 'noindex'
  document.head.appendChild(meta)
}

/** 取元信息（+ 文本内容）；同路由换子项（targetPath 变化）时复用 */
async function load(): Promise<void> {
  loading.value = true
  failed.value = false
  textBody.value = ''
  textTruncated.value = false
  try {
    info.value = await source.value.fileInfo(targetPath.value)
    if (branch.value === 'text' || branch.value === 'markdown') await loadText()
  } catch (error) {
    // 分享页：未过密码门/凭证过期 → 交由父级回退到门禁页（P4d 30017）
    if ((error as { code?: number }).code === CODE_NEED_PASSWORD) {
      emit('need-password')
    } else {
      // 统一失败态，不区分原因（40400 防探测口径）
      failed.value = true
    }
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  ensureNoindex()
  load()
})
// 子项寻址变化（同一 FileView 实例换文件）重载
watch(targetPath, load)
</script>

<style scoped>
.pv-file {
  min-height: 100vh;
  background: #f5f7fa;
  padding: 24px;
  display: flex;
  justify-content: center;
}
.pv-body {
  width: 100%;
  max-width: 960px;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px 8px;
}
.pv-name {
  margin: 0 0 6px;
  word-break: break-all;
  text-align: center;
}
.pv-meta {
  color: #909399;
  font-size: 13px;
  margin: 0 0 16px;
}
.pv-content {
  width: 100%;
  margin-bottom: 20px;
  display: flex;
  justify-content: center;
}
.pv-media {
  width: 100%;
  max-height: 70vh;
  background: #000;
  border-radius: 6px;
}
.pv-audio {
  width: 100%;
  margin: 24px 0;
}
.pv-image {
  max-width: 100%;
  max-height: 70vh;
  border-radius: 6px;
}
.pv-pdf {
  width: 100%;
  height: 75vh;
  border: none;
  border-radius: 6px;
  background: #fff;
}
.pv-textwrap {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.pv-md {
  width: 100%;
  max-height: 70vh;
  overflow: auto;
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  padding: 16px 20px;
}
.pv-text {
  width: 100%;
  max-height: 70vh;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
  background: #fff;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  padding: 16px;
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  font-family: Consolas, Monaco, 'Courier New', monospace;
}
.pv-truncate {
  color: #909399;
  font-size: 12px;
}
.pv-other {
  text-align: center;
  color: #909399;
  padding: 48px 0;
}
</style>
