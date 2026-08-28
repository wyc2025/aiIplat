<template>
  <div class="v-cloud-recycle">
    <div class="v-cr-bar">
      <el-breadcrumb separator="/">
        <el-breadcrumb-item>
          <a @click="goDir(0)">回收站</a>
        </el-breadcrumb-item>
        <el-breadcrumb-item
          v-for="c in crumbs"
          :key="c.id"
        >
          <a @click="goDir(Number(c.id))">{{ c.name }}</a>
        </el-breadcrumb-item>
      </el-breadcrumb>
      <el-button
        v-permission="'cloud:recycle:delete'"
        type="danger"
        :icon="Delete"
        @click="onClear"
      >
        清空回收站
      </el-button>
    </div>

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
      <el-table-column
        label="名称"
        min-width="220"
      >
        <template #default="{ row }">
          <span
            class="v-cr-name"
            @dblclick="onDblClick(row)"
          >
            <el-icon v-if="row.isDir"><FolderOpened /></el-icon>
            <el-icon v-else><Document /></el-icon>
            {{ row.name }}
          </span>
        </template>
      </el-table-column>
      <el-table-column
        label="大小"
        width="120"
        :formatter="(r: CloudRecycleItem) => r.isDir ? '-' : formatSize(Number(r.size))"
      />
      <el-table-column
        label="原位置"
        width="180"
        :formatter="(r: CloudRecycleItem) => r.parentName || '根目录'"
      />
      <el-table-column
        label="删除时间"
        width="180"
        prop="deletedAt"
        :formatter="(r: CloudRecycleItem) => r.deletedAt ? formatTime(r.deletedAt) : '-'"
      />
      <el-table-column
        label="操作"
        width="200"
        fixed="right"
      >
        <template #default="{ row }">
          <el-button
            v-permission="'cloud:recycle:restore'"
            link
            type="primary"
            @click="onRestore(row)"
          >
            还原
          </el-button>
          <el-button
            v-permission="'cloud:recycle:delete'"
            link
            type="danger"
            @click="onPurge(row)"
          >
            彻底删除
          </el-button>
        </template>
      </el-table-column>
      <template #empty>
        <el-empty
          v-if="!loadError"
          description="回收站是空的"
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
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, FolderOpened, Document } from '@element-plus/icons-vue'
import ProTable from '@/components/ProTable/index.vue'
import { formatSize, formatTime } from '@/utils/format'
import {
  listRecycle,
  recyclePath,
  restoreRecycle,
  clearRecycle,
  purgeRecycle,
} from '@/api/cloud/recycle'
import type { CloudRecycleItem, BreadcrumbItem } from '@/types/api'

const loading = ref(false)
const loadError = ref(false)
const list = ref<CloudRecycleItem[]>([])
const total = ref(0)
const pageNo = ref(1)
const pageSize = ref(999)
const crumbs = ref<BreadcrumbItem[]>([])
const currentDir = ref(0)

async function loadDir(dir: number) {
  loading.value = true
  loadError.value = false
  try {
    const [items, crumb] = await Promise.all([listRecycle(dir), dir === 0 ? [] : recyclePath(dir)])
    // 后端返回裸数组（对齐 P1/P2 非分页列表风格），直接喂给表格
    list.value = items ?? []
    total.value = list.value.length
    crumbs.value = crumb
  } catch {
    list.value = []
    loadError.value = true
  } finally {
    loading.value = false
  }
}

function reload() {
  loadDir(currentDir.value)
}
function goDir(id: number) {
  currentDir.value = id
  loadDir(id)
}
function onDblClick(row: CloudRecycleItem) {
  if (row.isDir) goDir(Number(row.id))
}

async function onRestore(row: CloudRecycleItem) {
  await restoreRecycle(Number(row.id))
  ElMessage.success('已还原')
  reload()
}
async function onPurge(row: CloudRecycleItem) {
  await ElMessageBox.confirm(`彻底删除「${row.name}」？不可恢复`, '提示', { type: 'warning' })
  await purgeRecycle(Number(row.id))
  ElMessage.success('已彻底删除')
  reload()
}
async function onClear() {
  await ElMessageBox.confirm('确认清空回收站？全部文件将永久删除', '提示', { type: 'warning' })
  await clearRecycle()
  ElMessage.success('已清空')
  reload()
}

onMounted(() => loadDir(0))
</script>

<style scoped>
.v-cloud-recycle {
  padding: 16px;
  background: #fff;
  border-radius: 6px;
  min-height: 100%;
}
.v-cr-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.v-cr-name {
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.v-cr-name:hover {
  color: #409eff;
}
</style>
