<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { getSchema } from '@/api/app'
import AdminRenderer from '@/components/app-renderer/index.vue'
import type { AppPageView, AppSchemaBundle } from '@/types/api'

/**
 * 功能页宿主（P11 T106，API-P11 §2）：
 * 静态通配路由 `/app-center/app/:appCode/p/:pageCode` 渲染本组件，按参数拉 schema 后交给 AdminRenderer。
 * 菜单只驱动跳转，无需按页注册路由。
 */
const route = useRoute()
const appCode = computed(() => String(route.params.appCode ?? ''))
const pageCode = computed(() => String(route.params.pageCode ?? ''))

const bundle = ref<AppSchemaBundle | null>(null)
const loading = ref(false)
const loadError = ref(false)

const page = computed<AppPageView | null>(
  () => bundle.value?.pages.find((item) => item.code === pageCode.value) ?? null,
)

async function load(): Promise<void> {
  if (!appCode.value) return
  loading.value = true
  loadError.value = false
  try {
    bundle.value = await getSchema(appCode.value)
  } catch {
    bundle.value = null
    loadError.value = true
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch([appCode, pageCode], load)
</script>

<template>
  <div
    v-loading="loading"
    class="v-function-page"
  >
    <el-result
      v-if="loadError"
      icon="error"
      title="功能页加载失败"
      sub-title="应用不存在或无权访问"
    >
      <template #extra>
        <el-button
          type="primary"
          @click="load"
        >
          重试
        </el-button>
      </template>
    </el-result>
    <AdminRenderer
      v-else-if="page"
      :app-code="appCode"
      :page="page"
    />
    <el-empty
      v-else-if="!loading"
      description="功能页不存在（可能已被删除）"
    />
  </div>
</template>

<style scoped>
.v-function-page {
  min-height: 200px;
}
</style>
