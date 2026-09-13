import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { listSites } from '@/api/site/site'
import type { SiteSiteInfo } from '@/types/api'

/** 当前站点 localStorage key（P4E D54：全局 store + 持久化） */
const CURRENT_SITE_KEY = 'iplat:site:current'

/**
 * 当前站点状态（P4E D54/T63）。
 *
 * - `listSites` 是唯一数据源：站点列表（创建时间升序，第一站语义稳定）+ 配额 limit/used；
 * - `currentSiteId` 持久化 localStorage；`resolveCurrent()` 回退链：
 *   缓存命中且仍在 list 中 → 用之；否则唯一站点自动选定；否则第一站；0 站 → 空态引导建站；
 *   站点被他端删除后，下次 load 即自动回退（验收 6）；
 * - 5 个既有站点页统一从这里取 siteId 注入请求，页顶切换器只在多站时出现（单站用户无感）。
 */
export const useSiteStore = defineStore('site', () => {
  const sites = ref<SiteSiteInfo[]>([])
  const limit = ref(1)
  const used = ref(0)
  const loading = ref(false)
  /** 是否已成功加载过（软缓存；切换/删除后调 load 强制刷新） */
  const loaded = ref(false)
  const currentSiteId = ref<string>(localStorage.getItem(CURRENT_SITE_KEY) ?? '')

  const currentSite = computed<SiteSiteInfo | null>(
    () => sites.value.find((s) => s.id === currentSiteId.value) ?? null,
  )
  /** 多站（页顶切换器展示条件） */
  const multi = computed(() => sites.value.length > 1)
  /** 无站点（空态引导建站） */
  const empty = computed(() => loaded.value && sites.value.length === 0)
  /** 站点数配额已满（新建按钮禁用） */
  const quotaFull = computed(() => used.value >= limit.value)

  /** 设置当前站点并持久化 */
  function setCurrent(id: string) {
    currentSiteId.value = id
    if (id) localStorage.setItem(CURRENT_SITE_KEY, id)
    else localStorage.removeItem(CURRENT_SITE_KEY)
  }

  /** 回退链：缓存命中 → 唯一站 → 第一站 → 空 */
  function resolveCurrent() {
    if (sites.value.length === 0) {
      setCurrent('')
      return
    }
    if (sites.value.some((s) => s.id === currentSiteId.value)) return
    setCurrent(sites.value[0].id)
  }

  /** 加载站点列表与配额，并纠正当前站点 */
  async function load(): Promise<void> {
    loading.value = true
    try {
      const res = await listSites()
      sites.value = res.list
      limit.value = res.limit
      used.value = res.used
      loaded.value = true
      resolveCurrent()
    } finally {
      loading.value = false
    }
  }

  /** 首次进入页面时确保已加载（避免每个页面重复请求） */
  async function ensureLoaded(): Promise<void> {
    if (loaded.value) {
      resolveCurrent()
      return
    }
    await load()
  }

  /** 退出登录时清空（避免串号残留，服务端属主校验兜底） */
  function reset() {
    sites.value = []
    limit.value = 1
    used.value = 0
    loaded.value = false
    setCurrent('')
  }

  return {
    sites,
    limit,
    used,
    loading,
    loaded,
    currentSiteId,
    currentSite,
    multi,
    empty,
    quotaFull,
    setCurrent,
    resolveCurrent,
    load,
    ensureLoaded,
    reset,
  }
})
