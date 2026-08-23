<template>
  <div class="v-pro-table">
    <!-- 搜索区 -->
    <div
      v-if="$slots.search"
      class="v-search"
    >
      <el-form
        inline
        @submit.prevent
      >
        <slot name="search" />
        <el-form-item>
          <el-button
            type="primary"
            :icon="Search"
            @click="emit('search')"
          >
            查询
          </el-button>
          <el-button
            :icon="Refresh"
            @click="emit('reset')"
          >
            重置
          </el-button>
        </el-form-item>
      </el-form>
    </div>

    <!-- 工具栏（新增等操作按钮） -->
    <div
      v-if="$slots.toolbar"
      class="v-toolbar"
    >
      <slot name="toolbar" />
    </div>

    <!-- 表格：三态 -->
    <div class="v-table-wrap">
      <el-table
        v-loading="loading"
        :data="data"
        v-bind="tableAttrs"
      >
        <slot />
        <template #empty>
          <el-empty
            v-if="!loadError"
            description="暂无数据"
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
                @click="emit('retry')"
              >
                重试
              </el-button>
            </template>
          </el-result>
        </template>
      </el-table>
    </div>

    <!-- 分页 -->
    <div
      v-if="pagination"
      class="v-pagination"
    >
      <el-pagination
        :current-page="pageNo"
        :page-size="pageSize"
        :total="total"
        :page-sizes="[10, 20, 50, 100]"
        layout="total, sizes, prev, pager, next, jumper"
        @current-change="(p: number) => emit('page-change', p)"
        @size-change="(s: number) => emit('size-change', s)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useAttrs } from 'vue'
import { Refresh, Search } from '@element-plus/icons-vue'

interface Props {
  data: unknown[]
  loading?: boolean
  loadError?: boolean
  total?: number
  pageNo?: number
  pageSize?: number
  /** 是否显示分页（树形表格传 false） */
  pagination?: boolean
}

withDefaults(defineProps<Props>(), {
  loading: false,
  loadError: false,
  total: 0,
  pageNo: 1,
  pageSize: 10,
  pagination: true,
})

const emit = defineEmits<{
  (e: 'search'): void
  (e: 'reset'): void
  (e: 'retry'): void
  (e: 'page-change', page: number): void
  (e: 'size-change', size: number): void
}>()

// 透传 el-table 属性（如 row-key、tree-props、border 等）
const tableAttrs = useAttrs()
</script>

<style scoped>
.v-pro-table {
  background: #fff;
  border-radius: 6px;
  padding: 16px;
}
.v-search {
  margin-bottom: 4px;
}
.v-search :deep(.el-form-item) {
  margin-bottom: 12px;
}
.v-toolbar {
  margin-bottom: 12px;
  display: flex;
  gap: 8px;
}
.v-pagination {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
}
</style>
