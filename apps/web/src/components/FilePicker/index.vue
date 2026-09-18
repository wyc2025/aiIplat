<template>
  <el-dialog
    :model-value="visible"
    :title="title"
    width="680px"
    top="8vh"
    :close-on-click-modal="false"
    destroy-on-close
    @update:model-value="emit('update:visible', $event)"
  >
    <!-- 面包屑：根目录不显示（云盘虚拟根无实体行） -->
    <div class="v-fp-bar">
      <el-button
        v-if="crumbs.length"
        link
        type="primary"
        size="small"
        @click="loadDir(0)"
      >
        根目录
      </el-button>
      <el-breadcrumb separator="/">
        <el-breadcrumb-item
          v-for="(item, index) in crumbs"
          :key="item.id"
        >
          <a
            class="v-fp-crumb"
            @click="loadDir(Number(item.id))"
          >{{ item.name }}</a>
          <span v-if="index === crumbs.length - 1" />
        </el-breadcrumb-item>
      </el-breadcrumb>
      <el-button
        class="v-fp-refresh"
        :icon="Refresh"
        link
        size="small"
        @click="loadDir(dirId)"
      >
        刷新
      </el-button>
    </div>

    <div
      v-loading="loading"
      class="v-fp-list"
    >
      <el-result
        v-if="loadError"
        icon="error"
        title="加载失败"
        sub-title="请稍后重试"
      >
        <template #extra>
          <el-button
            type="primary"
            @click="loadDir(dirId)"
          >
            重试
          </el-button>
        </template>
      </el-result>
      <el-empty
        v-else-if="!items.length && !loading"
        description="这个目录是空的"
      />
      <ul
        v-else
        class="v-fp-items"
      >
        <li
          v-for="row in items"
          :key="row.id"
          class="v-fp-item"
          :class="{ active: selected?.id === row.id, disabled: !row.isDir && !isAllowed(row) }"
          @click="pick(row)"
        >
          <el-icon class="v-fp-icon">
            <Folder v-if="row.isDir" />
            <Document v-else />
          </el-icon>
          <span class="v-fp-name">{{ row.name }}</span>
          <span
            v-if="!row.isDir"
            class="v-fp-size"
          >{{ formatSize(Number(row.size)) }}</span>
          <span
            v-if="!row.isDir && !isAllowed(row)"
            class="v-fp-tip"
          >类型不支持</span>
        </li>
      </ul>
    </div>

    <p class="v-fp-hint">
      可选类型：{{ acceptExts.map((e) => '.' + e).join(' / ') }}
      <span v-if="selected"> · 已选：{{ selected.name }}</span>
    </p>

    <template #footer>
      <el-button @click="emit('update:visible', false)">
        取消
      </el-button>
      <el-button
        type="primary"
        :disabled="!selected"
        @click="confirm"
      >
        选择该文件
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Document, Folder, Refresh } from '@element-plus/icons-vue'
import { filePath, listFiles } from '@/api/cloud/file'
import { formatSize } from '@/utils/format'
import type { BreadcrumbItem, CloudFile } from '@/types/api'

/**
 * 云盘文件选择器（P8 T88 新增公共组件）：
 * 单层下钻浏览用户自己的云盘，按扩展名白名单过滤可选文件。
 * 只负责"选出一个文件"，不读内容、不落库；跨域能力（读文件内容）由调用方按自身权限走接口。
 */
const props = withDefaults(
  defineProps<{
    visible: boolean
    title?: string
    /** 可选文件扩展名（小写，不含点） */
    acceptExts: string[]
  }>(),
  { title: '从云盘选择文件' },
)

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'select', file: { id: string; name: string; ext: string; size: string }): void
}>()

const dirId = ref(0)
const items = ref<CloudFile[]>([])
const crumbs = ref<BreadcrumbItem[]>([])
const selected = ref<CloudFile | null>(null)
const loading = ref(false)
const loadError = ref(false)

/** 该文件是否在可选白名单内 */
function isAllowed(row: CloudFile): boolean {
  return props.acceptExts.includes((row.ext ?? '').toLowerCase())
}

async function loadDir(id: number): Promise<void> {
  dirId.value = id
  selected.value = null
  loading.value = true
  loadError.value = false
  try {
    const list = await listFiles(id)
    items.value = list.list
    // 根目录（0）无实体行，面包屑留空
    crumbs.value = id === 0 ? [] : await filePath(id)
  } catch {
    items.value = []
    crumbs.value = []
    loadError.value = true
  } finally {
    loading.value = false
  }
}

/** 点击行：文件夹进目录；文件按白名单选中或提示 */
function pick(row: CloudFile): void {
  if (row.isDir) {
    void loadDir(Number(row.id))
    return
  }
  if (!isAllowed(row)) {
    ElMessage.warning(`仅支持 ${props.acceptExts.map((e) => '.' + e).join(' / ')} 文件`)
    return
  }
  selected.value = row
}

function confirm(): void {
  const row = selected.value
  if (!row) return
  emit('select', { id: row.id, name: row.name, ext: row.ext ?? '', size: row.size })
  emit('update:visible', false)
}

// 每次打开都从根目录开始（避免上次的目录残留造成困惑）
watch(
  () => props.visible,
  (value) => {
    if (value) void loadDir(0)
  },
)
</script>

<style scoped>
.v-fp-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 28px;
  margin-bottom: 8px;
}
.v-fp-crumb {
  cursor: pointer;
  color: var(--el-color-primary);
}
.v-fp-refresh {
  margin-left: auto;
}
.v-fp-list {
  height: 360px;
  overflow: auto;
  border: 1px solid var(--el-border-color-light);
  border-radius: 4px;
}
.v-fp-items {
  margin: 0;
  padding: 4px 0;
  list-style: none;
}
.v-fp-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  font-size: 13px;
}
.v-fp-item:hover {
  background: var(--el-fill-color-light);
}
.v-fp-item.active {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}
.v-fp-item.disabled {
  cursor: not-allowed;
  color: var(--el-text-color-disabled);
}
.v-fp-icon {
  color: var(--el-color-warning);
}
.v-fp-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.v-fp-size,
.v-fp-tip {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.v-fp-tip {
  color: var(--el-color-danger);
}
.v-fp-hint {
  margin: 8px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
</style>
