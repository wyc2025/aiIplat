<template>
  <div class="pv-folder">
    <div
      v-loading="loading"
      class="pv-body"
    >
      <!-- 40117：未开放列表浏览（R33 显式提示；知道完整路径的子文件落地页仍可访问） -->
      <el-result
        v-if="!loading && state === 'listing-disabled'"
        icon="info"
        title="该文件夹未开放列表浏览"
        sub-title="如需查看内容，请向分享者索取文件的完整链接"
      />
      <!-- 失败态：统一 404 提示（不区分原因，防探测口径） -->
      <el-result
        v-else-if="!loading && state === 'failed'"
        icon="warning"
        title="链接无效或已失效"
        sub-title="请向分享者确认链接"
      />

      <template v-else-if="!loading && state === 'ok'">
        <h3 class="pv-name">
          文件夹浏览
        </h3>
        <!-- 面包屑（path 逐段下钻；点击回跳） -->
        <div class="pv-crumb">
          <el-link
            :underline="false"
            @click="goPath('')"
          >
            根目录
          </el-link>
          <template
            v-for="(seg, i) in segments"
            :key="i"
          >
            <span class="pv-crumb-sep">/</span>
            <el-link
              v-if="i < segments.length - 1"
              :underline="false"
              @click="goPath(segments.slice(0, i + 1).join('/'))"
            >
              {{ seg }}
            </el-link>
            <span
              v-else
              class="pv-crumb-cur"
            >{{ seg }}</span>
          </template>
        </div>

        <el-table
          :data="items"
          class="pv-table"
          @row-click="onRowClick"
        >
          <el-table-column label="名称">
            <template #default="{ row }">
              <el-icon
                :size="16"
                class="pv-icon"
                :class="row.isDir ? 'is-dir' : 'is-file'"
              >
                <Folder v-if="row.isDir" />
                <Document v-else />
              </el-icon>
              <span>{{ row.name }}</span>
            </template>
          </el-table-column>
          <el-table-column
            label="大小"
            width="120"
          >
            <template #default="{ row }">
              {{ row.isDir ? '—' : formatSize(row.size) }}
            </template>
          </el-table-column>
          <el-table-column
            label="修改时间"
            width="200"
          >
            <template #default="{ row }">
              {{ formatTime(row.updatedAt) }}
            </template>
          </el-table-column>
        </el-table>
        <p class="pv-tip">
          点击文件夹继续浏览，点击文件打开查看页
        </p>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Document, Folder } from '@element-plus/icons-vue'
import { pubFolderList, PubApiError } from '@/api/cloud/public'
import type { PubListItem } from '@/types/api'

const route = useRoute()
const router = useRouter()
const loading = ref(true)
const state = ref<'ok' | 'listing-disabled' | 'failed'>('ok')
const items = ref<PubListItem[]>([])

const token = computed(() => route.params.token as string)
/** 当前相对路径（与后端 path 口径一致：'/' 连接、无首尾斜杠；'' = 根） */
const currentPath = computed(() => (route.query.path as string) ?? '')
const segments = computed(() => currentPath.value.split('/').filter(Boolean))

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

/** 下钻/回跳：path 同步进 query（可分享、可前进后退） */
function goPath(path: string): void {
  router.push({ path: `/view/d/${token.value}`, query: path ? { path } : {} })
}

/** 点行：文件夹下钻；文件进落地页（知道完整路径即可访问，D32/R33） */
function onRowClick(row: PubListItem): void {
  const next = currentPath.value ? `${currentPath.value}/${row.name}` : row.name
  if (row.isDir) {
    goPath(next)
  } else {
    router.push({ path: `/view/d/${token.value}/file`, query: { path: next } })
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

async function load(): Promise<void> {
  loading.value = true
  try {
    const res = await pubFolderList(token.value, currentPath.value || undefined)
    items.value = res.items
    state.value = 'ok'
  } catch (e) {
    state.value = e instanceof PubApiError && e.code === 40117 ? 'listing-disabled' : 'failed'
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  ensureNoindex()
  load()
})
// path 变化（同路由下钻/回跳）重载
watch(currentPath, load)
</script>

<style scoped>
.pv-folder {
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
  margin: 0 0 12px;
}
.pv-crumb {
  width: 100%;
  margin-bottom: 12px;
  font-size: 14px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}
.pv-crumb-sep {
  color: #c0c4cc;
}
.pv-crumb-cur {
  color: #303133;
}
.pv-icon {
  margin-right: 6px;
  vertical-align: -3px;
}
.pv-icon.is-dir {
  color: #e6a23c;
}
.pv-icon.is-file {
  color: #909399;
}
.pv-table {
  width: 100%;
  background: #fff;
}
.pv-tip {
  color: #c0c4cc;
  font-size: 12px;
  margin: 12px 0 0;
}
</style>
