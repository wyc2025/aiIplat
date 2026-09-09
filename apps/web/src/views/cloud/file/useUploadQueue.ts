import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { uploadFile } from '@/api/cloud/file'

/** 队列并发数（P4c D34/R28：并发 3 worker 池，后端零改动） */
const CONCURRENCY = 3

/** 队列单项状态：pending → uploading → success / failed（单文件失败不阻塞队列） */
export interface UploadQueueItem {
  key: number
  /** 入队时的原始文件名 */
  name: string
  size: number
  /** 入队时锁定的目标目录（拖入哪个目录就传哪个，切目录不影响在队列项） */
  parentId: number
  status: 'pending' | 'uploading' | 'success' | 'failed'
  /** 0~100（单文件 onUploadProgress） */
  percent: number
  /** 失败原因（后端业务文案：配额 30003 / 单目录 500 项 30006 / 超限 30004 等） */
  error: string
  /** 成功后的最终落盘名称（R4 同名自动 "(1)" / R5 覆盖同名） */
  finalName: string
}

/**
 * 上传队列状态机（P4c T48，架构增补 §16.4；供「我的文件」页接入）：
 * - enqueue 入队即启动 pump，最多 CONCURRENCY 个并发 worker
 * - 全部队列结算（无 pending/uploading）触发一次 onAllSettled（父组件刷新列表）
 * - 队列进行中注册 beforeunload 拦截（上传中刷新/离开提示），空闲自动移除
 */
export function useUploadQueue(options: {
  overwrite: () => boolean
  onAllSettled?: () => void
}) {
  const items = ref<UploadQueueItem[]>([])
  const visible = ref(false)
  let seq = 0
  let activeCount = 0

  const hasActive = computed(() =>
    items.value.some((i) => i.status === 'pending' || i.status === 'uploading'),
  )
  const successCount = computed(() => items.value.filter((i) => i.status === 'success').length)
  const failCount = computed(() => items.value.filter((i) => i.status === 'failed').length)
  /** 总进度：按字节加权（成功/失败按其最终字节进度计入） */
  const totalPercent = computed(() => {
    let totalBytes = 0
    let doneBytes = 0
    for (const i of items.value) {
      totalBytes += i.size
      doneBytes += Math.round((i.size * i.percent) / 100)
    }
    return totalBytes === 0 ? 0 : Math.min(100, Math.round((doneBytes / totalBytes) * 100))
  })

  /** 入队（外部先做文件夹检测/过滤）并启动 pump */
  function enqueue(files: File[], parentId: number): void {
    if (files.length === 0) return
    for (const f of files) {
      items.value.push({
        key: ++seq,
        name: f.name,
        size: f.size,
        parentId,
        status: 'pending',
        percent: 0,
        error: '',
        finalName: '',
      })
      // 回填 File 引用（单独存避免放进响应式对象带来代理开销）
      fileMap.set(items.value[items.value.length - 1].key, f)
    }
    visible.value = true
    pump()
  }

  const fileMap = new Map<number, File>()

  /** worker 池：空位就取下一个 pending */
  function pump(): void {
    while (activeCount < CONCURRENCY) {
      const next = items.value.find((i) => i.status === 'pending')
      if (!next) break
      void start(next)
    }
  }

  async function start(item: UploadQueueItem): Promise<void> {
    const file = fileMap.get(item.key)
    if (!file) {
      item.status = 'failed'
      item.error = '文件对象已失效'
      return
    }
    item.status = 'uploading'
    activeCount++
    try {
      const res = await uploadFile(item.parentId, file, (p) => {
        item.percent = p
      }, options.overwrite())
      item.status = 'success'
      item.percent = 100
      item.finalName = res.name
    } catch (e) {
      item.status = 'failed'
      item.error = e instanceof Error && e.message ? e.message : '上传失败'
    } finally {
      activeCount--
      if (!hasActive.value) options.onAllSettled?.()
      pump()
    }
  }

  /** 清空已结束项（进行中不可清）；清空后队列空则收起面板 */
  function clearFinished(): void {
    items.value = items.value.filter((i) => i.status === 'pending' || i.status === 'uploading')
    if (items.value.length === 0) visible.value = false
  }

  // beforeunload：队列进行中拦截刷新/关闭（上传中断会留下半截 tmp，且进度丢失）
  function onBeforeUnload(e: BeforeUnloadEvent): void {
    e.preventDefault()
    e.returnValue = ''
  }
  watch(hasActive, (active) => {
    if (active) window.addEventListener('beforeunload', onBeforeUnload)
    else window.removeEventListener('beforeunload', onBeforeUnload)
  })
  onBeforeUnmount(() => window.removeEventListener('beforeunload', onBeforeUnload))

  return {
    items,
    visible,
    hasActive,
    successCount,
    failCount,
    totalPercent,
    enqueue,
    clearFinished,
  }
}
