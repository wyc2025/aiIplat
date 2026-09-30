<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { reloadMenus } from '@/router/dynamic'
import {
  createPage,
  deletePage,
  getSchema,
  listPages,
  updatePage,
  type AppPageListItem,
} from '@/api/app'
import { confirmDialog } from '@/utils/confirm'
import PageVisualEditor from './components/PageVisualEditor.vue'
import { pageSchemaTemplate } from '../utils/schema'
import type { AppTableItem } from '@/types/api'

/**
 * 功能页编辑器（P11 T106 / R97）：
 * 页面列表 + 新建（按主表生成模板）+ 模式 JSON 编辑 + 删除；区块/字段绑定的精细调整在编辑器内完成。
 */
const route = useRoute()
const router = useRouter()
const appCode = computed(() => String(route.query.appCode ?? ''))

const loading = ref(false)
const loadError = ref(false)
const pages = ref<AppPageListItem[]>([])
const tables = ref<string[]>([])
const tableLabels = ref<Record<string, string>>({})

const dialog = reactive({
  visible: false,
  submitting: false,
  editingId: '',
  name: '',
  route: '',
  table: '',
  schemaText: '',
  /** P12 T115：编辑窗标签（可视化 / 高级模式），两模式各存各稿（R109） */
  tab: 'visual' as 'visual' | 'advanced',
  /** 打开编辑窗时库中最新版本的 JSON 快照（切换标签按它重载，杜绝双向同步歧义） */
  savedSchemaText: '',
  /** 保存失败就地提示（50004 message 含 path） */
  error: '',
})

// P14 D113/T127：display 展示页与匿名公开面整体退役——页公开开关、公开凭证与公开预览入口一并移除；
// 展示改由「展示应用 + 站点静态页」承担（应用中心 → 展示应用）。

async function load(): Promise<void> {
  if (!appCode.value) return
  loading.value = true
  loadError.value = false
  try {
    const [bundle, list] = await Promise.all([getSchema(appCode.value), listPages(appCode.value)])
    const userTables = bundle.tables.filter((table) => !table.isSystem)
    tableItems.value = userTables as unknown as AppTableItem[]
    tables.value = userTables.map((table) => table.name)
    tableLabels.value = Object.fromEntries(userTables.map((table) => [table.name, table.label]))
    lastBundlePages.value = bundle.pages.map((page) => ({
      code: page.code,
      schema: page.schema as unknown as Record<string, unknown>,
    }))
    pages.value = list
  } catch {
    pages.value = []
    loadError.value = true
  } finally {
    loading.value = false
  }
}

onMounted(load)

/** 按「主表」重填 schema 模板（P14：页面类型只剩管理页，展示页已退役） */
function applyTemplate(): void {
  const table = dialog.table
  resetModes(pageSchemaTemplate(table, tableLabels.value[table] ?? table))
  dialog.tab = 'visual'
}

function openCreate(): void {
  const firstTable = tables.value[0] ?? ''
  dialog.editingId = ''
  dialog.name = ''
  dialog.route = ''
  dialog.table = firstTable
  applyTemplate()
  dialog.visible = true
}

function openEdit(page: AppPageListItem): void {
  dialog.editingId = page.id
  dialog.name = page.name
  dialog.route = page.route
  dialog.table = ''
  const bundlePage = lastBundlePages.value.find((item) => item.code === page.code)
  resetModes(bundlePage?.schema ?? {})
  dialog.tab = 'visual'
  dialog.visible = true
}

/** 最近一次拉取的完整页面（用于编辑时回填 schema） */
const lastBundlePages = ref<Array<{ code: string; schema: Record<string, unknown> }>>([])

/** P12 T115：可视化编辑器宿主状态（用户表元数据 + 草稿种子 + 强制重挂 key） */
const tableItems = ref<AppTableItem[]>([])
const visualSeed = ref<Record<string, unknown>>({})
const visualKey = ref(0)
const visualRef = ref<InstanceType<typeof PageVisualEditor> | null>(null)

/** 以某份 schema 重置两种模式（可视化种子 + 高级 JSON + 快照） */
function resetModes(schema: Record<string, unknown>): void {
  const text = JSON.stringify(schema, null, 2)
  dialog.savedSchemaText = text
  dialog.schemaText = text
  visualSeed.value = JSON.parse(text) as Record<string, unknown>
  visualKey.value += 1
  dialog.error = ''
}

/**
 * 切换标签：两模式各存各稿、**不实时互转**，切换时以库中最新保存版本（打开时的快照）重载（R109）。
 */
function handleTabChange(): void {
  if (!dialog.savedSchemaText) return
  const snapshot = JSON.parse(dialog.savedSchemaText) as Record<string, unknown>
  if (dialog.tab === 'visual') {
    visualSeed.value = snapshot
    visualKey.value += 1
  } else {
    dialog.schemaText = dialog.savedSchemaText
  }
  dialog.error = ''
}

