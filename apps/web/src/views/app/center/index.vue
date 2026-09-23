<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { confirmApp, createApp, deleteApp, listApps } from '@/api/app'
import { confirmDialog } from '@/utils/confirm'
import { formatTime } from '@/utils/format'
import type { AppDefItem } from '@/types/api'

/**
 * 应用中心 · 我的应用（P11 T106，ARCHITECTURE-P11 §6）：
 * 卡片流 + 空白创建 + 草稿确认入册 + 删除；跳结构编辑器 / 功能页编辑器 / 首个功能页。
 */
const router = useRouter()
const loading = ref(false)
const loadError = ref(false)
const list = ref<AppDefItem[]>([])
const dialogVisible = ref(false)
const submitting = ref(false)
const form = reactive<{ name: string; description: string; mode: 'blank' | 'draft' }>({
  name: '',
  description: '',
  mode: 'blank',
})
const rules = {
  name: [{ required: true, message: '请输入应用名称', trigger: 'blur' }],
}

async function load(): Promise<void> {
  loading.value = true
  loadError.value = false
  try {
    list.value = await listApps()
  } catch {
    list.value = []
    loadError.value = true
  } finally {
    loading.value = false
  }
}

onMounted(load)

function openCreate(): void {
  form.name = ''
  form.description = ''
  form.mode = 'blank'
  dialogVisible.value = true
}

async function submitCreate(): Promise<void> {
  if (!form.name.trim()) {
    ElMessage.warning('请输入应用名称')
    return
  }
  submitting.value = true
  try {
    const result = await createApp({
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      mode: form.mode,
    })
    ElMessage.success(
      result.status === 'draft' ? `草稿已创建：${result.appCode}` : `应用已创建：${result.appCode}`,
    )
    dialogVisible.value = false
    await load()
  } catch {
    // 请求层已提示
  } finally {
    submitting.value = false
  }
}

async function confirmDraft(item: AppDefItem): Promise<void> {
  if (!(await confirmDialog(`确认把「${item.name}」入册？入册后将占用一个正式应用额度。`, '确认入册'))) {
    return
  }
  await confirmApp(item.appCode)
  ElMessage.success('已入册，功能页已挂到应用中心菜单')
  await load()
}

async function removeApp(item: AppDefItem): Promise<void> {
  if (
    !(await confirmDialog(
      `删除应用「${item.name}」？表结构与数据将保留 30 天后物理清理，删除后立即不可访问。`,
      '删除确认',
      { type: 'warning' },
    ))
  ) {
    return
  }
  await deleteApp(item.appCode)
  ElMessage.success('已删除')
  await load()
}

function goSchema(item: AppDefItem): void {
  void router.push({ path: '/app-center/schema', query: { appCode: item.appCode } })
}

function goPages(item: AppDefItem): void {
  void router.push({ path: '/app-center/pages', query: { appCode: item.appCode } })
}
</script>

<template>
  <div class="v-app-center">
    <div class="v-app-center__header">
      <div>
        <h3 class="v-app-center__title">
          我的应用
        </h3>
        <p class="v-app-center__desc">
          用空白表单或 AI 对话创建数据应用，平台自动生成管理后台。
        </p>
      </div>
      <el-button
        type="primary"
        @click="openCreate"
      >
        新建应用
      </el-button>
    </div>

    <div
      v-loading="loading"
      class="v-app-center__body"
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
            @click="load"
          >
            重试
          </el-button>
        </template>
      </el-result>

      <el-empty
        v-else-if="list.length === 0 && !loading"
        description="还没有应用，先新建一个吧"
      >
        <el-button
          type="primary"
          @click="openCreate"
        >
          新建应用
        </el-button>
      </el-empty>

      <div
        v-else
        class="v-app-grid"
      >
        <el-card
          v-for="item in list"
          :key="item.appCode"
          shadow="hover"
          class="v-app-card"
        >
          <div class="v-app-card__head">
            <span class="v-app-card__name">{{ item.name }}</span>
            <el-tag
              :type="item.status === 'active' ? 'success' : 'warning'"
              size="small"
            >
              {{ item.status === 'active' ? '已入册' : '草稿' }}
            </el-tag>
          </div>
          <p class="v-app-card__desc">
            {{ item.description || '（无描述）' }}
          </p>
          <div class="v-app-card__meta">
            <span>code：{{ item.appCode }}</span>
            <span>表 {{ item.tableCount }} · 行 {{ item.rowCount }} · 页 {{ item.pageCount }}</span>
            <span>更新：{{ formatTime(item.updatedAt) }}</span>
          </div>
          <div class="v-app-card__actions">
            <el-button
              size="small"
              @click="goSchema(item)"
            >
              结构
            </el-button>
            <el-button
              size="small"
              @click="goPages(item)"
            >
              功能页
            </el-button>
            <el-button
              v-if="item.status === 'draft'"
              size="small"
              type="primary"
              @click="confirmDraft(item)"
            >
              确认入册
            </el-button>
            <el-button
              size="small"
              type="danger"
              text
              @click="removeApp(item)"
            >
              删除
            </el-button>
          </div>
        </el-card>
      </div>
    </div>

    <el-dialog
      v-model="dialogVisible"
      title="新建数据应用"
      width="480px"
    >
      <el-form
        :model="form"
        :rules="rules"
        label-width="90px"
      >
        <el-form-item
          label="应用名称"
          prop="name"
        >
          <el-input
            v-model="form.name"
            maxlength="50"
            show-word-limit
            placeholder="如：书单"
          />
        </el-form-item>
        <el-form-item label="用途描述">
          <el-input
            v-model="form.description"
            maxlength="200"
            show-word-limit
          />
        </el-form-item>
        <el-form-item label="创建方式">
          <el-radio-group v-model="form.mode">
            <el-radio value="blank">
              直接入册（占正式额度）
            </el-radio>
            <el-radio value="draft">
              存为草稿（不占额度，限 3 个）
            </el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">
          取消
        </el-button>
        <el-button
          type="primary"
          :loading="submitting"
          @click="submitCreate"
        >
          创建
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.v-app-center__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 16px;
}
.v-app-center__title {
  margin: 0 0 4px;
}
.v-app-center__desc {
  margin: 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
.v-app-center__body {
  min-height: 200px;
}
.v-app-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}
.v-app-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.v-app-card__name {
  font-weight: 600;
}
.v-app-card__desc {
  margin: 8px 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  min-height: 20px;
}
.v-app-card__meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.v-app-card__actions {
  margin-top: 12px;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
</style>
