<template>
  <div class="v-share-visitor">
    <el-card class="v-sv-card">
      <div
        v-loading="loading"
        class="v-sv-body"
      >
        <template v-if="!loading && info">
          <el-icon :size="48">
            <Link />
          </el-icon>
          <h3 class="v-sv-name">
            {{ info.fileName }}
          </h3>
          <p class="v-sv-meta">
            {{ formatSize(Number(info.size)) }}
            <span v-if="info.expireAt"> · 有效期至 {{ new Date(info.expireAt).toLocaleString() }}</span>
            <span v-else> · 永久有效</span>
            · 已下载 {{ info.visitCount }} 次
          </p>
          <el-button
            type="primary"
            size="large"
            :icon="Download"
            @click="onDownload"
          >
            下载文件
          </el-button>
        </template>
        <el-result
          v-if="!loading && !info"
          icon="warning"
          title="链接无效或已失效"
          sub-title="请向分享者确认链接"
        />
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { Link, Download } from '@element-plus/icons-vue'
import { publicShareInfo, publicDownloadUrl } from '@/api/cloud/share'
import type { CloudSharePublic } from '@/types/api'

const route = useRoute()
const loading = ref(false)
const info = ref<CloudSharePublic | null>(null)

function formatSize(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B'
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

function onDownload() {
  if (!info.value) return
  const a = document.createElement('a')
  a.href = publicDownloadUrl(info.value.token)
  a.download = info.value.fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
}

onMounted(async () => {
  const token = route.params.token as string
  loading.value = true
  try {
    const res = await publicShareInfo(token)
    // 后端已做失效校验（30008），isExpired 仅前端展示补充
    if (res.isExpired) {
      info.value = null
    } else {
      info.value = res
    }
  } catch {
    info.value = null
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.v-share-visitor {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f0f2f5;
  padding: 24px;
}
.v-sv-card {
  width: 420px;
  max-width: 100%;
}
.v-sv-body {
  text-align: center;
  padding: 24px 8px;
  min-height: 160px;
}
.v-sv-name {
  margin: 12px 0 8px;
}
.v-sv-meta {
  color: #909399;
  font-size: 13px;
  margin-bottom: 20px;
}
</style>
