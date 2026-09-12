import { computed, ref } from 'vue'

/** 移动剪切板条目（仅需移动所需的最小字段，避免持有整行对象过期） */
export interface MoveClipboardItem {
  id: string
  name: string
  isDir: boolean
}

/**
 * 剪切板 / 移动（P4d T53/T54）：模块级单例（工具栏、行、批量入口共用同一份状态）。
 * 一期为**会话内存态**：不持久化，刷新页面即清空（PRD-P4D §8 遗留待确认 3）。
 * 命名避开 vueuse 的 useClipboard（复制文本用），故为 useMoveClipboard（§17.4）。
 */
const items = ref<MoveClipboardItem[]>([])

export function useMoveClipboard() {
  const hasItems = computed(() => items.value.length > 0)
  /** 已剪切项 id 集合（列表行半透明展示用） */
  const idSet = computed(() => new Set(items.value.map((i) => i.id)))

  /** 放入剪切板（覆盖式：单行剪切与批量移动共用） */
  function cut(rows: MoveClipboardItem[]): void {
    items.value = rows.map((r) => ({ id: r.id, name: r.name, isDir: r.isDir }))
  }

  /** 移出剪切板中指定的项（粘贴成功后按项移除） */
  function removeByIds(ids: string[]): void {
    const removeSet = new Set(ids)
    items.value = items.value.filter((i) => !removeSet.has(i.id))
  }

  function clear(): void {
    items.value = []
  }

  return { items, hasItems, idSet, cut, removeByIds, clear }
}
