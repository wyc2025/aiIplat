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
      <el-form-item label="用户名">
        <el-input
          v-model="query.username"
          placeholder="请输入用户名"
          clearable
          style="width: 180px"
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
      <el-form-item label="登录时间">
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
      prop="username"
      label="用户名"
      min-width="120"
    />
    <el-table-column
      label="IP"
      min-width="130"
    >
      <template #default="{ row }">
        {{ row.ip ?? '-' }}
      </template>
    </el-table-column>
    <el-table-column
      label="浏览器"
      min-width="120"
      show-overflow-tooltip
    >
      <template #default="{ row }">
        {{ row.browser ?? '-' }}
      </template>
    </el-table-column>
    <el-table-column
      label="操作系统"
      min-width="120"
      show-overflow-tooltip
    >
      <template #default="{ row }">
        {{ row.os ?? '-' }}
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
      label="提示信息"
      min-width="160"
      show-overflow-tooltip
    >
      <template #default="{ row }">
        {{ row.message ?? '-' }}
      </template>
    </el-table-column>
    <el-table-column
      label="登录时间"
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
import { getLoginLogPage } from '@/api/system/log'
import type { LoginLogQuery } from '@/api/system/log'
import ProTable from '@/components/ProTable/index.vue'
import { useTable } from '@/hooks/useTable'
import type { LoginLogItem } from '@/types/api'

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
} = useTable<LoginLogItem, LoginLogQuery>({
  fetchApi: getLoginLogPage,
  query: { username: undefined, status: undefined, startTime: undefined, endTime: undefined },
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
</script>
