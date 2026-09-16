<template>
  <div>
    <ProTable
      :data="list"
      :loading="loading"
      :load-error="loadError"
      :pagination="false"
      @retry="load"
    >
      <template #toolbar>
        <el-button
          :icon="Refresh"
          @click="load"
        >
          刷新
        </el-button>
      </template>

      <el-table-column
        prop="username"
        label="用户名"
        min-width="140"
      />
      <el-table-column
        prop="nickname"
        label="昵称"
        min-width="140"
      />
      <el-table-column
        prop="ip"
        label="登录 IP"
        min-width="140"
      >
        <template #default="{ row }">
          {{ row.ip || '—' }}
        </template>
      </el-table-column>
      <el-table-column
        prop="loginAt"
        label="登录时间"
        width="180"
      >
        <template #default="{ row }">
          {{ formatTime(row.loginAt) }}
        </template>
      </el-table-column>
      <el-table-column
        prop="lastActiveAt"
        label="最后活跃时间"
        width="180"
      >
        <template #default="{ row }">
          {{ formatTime(row.lastActiveAt) }}
        </template>
      </el-table-column>
      <el-table-column
        label="操作"
        width="110"
        fixed="right"
      >
        <template #default="{ row }">
          <el-button
            v-if="row.username !== 'admin'"
            v-permission="'system:online:kick'"
            link
            type="danger"
            @click="handleKick(row)"
          >
            踢下线
          </el-button>
        </template>
      </el-table-column>
    </ProTable>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { confirmDialog } from '@/utils/confirm'
import { Refresh } from '@element-plus/icons-vue'
import dayjs from 'dayjs'
import ProTable from '@/components/ProTable/index.vue'
import { getOnlineList, kickUser, type OnlineUserItem } from '@/api/system/online'

const list = ref<OnlineUserItem[]>([])
const loading = ref(false)
const loadError = ref(false)

onMounted(() => {
  load()
})

async function load() {
  loading.value = true
  loadError.value = false
  try {
    list.value = await getOnlineList()
  } catch {
    list.value = []
    loadError.value = true
  } finally {
    loading.value = false
  }
}

async function handleKick(row: OnlineUserItem) {
  const confirmed = await confirmDialog(
    `确认将用户「${row.nickname}（${row.username}）」踢下线吗？其所有端将被强制登出。`,
    '提示',
    {
      type: 'warning',
      confirmButtonText: '确认踢下线',
      cancelButtonText: '取消',
    },
  )
  if (!confirmed) return
  await kickUser(row.userId)
  ElMessage.success('已踢下线')
  load()
}

function formatTime(t: string) {
  return t ? dayjs(t).format('YYYY-MM-DD HH:mm:ss') : '—'
}
</script>
