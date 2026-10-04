<script setup lang="ts">
/**
 * 展示页「版本」对话框（P20 T167，API §28.3）。
 *
 * 定位是**存档**而非上线：把当前页面内容存成一个可回退的版本，随时恢复到工作区。
 * 与站点发布**分治**——展示页有自己的节奏，不必随站点发布；对外访问仍由站点版本决定
 * （对话框里明确写出这层关系，避免用户误以为保存版本就上线了）。
 */
import { ElMessage, ElMessageBox } from 'element-plus'
import { ref } from 'vue'
import {
  deleteDisplayRelease,
  listDisplayReleases,
  pinDisplayRelease,
  restoreDisplayRelease,
  saveDisplayRelease,
  type DisplayReleaseItem,
} from '@/api/display'

const visible = ref(false)
const loading = ref(false)
const saving = ref(false)
const acting = ref<string | null>(null)
const items = ref<DisplayReleaseItem[]>([])
const label = ref('')
const displayId = ref<string | null>(null)
const displayName = ref('')
const siteTitle = ref<string | null>(null)

async function load(): Promise<void> {
  if (!displayId.value) return
  loading.value = true
  try {
    items.value = await listDisplayReleases(displayId.value)
  } catch {
    items.value = []
  } finally {
    loading.value = false
  }
}

/** 供父组件调用：打开某个展示页的版本面板 */
async function open(id: string, name: string, site: string | null): Promise<void> {
  displayId.value = id
  displayName.value = name
  siteTitle.value = site
  label.value = ''
  visible.value = true
  await load()
}

defineExpose({ open })

async function submitSave(): Promise<void> {
  if (!displayId.value || saving.value) return
  saving.value = true
  try {
    const saved = await saveDisplayRelease(displayId.value, label.value.trim() || undefined)
    ElMessage.success(`已保存版本 ${saved.versionNo}`)
    label.value = ''
    await load()
  } catch {
    // 错误提示由请求层统一弹出（含「还没有页面文件」这类可读原因）
  } finally {
    saving.value = false
  }
}

async function submitRestore(item: DisplayReleaseItem): Promise<void> {
  if (!displayId.value) return
  try {
    await ElMessageBox.confirm(
      `页面内容将回到版本 ${item.versionNo}${item.label ? `（${item.label}）` : ''}。` +
        '现在的页面内容会先移入云盘回收站，恢复错了还能从回收站取回。',
      '恢复到这个版本？',
      { type: 'warning', confirmButtonText: '恢复', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  acting.value = item.id
  try {
    const result = await restoreDisplayRelease(displayId.value, item.id)
    ElMessage.success(
      `已恢复 ${result.restoredFiles} 个页面文件` +
        (result.removedFiles > 0 ? `，原内容 ${result.removedFiles} 个文件已移入回收站` : ''),
    )
  } catch {
    /* 统一提示 */
  } finally {
    acting.value = null
  }
}

async function togglePin(item: DisplayReleaseItem): Promise<void> {
  if (!displayId.value) return
  acting.value = item.id
  try {
    await pinDisplayRelease(displayId.value, item.id, !item.pinned)
    ElMessage.success(item.pinned ? '已解锁，可以删除了' : '已锁定，不会被误删')
    await load()
  } catch {
    /* 统一提示 */
  } finally {
    acting.value = null
  }
}

async function submitDelete(item: DisplayReleaseItem): Promise<void> {
  if (!displayId.value) return
  try {
    await ElMessageBox.confirm(
      `版本 ${item.versionNo}${item.label ? `（${item.label}）` : ''} 将被删除，且无法找回。`,
      '删除这个版本？',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  acting.value = item.id
  try {
    await deleteDisplayRelease(displayId.value, item.id)
    ElMessage.success('已删除')
    await load()
  } catch {
    /* 统一提示 */
  } finally {
    acting.value = null
  }
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatSize(bytes: string): string {
  const size = Number(bytes)
  if (!Number.isFinite(size) || size <= 0) return '0 B'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="`「${displayName}」的版本`"
    width="640px"
  >
    <div class="v-releases__hint">
      保存的版本是给**你自己**回退用的，不会直接对外生效。
      <template v-if="siteTitle">
        这个展示页挂在「{{ siteTitle }}」上，访客看到的内容由站点的发布版本决定——
        想让它对外更新，请到站点里重新发布。
      </template>
      <template v-else>
        这个展示页还没挂到站点，访客暂时访问不到。
      </template>
    </div>

    <div class="v-releases__save">
      <el-input
        v-model="label"
        placeholder="给这次保存起个名字，例如「改版前」"
        maxlength="100"
        clearable
      />
      <el-button
        type="primary"
        :loading="saving"
        @click="submitSave"
      >
        保存当前内容
      </el-button>
    </div>

    <el-table
      v-loading="loading"
      :data="items"
      size="small"
      empty-text="还没有保存过版本"
    >
      <el-table-column
        prop="versionNo"
        label="版本"
        width="70"
      >
        <template #default="{ row }">
          v{{ row.versionNo }}
        </template>
      </el-table-column>
      <el-table-column
        prop="label"
        label="备注"
        min-width="120"
        show-overflow-tooltip
      >
        <template #default="{ row }">
          <span v-if="row.label">{{ row.label }}</span>
          <span
            v-else
            class="v-releases__muted"
          >（未填）</span>
        </template>
      </el-table-column>
      <el-table-column
        label="内容"
        width="110"
      >
        <template #default="{ row }">
          {{ row.fileCount }} 个文件 · {{ formatSize(row.totalBytes) }}
        </template>
      </el-table-column>
      <el-table-column
        label="保存于"
        width="140"
      >
        <template #default="{ row }">
          {{ formatTime(row.createTime) }}
        </template>
      </el-table-column>
      <el-table-column
        label="操作"
        width="200"
      >
        <template #default="{ row }">
          <el-button
            size="small"
            type="primary"
            plain
            :loading="acting === row.id"
            @click="submitRestore(row)"
          >
            恢复到这里
          </el-button>
          <el-button
            size="small"
            link
            @click="togglePin(row)"
          >
            {{ row.pinned ? '解锁' : '锁定' }}
          </el-button>
          <el-button
            size="small"
            link
            type="danger"
            :disabled="row.pinned"
            @click="submitDelete(row)"
          >
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <template #footer>
      <el-button @click="visible = false">
        关闭
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.v-releases__hint {
  margin-bottom: 12px;
  padding: 8px 12px;
  border-radius: 4px;
  background: var(--el-fill-color-light);
  color: var(--el-text-color-regular);
  font-size: 12px;
  line-height: 1.7;
}

.v-releases__save {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.v-releases__save .el-input {
  flex: 1;
}

.v-releases__muted {
  color: var(--el-text-color-placeholder);
}
</style>
