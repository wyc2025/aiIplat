<template>
  <ProTable
    :data="list"
    :loading="loading"
    :load-error="loadError"
    :total="total"
    :page-no="pageNo"
    :page-size="pageSize"
    @search="handleSearch"
    @reset="handleReset"
    @retry="load"
    @page-change="handlePageChange"
    @size-change="handleSizeChange"
  >
    <template #search>
      <el-form-item label="操作人">
        <el-input
          v-model="query.username"
          placeholder="请输入操作人"
          clearable
          style="width: 160px"
        />
      </el-form-item>
      <el-form-item label="模块">
        <el-input
          v-model="query.module"
          placeholder="请输入模块"
          clearable
          style="width: 160px"
        />
      </el-form-item>
      <el-form-item label="状态">
        <el-select
          v-model="query.status"
          placeholder="全部"
          clearable
          style="width: 120px"
        >
          <el-option
            label="成功"
            :value="1"
          />
          <el-option
            label="失败"
            :value="0"
          />
        </el-select>
      </el-form-item>
      <el-form-item label="操作时间">
        <el-date-picker
          v-model="dateRange"
          type="daterange"
          value-format="YYYY-MM-DD"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          style="width: 240px"
        />
      </el-form-item>
    </template>

    <el-table-column
      label="操作人"
      min-width="110"
    >
      <template #default="{ row }">
        {{ row.username ?? '-' }}
      </template>
    </el-table-column>
    <el-table-column
      label="模块"
      min-width="110"
    >
      <template #default="{ row }">
        {{ row.module ?? '-' }}
      </template>
    </el-table-column>
    <el-table-column
      label="操作"
      min-width="110"
    >
      <template #default="{ row }">
        {{ row.action ?? '-' }}
      </template>
    </el-table-column>
    <el-table-column
      label="请求方式"
      width="100"
      align="center"
    >
      <template #default="{ row }">
        <el-tag
          v-if="row.method"
          :type="methodTagType(row.method)"
          size="small"
        >
          {{ row.method }}
        </el-tag>
        <span v-else>-</span>
      </template>
    </el-table-column>
    <el-table-column
      label="请求地址"
      min-width="200"
      show-overflow-tooltip
    >
      <template #default="{ row }">
        {{ row.url ?? '-' }}
      </template>
    </el-table-column>
    <el-table-column
      label="IP"
      min-width="130"
    >
      <template #default="{ row }">
        {{ row.ip ?? '-' }}
      </template>
    </el-table-column>
    <el-table-column
      label="状态"
      width="90"
      align="center"
    >
      <template #default="{ row }">
        <el-tag :type="row.status === 1 ? 'success' : 'danger'">
          {{ row.status === 1 ? '成功' : '失败' }}
        </el-tag>
      </template>
    </el-table-column>
    <el-table-column
      label="耗时"
      width="100"
      align="right"
    >
      <template #default="{ row }">
        {{ row.duration != null ? `${row.duration} ms` : '-' }}
      </template>
    </el-table-column>
    <el-table-column
      label="错误信息"
      min-width="160"
      show-overflow-tooltip
    >
      <template #default="{ row }">
        {{ row.errorMsg ?? '-' }}
      </template>
    </el-table-column>
    <el-table-column
      label="操作时间"
      width="180"
    >
      <template #default="{ row }">
        {{ formatTime(row.createdAt) }}
      </template>
    </el-table-column>
  </ProTable>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import dayjs from 'dayjs'
import { getOperationLogPage } from '@/api/system/log'
import type { OperationLogQuery } from '@/api/system/log'
import ProTable from '@/components/ProTable/index.vue'
import { useTable } from '@/hooks/useTable'
import type { OperationLogItem } from '@/types/api'

// 列表（三态 + 分页由 useTable/ProTable 驱动）
const {
  list,
  total,
  pageNo,
  pageSize,
  loading,
  loadError,
  query,
  load,
  search,
  reset,
  handlePageChange,
  handleSizeChange,
} = useTable<OperationLogItem, OperationLogQuery>({
  fetchApi: getOperationLogPage,
  query: { username: undefined, module: undefined, status: undefined, startTime: undefined, endTime: undefined },
})

// 时间范围（daterange 与 startTime/endTime 分离，查询时转 ISO）
const dateRange = ref<[string, string] | []>([])

function handleSearch() {
  query.startTime = dateRange.value[0] ? dayjs(dateRange.value[0]).startOf('day').toISOString() : undefined
  query.endTime = dateRange.value[1] ? dayjs(dateRange.value[1]).endOf('day').toISOString() : undefined
  search()
}

function handleReset() {
  dateRange.value = []
  reset()
}

function formatTime(t: string) {
  return dayjs(t).format('YYYY-MM-DD HH:mm:ss')
}

function methodTagType(method: string) {
  const map: Record<string, 'success' | 'primary' | 'warning' | 'danger' | 'info'> = {
    GET: 'success',
    POST: 'primary',
    PUT: 'warning',
    DELETE: 'danger',
  }
  return map[method.toUpperCase()] ?? 'info'
}
</script>
