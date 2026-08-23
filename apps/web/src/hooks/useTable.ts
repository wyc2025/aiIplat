import { reactive, ref } from 'vue'
import type { PageResult } from '@/types/api'

interface UseTableOptions<T, Q extends object> {
  /** 查询接口：入参为 查询条件 + 分页，返回分页结构 */
  fetchApi: (params: Q & { pageNo: number; pageSize: number }) => Promise<PageResult<T>>
  /** 初始查询条件 */
  query?: Q
  /** 是否立即加载（默认 true） */
  immediate?: boolean
}

/**
 * 列表页通用逻辑：加载中/空/失败三态、分页、查询、重置、刷新。
 * 业务页只需提供 fetchApi 与查询字段，禁止手写分页/加载/重置逻辑（ARCHITECTURE 3.4）。
 */
export function useTable<T, Q extends object = Record<string, unknown>>(
  options: UseTableOptions<T, Q>,
) {
  const { fetchApi, immediate = true } = options

  const loading = ref(false)
  const list = ref<T[]>([]) as import('vue').Ref<T[]>
  const total = ref(0)
  const pageNo = ref(1)
  const pageSize = ref(10)
  const loadError = ref(false)
  /** 查询条件（可外部双向绑定到搜索区） */
  const query = reactive({ ...(options.query ?? {}) }) as Q

  async function load() {
    loading.value = true
    loadError.value = false
    try {
      const res = await fetchApi({ ...query, pageNo: pageNo.value, pageSize: pageSize.value })
      list.value = res.list
      total.value = res.total
    } catch {
      list.value = []
      total.value = 0
      loadError.value = true
    } finally {
      loading.value = false
    }
  }

  /** 查询：回到第一页 */
  function search() {
    pageNo.value = 1
    load()
  }

  /** 重置：清空查询条件并回到第一页 */
  function reset() {
    Object.keys(query).forEach((key) => {
      ;(query as Record<string, unknown>)[key] = undefined
    })
    pageNo.value = 1
    load()
  }

  function handlePageChange(page: number) {
    pageNo.value = page
    load()
  }

  function handleSizeChange(size: number) {
    pageSize.value = size
    pageNo.value = 1
    load()
  }

  if (immediate) load()

  return {
    loading,
    list,
    total,
    pageNo,
    pageSize,
    loadError,
    query,
    load,
    search,
    reset,
    handlePageChange,
    handleSizeChange,
  }
}
