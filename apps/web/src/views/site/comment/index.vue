<template>
  <div class="v-site-comment">
    <SiteSwitcher />
    <ProTable
      :data="list"
      :loading="loading"
      :load-error="loadError"
      :total="total"
      :page-no="pageNo"
      :page-size="pageSize"
      @retry="reload"
      @page-change="onPageChange"
      @size-change="onSizeChange"
    >
      <template #search>
        <el-form-item label="审核状态">
          <el-select
            v-model="filterAuditStatus"
            clearable
            style="width: 140px"
          >
            <el-option
              label="待审核"
              :value="0"
            />
            <el-option
              label="已通过"
              :value="1"
            />
            <el-option
              label="已驳回"
              :value="2"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="昵称">
          <el-input
            v-model="filterKeyword"
            placeholder="按昵称搜索"
            clearable
            style="width: 180px"
            @keyup.enter="reload"
            @clear="reload"
          />
        </el-form-item>
      </template>
      <el-table-column
        label="文章"
        min-width="180"
      >
        <template #default="{ row }">
          {{ row.articleTitle || '（文章已删除）' }}
        </template>
      </el-table-column>
      <el-table-column
        label="昵称"
        width="140"
        prop="nickname"
      />
      <el-table-column
        label="评论内容"
        min-width="240"
      >
        <template #default="{ row }">
          <span class="v-sc-content">{{ row.content }}</span>
        </template>
      </el-table-column>
      <el-table-column
        label="IP"
        width="130"
        prop="ip"
      />
      <el-table-column
        label="状态"
        width="90"
      >
        <template #default="{ row }">
          <el-tag
            :type="statusTagType(row.auditStatus)"
            size="small"
          >
            {{ statusText(row.auditStatus) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column
        label="提交时间"
        width="170"
        :formatter="(r: SiteCommentItem) => formatTime(r.createdAt)"
      />
      <el-table-column
        label="操作"
        width="180"
        fixed="right"
      >
        <template #default="{ row }">
          <el-button
            v-if="row.auditStatus !== 1"
            v-permission="'site:comment:audit'"
            link
            type="success"
            @click="onAudit(row, 1)"
          >
            通过
          </el-button>
          <el-button
            v-if="row.auditStatus === 0"
            v-permission="'site:comment:audit'"
            link
            type="warning"
            @click="onAudit(row, 2)"
          >
            驳回
          </el-button>
          <el-button
            v-permission="'site:comment:delete'"
            link
            type="danger"
            @click="onRemove(row)"
          >
            删除
          </el-button>
        </template>
      </el-table-column>
      <template #empty>
        <el-empty
          v-if="!loadError"
          :description="emptyText"
        />
      </template>
    </ProTable>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import ProTable from '@/components/ProTable/index.vue'
import SiteSwitcher from '@/components/SiteSwitcher/index.vue'
import { formatTime } from '@/utils/format'
import { listComments, auditComment, removeComment } from '@/api/site/site'
import { useSiteStore } from '@/stores/site'
import type { SiteCommentItem } from '@/types/api'

const siteStore = useSiteStore()
const loading = ref(false)
const loadError = ref(false)
const list = ref<SiteCommentItem[]>([])
const total = ref(0)
const pageNo = ref(1)
const pageSize = ref(10)
/** 无站点时的空态文案（P4E：站点为 0 时不做接口请求） */
const emptyText = computed(() => (siteStore.empty ? '还没有站点，请先到「站点列表」创建' : '还没有评论'))

const filterAuditStatus = ref<number | undefined>()
const filterKeyword = ref('')

function statusText(status: number) {
  return status === 1 ? '已通过' : status === 2 ? '已驳回' : '待审核'
}
function statusTagType(status: number) {
  return status === 1 ? 'success' : status === 2 ? 'danger' : 'warning'
}

async function reload() {
  loadError.value = false
  if (!siteStore.currentSiteId) {
    list.value = []
    total.value = 0
    return
  }
  loading.value = true
  try {
    const res = await listComments({
      pageNo: pageNo.value,
      pageSize: pageSize.value,
      siteId: Number(siteStore.currentSiteId),
      auditStatus: filterAuditStatus.value,
      keyword: filterKeyword.value.trim() || undefined,
    })
    list.value = res.list
    total.value = res.total
  } catch {
    list.value = []
    loadError.value = true
  } finally {
    loading.value = false
  }
}

function onPageChange(page: number) {
  pageNo.value = page
  reload()
}

function onSizeChange(size: number) {
  pageSize.value = size
  pageNo.value = 1
  reload()
}

async function onAudit(row: SiteCommentItem, auditStatus: number) {
  const action = auditStatus === 1 ? '通过' : '驳回'
  await ElMessageBox.confirm(`确认${action}该评论？`, '提示', { type: 'info' })
  try {
    await auditComment(Number(row.id), auditStatus)
    ElMessage.success(`已${action}`)
    reload()
  } catch {
    // 拦截器提示
  }
}

async function onRemove(row: SiteCommentItem) {
  await ElMessageBox.confirm('确认删除该评论？物理删除不可恢复', '警告', { type: 'warning' })
  try {
    await removeComment(Number(row.id))
    ElMessage.success('已删除')
    reload()
  } catch {
    // 拦截器提示
  }
}

onMounted(async () => {
  await siteStore.ensureLoaded().catch(() => undefined)
  reload()
})

// 切换当前站点 → 回到第一页并重新拉取（P4E D54）
watch(
  () => siteStore.currentSiteId,
  () => {
    pageNo.value = 1
    reload()
  },
)
</script>

<style scoped>
.v-site-comment {
  padding: 16px;
  background: #fff;
  border-radius: 6px;
  min-height: 100%;
}
.v-sc-content {
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