async function submit(): Promise<void> {
  dialog.error = ''
  let schema: Record<string, unknown>
  if (dialog.tab === 'visual') {
    const draft = visualRef.value?.getSchema()
    if (!draft) {
      ElMessage.warning('可视化编辑器未就绪，请切换标签后重试')
      return
    }
    schema = draft
  } else {
    try {
      schema = JSON.parse(dialog.schemaText) as Record<string, unknown>
    } catch {
      ElMessage.error('页面模式不是合法 JSON')
      return
    }
  }
  if (!dialog.name.trim()) {
    ElMessage.warning('页面名称必填')
    return
  }
  dialog.submitting = true
  try {
    if (dialog.editingId) {
      await updatePage(appCode.value, dialog.editingId, { name: dialog.name.trim(), schema })
      ElMessage.success('页面已更新')
    } else {
      if (!dialog.route.trim()) {
        ElMessage.warning('路由必填')
        return
      }
      await createPage(appCode.value, {
        name: dialog.name.trim(),
        route: dialog.route.trim(),
        schema,
        genBy: 'manual',
      })
      ElMessage.success('页面已创建')
    }
    dialog.visible = false
    await load()
    // 功能页即「应用中心」动态菜单项：新增后重取菜单树（已入册应用立即可见，无需 F5）
    if (!dialog.editingId) {
      await reloadMenus()
    }
  } catch (error) {
    // R113：50004 就地展示（message 形如「页面模式校验失败（路径）：原因」）
    dialog.error = error instanceof Error ? error.message : '保存失败，请稍后重试'
    if (dialog.tab === 'visual') {
      ElMessage.warning('校验未通过，请按提示调整可视化配置或切到高级模式查看')
    }
  } finally {
    dialog.submitting = false
  }
}

async function removePage(page: AppPageListItem): Promise<void> {
  if (!(await confirmDialog(`删除功能页「${page.name}」？菜单项将立即消失。`, '删除确认', { type: 'warning' }))) {
    return
  }
  await deletePage(appCode.value, page.id)
  ElMessage.success('已删除')
  await load()
  // 菜单项随之消失（不再需要「下次刷新后消失」）
  await reloadMenus()
}

function openPage(page: AppPageListItem): void {
  void router.push(`/app-center/app/${appCode.value}/p/${page.code}`)
}
</script>

<template>
  <div
    v-loading="loading"
    class="v-app-pages"
  >
    <div class="v-app-pages__header">
      <h3 class="v-app-pages__title">
        功能页 · {{ appCode }}
      </h3>
      <el-button
        type="primary"
        @click="openCreate"
      >
        新建功能页
      </el-button>
    </div>

    <el-result
      v-if="loadError"
      icon="error"
      title="加载失败"
      sub-title="应用不存在或无权访问"
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
      v-else-if="pages.length === 0 && !loading"
      description="还没有功能页"
    />

    <el-table
      v-else
      :data="pages"
      border
      stripe
    >
      <el-table-column
        prop="name"
        label="名称"
        min-width="140"
      />
      <el-table-column
        prop="code"
        label="标识"
        min-width="120"
      />
      <el-table-column
        prop="route"
        label="路由"
        min-width="120"
      />
      <el-table-column
        prop="genBy"
        label="来源"
        width="90"
      />
      <el-table-column
        label="操作"
        width="240"
        fixed="right"
      >
        <template #default="{ row }">
          <el-button
            link
            type="primary"
            @click="openPage(row as AppPageListItem)"
          >
            打开
          </el-button>
          <el-button
            link
            type="primary"
            @click="openEdit(row as AppPageListItem)"
          >
            编辑模式
          </el-button>
          <el-button
            link
            type="danger"
            @click="removePage(row as AppPageListItem)"
          >
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog
      v-model="dialog.visible"
      :title="dialog.editingId ? '编辑功能页' : '新建功能页'"
      width="880px"
    >
      <el-form label-width="90px">
        <el-form-item
          label="页面名称"
          required
        >
          <el-input v-model="dialog.name" />
        </el-form-item>
        <el-form-item
          v-if="!dialog.editingId"
          label="路由"
          required
        >
          <el-input
            v-model="dialog.route"
            placeholder="应用内相对路径，如 book"
          />
        </el-form-item>
        <el-form-item
          v-if="!dialog.editingId"
          label="主表"
        >
          <el-select
            v-model="dialog.table"
            @change="applyTemplate"
          >
            <el-option
              v-for="table in tables"
              :key="table"
              :label="table"
              :value="table"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="页面模式">
          <el-tabs
            v-model="dialog.tab"
            class="v-page-editor__tabs"
            @tab-change="handleTabChange"
          >
            <el-tab-pane
              label="可视化"
              name="visual"
            >
              <PageVisualEditor
                :key="visualKey"
                ref="visualRef"
                :app-code="appCode"
                :tables="tableItems"
                :pages="pages"
                :initial-schema="visualSeed"
              />
            </el-tab-pane>
            <el-tab-pane
              label="高级模式（JSON）"
              name="advanced"
            >
              <el-input
                v-model="dialog.schemaText"
                type="textarea"
                :rows="16"
                spellcheck="false"
              />
              <div class="v-page-editor__hint">
                两模式各存各稿：切换标签会以库中最新保存版本重载（未保存的改动不互转）
              </div>
            </el-tab-pane>
          </el-tabs>
        </el-form-item>
        <el-form-item
          v-if="dialog.error"
          label=" "
        >
          <el-alert
            :title="dialog.error"
            type="error"
            :closable="false"
            show-icon
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog.visible = false">
          取消
        </el-button>
        <el-button
          type="primary"
          :loading="dialog.submitting"
          @click="submit"
        >
          保存
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.v-app-pages__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.v-page-editor__hint {
  margin-left: 10px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.v-app-pages__title {
  margin: 0;
}
</style>
