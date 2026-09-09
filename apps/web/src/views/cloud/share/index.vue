<template>
  <div class="v-cloud-share">
    <ProTable
      :data="list"
      :loading="loading"
      :load-error="loadError"
      :total="total"
      :page-no="pageNo"
      :page-size="pageSize"
      :pagination="false"
      @retry="reload"
    >
      <template #toolbar>
        <el-select
          v-model="filterStatus"
          style="width: 160px"
          @change="reload"
        >
          <el-option
            label="全部（不含已停止）"
            value=""
          />
          <el-option
            label="有效"
            :value="1"
          />
          <el-option
            label="已过期"
            :value="2"
          />
          <el-option
            label="已停止"
            :value="0"
          />
        </el-select>
        <el-input
          v-model="keyword"
          placeholder="按文件名搜索"
          clearable
          style="width: 200px; margin: 0 8px"
          @keyup.enter="reload"
          @clear="reload"
        />
        <el-button
          :icon="Search"
          @click="reload"
        >
          查询
        </el-button>
        <el-button
          :icon="Refresh"
          @click="onReset"
        >
          重置
        </el-button>
      </template>
      <el-table-column
        label="文件"
        min-width="180"
      >
        <template #default="{ row }">
          {{ row.fileName }}
          <el-tag
            v-if="row.fileDeleted"
            type="danger"
            size="small"
            style="margin-left: 4px"
          >
            源文件已删
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column
        label="大小"
        width="110"
        :formatter="(r: CloudShare) => formatSize(Number(r.size))"
      />
      <el-table-column
        label="创建时间"
        width="170"
        :formatter="(r: CloudShare) => r.createTime ? formatTime(r.createTime) : '-'"
      />
      <el-table-column
        label="有效期至"
        width="170"
        :formatter="(r: CloudShare) => r.expireAt ? formatTime(r.expireAt) : '永久'"
      />
      <el-table-column
        label="访问次数"
        width="90"
        prop="visitCount"
      />
      <el-table-column
        label="状态"
        width="90"
      >
        <template #default="{ row }">
          <el-tag
            :type="statusTagType(row.status)"
            size="small"
          >
            {{ statusText(row.status) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column
        label="操作"
        width="200"
        fixed="right"
      >
        <template #default="{ row }">
          <template v-if="row.status === 1">
            <el-button
              v-permission="'cloud:share:list'"
              link
              type="primary"
              @click="onCopy(row)"
            >
              复制链接
            </el-button>
            <el-button
              v-permission="'cloud:share:stop'"
              link
              type="primary"
              @click="onExtend(row)"
            >
              延长
            </el-button>
            <el-button
              v-permission="'cloud:share:stop'"
              link
              type="danger"
              @click="onStop(row)"
            >
              停止
            </el-button>
          </template>
          <template v-else-if="row.status === 2">
            <el-button
              v-permission="'cloud:share:stop'"
              link
              type="primary"
              @click="onExtend(row)"
            >
              延长
            </el-button>
            <el-button
              v-permission="'cloud:share:stop'"
              link
              type="danger"
              @click="onStop(row)"
            >
              停止
            </el-button>
          </template>
          <span
            v-else
            class="v-share-none"
          >-</span>
        </template>
      </el-table-column>
      <template #empty>
        <el-empty
          v-if="!loadError"
          description="还没有分享链接"
        />
        <el-result
          v-else
          icon="error"
          title="加载失败"
          sub-title="请稍后重试"
        >
          <template #extra>
            <el-button
              type="primary"
              @click="reload"
            >
              重试
            </el-button>
          </template>
        </el-result>
      </template>
    </ProTable>

    <el-dialog
      v-model="extendVisible"
      title="延长有效期"
      width="380px"
    >
      <el-select
        v-model="extendDays"
        style="width: 100%"
      >
        <el-option
          v-for="d in [1, 7, 30, 0]"
          :key="d"
          :label="d === 0 ? '永久' : `${d} 天`"
          :value="d"
        />
      </el-select>
      <template #footer>
        <el-button @click="extendVisible = false">
          取消
        </el-button>
        <el-button
          type="primary"
          :loading="submitting"
          @click="submitExtend"
        >
          确定
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useClipboard } from '@vueuse/core'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Refresh, Search } from '@element-plus/icons-vue'
import ProTable from '@/components/ProTable/index.vue'
import { formatSize, formatTime } from '@/utils/format'
import { listShare, stopShare, extendShare } from '@/api/cloud/share'
import type { CloudShare } from '@/types/api'

const loading = ref(false)
const loadError = ref(false)
const list = ref<CloudShare[]>([])
const total = ref(0)
const pageNo = ref(1)
const pageSize = ref(999)

/** 状态筛选：'' = 全部（不含已停止）；0 已停止 / 1 有效 / 2 已过期 */
const filterStatus = ref<number | ''>('')
const keyword = ref('')

const extendVisible = ref(false)
const extendDays = ref(7)
const extendTarget = ref<CloudShare | null>(null)
const submitting = ref(false)

async function reload() {
  loading.value = true
  loadError.value = false
  try {
    list.value = await listShare(
      filterStatus.value === '' ? undefined : filterStatus.value,
      keyword.value.trim() || undefined,
    )
    total.value = list.value.length
  } catch {
    list.value = []
    loadError.value = true
  } finally {
    loading.value = false
  }
}

function onReset() {
  filterStatus.value = ''
  keyword.value = ''
  reload()
}

function statusText(status: 1 | 0 | 2) {
  return status === 1 ? '有效' : status === 2 ? '已过期' : '已停止'
}
function statusTagType(status: 1 | 0 | 2) {
  return status === 1 ? 'success' : status === 2 ? 'warning' : 'info'
}

function shareUrl(row: CloudShare) {
  return `${location.origin}/share/${row.token}`
}
// legacy=true：非安全上下文（HTTP 部署，navigator.clipboard 为 undefined）自动降级
// document.execCommand('copy')；await 等待结果，失败如实提示，不再无条件报"已复制"
const { copy: copyToClipboard } = useClipboard({ legacy: true })
async function onCopy(row: CloudShare) {
  try {
    await copyToClipboard(shareUrl(row))
    ElMessage.success('已复制')
  } catch {
    ElMessage.error('复制失败，请手动复制链接')
  }
}
async function onStop(row: CloudShare) {
  await ElMessageBox.confirm('停止后链接即刻失效，确认？', '提示', { type: 'warning' })
  await stopShare(Number(row.id))
  ElMessage.success('已停止')
  reload()
}
function onExtend(row: CloudShare) {
  extendTarget.value = row
  extendDays.value = 7
  extendVisible.value = true
}
async function submitExtend() {
  if (!extendTarget.value) return
  submitting.value = true
  try {
    await extendShare(Number(extendTarget.value.id), extendDays.value)
    ElMessage.success('已延长')
    extendVisible.value = false
    reload()
  } catch {
    // 拦截器提示
  } finally {
    submitting.value = false
  }
}

onMounted(reload)
</script>

<style scoped>
.v-cloud-share {
  padding: 16px;
  background: #fff;
  border-radius: 6px;
  min-height: 100%;
}
.v-share-none {
  color: var(--el-text-color-secondary);
}
</style>
