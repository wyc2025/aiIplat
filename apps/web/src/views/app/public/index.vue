<script setup lang="ts">
/**
 * 数据应用公开展示页宿主（P12 T113，ARCHITECTURE §28.5）。
 *
 * 路由：`/pub/app/:pubCode`（索引 → 重定向首个公开页，无公开页则空态）
 *      `/pub/app/:pubCode/p/:pageCode`（宿主：拉 manifest + 页 schema → PublicRenderer）。
 * 免登录：后端 @Public + 前端 guard 白名单（/pub/）双保险；独立简洁布局（无管理侧边栏）。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  AppPubApiError,
  pubAppManifest,
  pubAppPageSchema,
  type PubAppManifest,
} from '@/api/app/pub'
import PublicRenderer from '@/components/app-renderer/PublicRenderer.vue'
import type { DataRowView } from '@/types/api'

const route = useRoute()
const router = useRouter()

const pubCode = computed(() => String(route.params.pubCode ?? ''))
const pageCode = computed(() => String(route.params.pageCode ?? ''))

const manifest = ref<PubAppManifest | null>(null)
const schema = ref<Record<string, unknown> | null>(null)
const loading = ref(false)
const error = ref('')

/** 详情行参数名：取当前 query 的第一个键（列表页按 rowLink.rowIdParam 跳转），默认 rowId */
const rowIdParam = computed(() => {
  const keys = Object.keys(route.query)
  return keys.length > 0 ? keys[0] : 'rowId'
})

/** 列表行点击 → 跳同应用详情页（R102：rowLink 目标页 code） */
function onRowClick(row: DataRowView, rowLink: { page: string; rowIdParam?: string }): void {
  void router.push({
    path: `/pub/app/${pubCode.value}/p/${rowLink.page}`,
    query: { [rowLink.rowIdParam ?? 'rowId']: row.rowId },
  })
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    manifest.value = await pubAppManifest(pubCode.value)
    const target = pageCode.value || manifest.value.pages[0]?.code || ''
    if (!pageCode.value && target) {
      await router.replace(`/pub/app/${pubCode.value}/p/${target}`)
      return
    }
    if (!target) {
      schema.value = null
      error.value = '该应用尚未公开任何展示页'
      return
    }
    schema.value = await pubAppPageSchema(pubCode.value, target)
  } catch (err) {
    schema.value = null
    manifest.value = null
    error.value =
      err instanceof AppPubApiError && err.code === 40400
        ? '该公开页不存在或已取消公开'
        : err instanceof Error
          ? err.message
          : '加载失败'
  } finally {
    loading.value = false
  }
}

watch([pubCode, pageCode], () => void load())
onMounted(() => void load())
</script>

<template>
  <div class="pub-app">
    <header class="pub-app__header">
      <h1 class="pub-app__title">
        {{ manifest?.name ?? '公开展示页' }}
      </h1>
      <p
        v-if="manifest?.description"
        class="pub-app__desc"
      >
        {{ manifest.description }}
      </p>
      <nav
        v-if="(manifest?.pages?.length ?? 0) > 1"
        class="pub-app__nav"
      >
        <router-link
          v-for="item in manifest?.pages ?? []"
          :key="item.code"
          class="pub-app__nav-item"
          :class="{ 'is-active': item.code === pageCode }"
          :to="`/pub/app/${pubCode}/p/${item.code}`"
        >
          {{ item.name }}
        </router-link>
      </nav>
    </header>

    <main
      v-loading="loading"
      class="pub-app__body"
    >
      <el-alert
        v-if="error"
        :title="error"
        type="warning"
        :closable="false"
        show-icon
      />
      <PublicRenderer
        v-else-if="schema"
        :pub-code="pubCode"
        :schema="schema"
        :route-query="route.query as Record<string, unknown>"
        :row-id-param="rowIdParam"
        :on-row-click="onRowClick"
      />
    </main>

    <footer class="pub-app__footer">
      由 iplat 数据应用公开面提供
    </footer>
  </div>
</template>

<style scoped>
.pub-app {
  min-height: 100vh;
  padding: 24px 16px 48px;
  background: var(--el-bg-color-page, #f5f7fa);
}

.pub-app__header {
  max-width: 1080px;
  margin: 0 auto 16px;
}

.pub-app__title {
  margin: 0 0 6px;
  font-size: 22px;
}

.pub-app__desc {
  margin: 0 0 10px;
  color: var(--el-text-color-regular);
  font-size: 13px;
}

.pub-app__nav {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.pub-app__nav-item {
  padding: 4px 12px;
  border-radius: 14px;
  background: var(--el-fill-color-light, #f0f2f5);
  color: var(--el-text-color-regular);
  font-size: 13px;
  text-decoration: none;
}

.pub-app__nav-item.is-active {
  background: var(--el-color-primary);
  color: #fff;
}

.pub-app__body {
  max-width: 1080px;
  margin: 0 auto;
  min-height: 160px;
}

.pub-app__footer {
  max-width: 1080px;
  margin: 24px auto 0;
  text-align: center;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
</style>
