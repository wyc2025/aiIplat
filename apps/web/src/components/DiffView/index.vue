<template>
  <el-dialog
    :model-value="visible"
    :title="title"
    width="82%"
    top="5vh"
    :close-on-click-modal="false"
    destroy-on-close
    @update:model-value="emit('update:visible', $event)"
    @opened="mountDiff"
    @closed="destroyDiff"
  >
    <p class="v-dv-meta">
      左：{{ leftLabel }} · 右：{{ rightLabel }} · 行数 {{ beforeLines }} → {{ afterLines }}（只读对比，不做合并编辑）
    </p>
    <div
      ref="host"
      v-loading="loading"
      class="v-dv-host"
    />
    <template #footer>
      <slot name="footer">
        <el-button @click="emit('update:visible', false)">
          关闭
        </el-button>
      </slot>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue'
import type { MergeView } from '@codemirror/merge'

/**
 * 只读双栏 diff（P8 T89 新增公共组件，照云盘 FileEditorDialog 的只读对比口径）：
 * - 左右两侧均为只读，仅高亮差异，用于"改了再确认"的场景（如一键排版预览）；
 * - CodeMirror 相关包**动态 import**：调用方（文章页）首屏不加载编辑器依赖；
 * - 生命周期跟随弹窗：@opened 挂载、@closed 销毁，避免隐藏态测量为 0 导致渲染异常。
 */
const props = withDefaults(
  defineProps<{
    visible: boolean
    title?: string
    /** 左侧内容（旧） */
    before: string
    /** 右侧内容（新） */
    after: string
    leftLabel?: string
    rightLabel?: string
  }>(),
  { title: '改动对比', leftLabel: '改动前', rightLabel: '改动后' },
)

const emit = defineEmits<{ (e: 'update:visible', value: boolean): void }>()

const host = ref<HTMLElement>()
const view = shallowRef<MergeView | null>(null)
const loading = ref(false)

const beforeLines = computed(() => countLines(props.before))
const afterLines = computed(() => countLines(props.after))

function countLines(text: string): number {
  if (text === '') return 0
  return text.split('\n').length
}

async function mountDiff(): Promise<void> {
  if (!host.value) return
  loading.value = true
  try {
    const [{ MergeView }, { EditorState }, { EditorView }] = await Promise.all([
      import('@codemirror/merge'),
      import('@codemirror/state'),
      import('@codemirror/view'),
    ])
    view.value?.destroy()
    view.value = new MergeView({
      parent: host.value,
      a: {
        doc: props.before,
        extensions: [EditorState.readOnly.of(true), EditorView.lineWrapping],
      },
      b: {
        doc: props.after,
        extensions: [EditorState.readOnly.of(true), EditorView.lineWrapping],
      },
      highlightChanges: true,
      gutter: true,
    })
  } finally {
    loading.value = false
  }
}

function destroyDiff(): void {
  view.value?.destroy()
  view.value = null
}
</script>

<style scoped>
.v-dv-meta {
  margin: 0 0 8px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.v-dv-host {
  height: 62vh;
  overflow: hidden;
  border: 1px solid var(--el-border-color-light);
  border-radius: 4px;
}
.v-dv-host :deep(.cm-mergeView) {
  height: 100%;
  overflow: auto;
}
.v-dv-host :deep(.cm-mergeViewEditors) {
  height: auto;
}
</style>
