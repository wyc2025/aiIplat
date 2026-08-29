<template>
  <el-dialog
    :model-value="visible"
    fullscreen
    :close-on-click-modal="false"
    :before-close="handleBeforeClose"
    class="v-file-editor-dialog"
    :title="`在线编辑 — ${file?.name ?? ''}`"
    @opened="onOpened"
    @closed="onClosed"
  >
    <div
      v-loading="loading"
      class="v-fe-wrap"
    >
      <el-result
        v-if="loadError"
        icon="error"
        title="加载失败"
        sub-title="文件内容读取失败，请稍后重试"
      >
        <template #extra>
          <el-button
            type="primary"
            @click="open"
          >
            重试
          </el-button>
        </template>
      </el-result>
      <div
        v-show="!loadError"
        ref="editorHost"
        class="v-fe-host"
      />
    </div>
    <template #footer>
      <div class="v-fe-footer">
        <span class="v-fe-meta">
          {{ extLabel }} · 原始大小 {{ formatSize(Number(file?.size ?? 0)) }} ·
          <el-tag
            :type="dirty ? 'warning' : 'success'"
            size="small"
          >
            {{ dirty ? '未保存' : '无改动' }}
          </el-tag>
        </span>
        <el-button @click="requestClose">
          关闭
        </el-button>
        <el-button
          type="primary"
          :loading="saving"
          :disabled="!dirty"
          @click="save"
        >
          保存（Ctrl/Cmd + S）
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { EditorView, basicSetup } from 'codemirror'
import type { Extension } from '@codemirror/state'
import { previewFileBlob, updateFileContent } from '@/api/cloud/file'
import { formatSize } from '@/utils/format'

/**
 * CodeMirror 6 在线编辑弹窗（P4b T43，架构增补 §15.1/§15.13）。
 * - 语言包按扩展名动态 import（vite 自动分包），不阻塞云盘页首屏（PRD F3）
 * - 保存走 PUT /cloud/file/:id/content（更新行语义，fileId/URL 不变，开放层立即生效）
 * - 脏检查：内容变更未保存时关闭 → ElMessageBox 二次确认（PRD F3）
 */
const props = defineProps<{
  visible: boolean
  file: { id: string; name: string; ext: string | null; size: string } | null
}>()

const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'saved'): void
}>()

const editorHost = ref<HTMLElement>()
const loading = ref(false)
const loadError = ref(false)
const saving = ref(false)
const dirty = ref(false)
/** EditorView 持有大量子对象，用 shallowRef 避免深度响应式开销 */
const view = shallowRef<EditorView | null>(null)

const extLabel = computed(() => (props.file?.ext ?? 'txt').toUpperCase())

/** 语言扩展按需加载（§15.12 白名单内高亮，yaml/csv/txt 纯文本） */
async function loadLangExtension(ext: string): Promise<Extension[]> {
  try {
    switch (ext) {
      case 'html':
      case 'htm':
        return [(await import('@codemirror/lang-html')).html()]
      case 'css':
        return [(await import('@codemirror/lang-css')).css()]
      case 'js':
      case 'mjs':
        return [(await import('@codemirror/lang-javascript')).javascript()]
      case 'json':
        return [(await import('@codemirror/lang-json')).json()]
      case 'md':
        return [(await import('@codemirror/lang-markdown')).markdown()]
      case 'svg':
      case 'xml':
        return [(await import('@codemirror/lang-xml')).xml()]
      default:
        return []
    }
  } catch {
    // 语言包加载失败不阻塞编辑（纯文本兜底）
    return []
  }
}

/** 弹窗完全打开（DOM 就绪）后拉内容并挂编辑器 */
async function onOpened() {
  await open()
}

async function open() {
  if (!props.file || !editorHost.value) return
  loading.value = true
  loadError.value = false
  try {
    // 文本内容读取复用预览流（文本类强制 text/plain; charset=utf-8，R7）
    const blob = await previewFileBlob(Number(props.file.id))
    const content = await blob.text()
    const lang = await loadLangExtension((props.file.ext ?? '').toLowerCase())
    view.value?.destroy()
    view.value = new EditorView({
      parent: editorHost.value,
      doc: content,
      extensions: [
        basicSetup,
        ...lang,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) dirty.value = true
        }),
        EditorView.lineWrapping,
      ],
    })
    dirty.value = false
  } catch {
    loadError.value = true
  } finally {
    loading.value = false
  }
}

/** Ctrl/Cmd + S 保存（容器捕获层拦截，避免浏览器默认保存对话框） */
function onHostKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault()
    if (dirty.value && !saving.value) void save()
  }
}

onMounted(() => {
  editorHost.value?.addEventListener('keydown', onHostKeydown, true)
})

onBeforeUnmount(() => {
  editorHost.value?.removeEventListener('keydown', onHostKeydown, true)
})

async function save() {
  if (!props.file || !view.value) return
  saving.value = true
  try {
    await updateFileContent(Number(props.file.id), view.value.state.doc.toString())
    dirty.value = false
    ElMessage.success('已保存，公开访问即时生效')
    emit('saved')
  } catch {
    // 错误已由拦截器提示
  } finally {
    saving.value = false
  }
}

/** 脏检查：内容变更未保存时关闭需二次确认（PRD F3） */
async function handleBeforeClose(done: () => void) {
  if (!dirty.value) {
    done()
    return
  }
  try {
    await ElMessageBox.confirm('当前内容尚未保存，确定关闭？', '提示', {
      confirmButtonText: '放弃更改并关闭',
      cancelButtonText: '继续编辑',
      type: 'warning',
    })
    dirty.value = false
    done()
  } catch {
    // 用户选择继续编辑
  }
}

function requestClose() {
  void handleBeforeClose(() => emit('update:visible', false))
}

/** 关闭完成：销毁编辑器释放资源 */
function onClosed() {
  view.value?.destroy()
  view.value = null
  loadError.value = false
  dirty.value = false
}
</script>

<style scoped>
.v-fe-wrap {
  height: calc(100vh - 160px);
}
.v-fe-host {
  height: 100%;
  overflow: hidden;
  border: 1px solid var(--el-border-color-light);
  border-radius: 4px;
}
.v-fe-host :deep(.cm-editor) {
  height: 100%;
}
.v-fe-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}
.v-fe-meta {
  margin-right: auto;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
</style>
