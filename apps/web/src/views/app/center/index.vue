<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { useClipboard } from '@vueuse/core'
import {
  confirmApp,
  createApp,
  deleteApp,
  getPubConfig,
  listApps,
  publishApp,
  type PubConfig,
} from '@/api/app'
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

/** P12 T113：公开/发布弹窗（暴露三开关总览 + 发布开关 + 公开链接 + 缺项引导） */
const pubDialog = reactive<{
  visible: boolean
  appCode: string
  appName: string
  loading: boolean
  saving: boolean
  config: PubConfig | null
}>({ visible: false, appCode: '', appName: '', loading: false, saving: false, config: null })
const { copy: copyToClipboard } = useClipboard({ legacy: true })

/** 公开链接（后端返回相对路径，这里补站点域名供复制） */
function pubFullUrl(config: PubConfig | null): string {
  if (!config?.pubUrl) return ''
  return `${window.location.origin}${config.pubUrl}`
}

async function openPub(item: AppDefItem): Promise<void> {
  pubDialog.visible = true
  pubDialog.appCode = item.appCode
  pubDialog.appName = item.name
  pubDialog.config = null
  await refreshPubConfig()
}

async function refreshPubConfig(): Promise<void> {
  pubDialog.loading = true
  try {
    pubDialog.config = await getPubConfig(pubDialog.appCode)
  } catch {
    pubDialog.config = null
  } finally {
    pubDialog.loading = false
  }
}

async function togglePublish(next: number): Promise<void> {
  pubDialog.saving = true
  try {
    await publishApp(pubDialog.appCode, next)
    ElMessage.success(next === 1 ? '已发布：公开链接已生效' : '已取消公开')
    await refreshPubConfig()
    await load()
  } catch {
    // 请求层已提示（50012 的 message 内含缺项清单）
    await refreshPubConfig()
  } finally {
    pubDialog.saving = false
  }
}

async function copyPubUrl(): Promise<void> {
  const url = pubFullUrl(pubDialog.config)
  if (!url) return
  try {
    await copyToClipboard(url)
    ElMessage.success('公开链接已复制')
  } catch {
    ElMessage.error('复制失败，请手动复制')
  }
}

function openPublicPreview(): void {
  const url = pubFullUrl(pubDialog.config)
  if (url) window.open(url, '_blank')
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
              size="small"
              type="success"
              plain
              @click="openPub(item)"
            >
              公开
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

    <!-- P12 T113：公开与发布（R100/R103/R108） -->
    <el-dialog
      v-model="pubDialog.visible"
      :title="`公开设置 · ${pubDialog.appName}`"
      width="640px"
    >
      <div v-loading="pubDialog.loading">
        <el-alert
          v-if="pubDialog.config && pubDialog.config.missing.length > 0"
          type="warning"
          :closable="false"
          show-icon
          class="pub-missing"
        >
          <template #title>
            发布前还差 {{ pubDialog.config.missing.length }} 项
          </template>
          <ul class="pub-missing__list">
            <li
              v-for="(item, index) in pubDialog.config.missing.slice(0, 6)"
              :key="index"
            >
              {{ item }}
            </li>
          </ul>
        </el-alert>

        <el-form label-width="90px">
          <el-form-item label="公开发布">
            <el-switch
              :model-value="pubDialog.config?.isPublic ?? 0"
              :active-value="1"
              :inactive-value="0"
              :loading="pubDialog.saving"
              @change="(value: number | string | boolean) => togglePublish(Number(value))"
            />
            <span class="pub-hint">开启后任何拿到公开链接的人都能只读访问已暴露数据</span>
          </el-form-item>

          <el-form-item
            v-if="pubDialog.config"
            label="公开链接"
          >
            <el-input
              :model-value="pubFullUrl(pubDialog.config)"
              readonly
            >
              <template #append>
                <el-button @click="copyPubUrl">
                  复制
                </el-button>
              </template>
            </el-input>
            <el-button
              v-if="pubDialog.config.isPublic === 1"
              link
              type="primary"
              @click="openPublicPreview"
            >
              新窗口预览
            </el-button>
          </el-form-item>

          <el-form-item label="暴露表">
            <el-tag
              v-for="table in pubDialog.config?.exposedTables ?? []"
              :key="table.id"
              class="pub-tag"
              type="success"
              size="small"
            >
              {{ table.label }}（{{ table.tableCode }}）
            </el-tag>
            <span
              v-if="(pubDialog.config?.exposedTables?.length ?? 0) === 0"
              class="pub-hint"
            >
              暂无暴露表，请在「结构」编辑器里为表开启公开
            </span>
          </el-form-item>

          <el-form-item label="公开展示页">
            <el-tag
              v-for="page in pubDialog.config?.publicPages ?? []"
              :key="page.id"
              class="pub-tag"
              :type="page.isPublic === 1 ? 'success' : 'info'"
              size="small"
            >
              {{ page.name }}{{ page.isPublic === 1 ? '' : '（未公开）' }}
            </el-tag>
            <span
              v-if="(pubDialog.config?.publicPages?.length ?? 0) === 0"
              class="pub-hint"
            >
              暂无展示页，请在「功能页」编辑器里新建 display 类型页面
            </span>
          </el-form-item>
        </el-form>
      </div>

      <template #footer>
        <el-button @click="pubDialog.visible = false">
          关闭
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
.pub-missing {
  margin-bottom: 12px;
}
.pub-missing__list {
  margin: 4px 0 0;
  padding-left: 18px;
  font-size: 12px;
}
.pub-hint {
  margin-left: 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.pub-tag {
  margin: 0 6px 6px 0;
}
</style>
