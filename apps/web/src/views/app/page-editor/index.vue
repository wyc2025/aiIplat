<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  createPage,
  deletePage,
  getApp,
  getPubConfig,
  getSchema,
  listPages,
  publishPage,
  updatePage,
  type AppPageListItem,
} from '@/api/app'
import { confirmDialog } from '@/utils/confirm'
import { displayPageSchemaTemplate, pageSchemaTemplate } from '../utils/schema'

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
  /** 页面类型：admin 管理页 / display 公开展示页（P12 T113；落库类型由 schema.kind 决定） */
  kind: 'admin' as 'admin' | 'display',
  schemaText: '',
})

/** P12 T113：公开状态（pageId → isPublic）与公开凭证（预览新窗口用） */
const pubPages = ref<Map<string, number>>(new Map())
const pubCode = ref('')

async function loadPubInfo(): Promise<void> {
  if (!appCode.value) return
  try {
    const [config, app] = await Promise.all([getPubConfig(appCode.value), getApp(appCode.value)])
    pubPages.value = new Map(config.publicPages.map((page) => [page.id, page.isPublic]))
    pubCode.value = app.pubCode
  } catch {
    pubPages.value = new Map()
  }
}

/** 展示页公开开关（R108；admin 页不可公开 → 列表对 admin 行不渲染开关） */
async function togglePagePublic(page: AppPageListItem, value: number): Promise<void> {
  try {
    await publishPage(appCode.value, page.id, value)
    ElMessage.success(value === 1 ? '该展示页已公开' : '已取消公开')
  } catch {
    // 请求层已提示
  } finally {
    await loadPubInfo()
  }
}

/** 公开预览（新窗口）：需应用已发布，否则公开端 40400 */
function previewPublic(page: AppPageListItem): void {
  if (!pubCode.value) {
    ElMessage.warning('未取到公开凭证，请稍后重试')
    return
  }
  window.open(`${window.location.origin}/pub/app/${pubCode.value}/p/${page.code}`, '_blank')
}

async function load(): Promise<void> {
  if (!appCode.value) return
  loading.value = true
  loadError.value = false
  try {
    const [bundle, list] = await Promise.all([getSchema(appCode.value), listPages(appCode.value)])
    const userTables = bundle.tables.filter((table) => !table.isSystem)
    tables.value = userTables.map((table) => table.name)
    tableLabels.value = Object.fromEntries(userTables.map((table) => [table.name, table.label]))
    lastBundlePages.value = bundle.pages.map((page) => ({
      code: page.code,
      schema: page.schema as unknown as Record<string, unknown>,
    }))
    pages.value = list
    await loadPubInfo()
  } catch {
    pages.value = []
    loadError.value = true
  } finally {
    loading.value = false
  }
}

onMounted(load)

/** 按当前「页面类型 + 主表」重填 schema 模板（admin = 可写管理页 / display = 只读展示页） */
function applyTemplate(): void {
  const table = dialog.table
  dialog.schemaText = JSON.stringify(
    dialog.kind === 'display'
      ? displayPageSchemaTemplate(table)
      : pageSchemaTemplate(table, tableLabels.value[table] ?? table),
    null,
    2,
  )
}

function openCreate(): void {
  const firstTable = tables.value[0] ?? ''
  dialog.editingId = ''
  dialog.name = ''
  dialog.route = ''
  dialog.kind = 'admin'
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
  dialog.schemaText = JSON.stringify(bundlePage?.schema ?? {}, null, 2)
  dialog.visible = true
}

/** 最近一次拉取的完整页面（用于编辑时回填 schema） */
const lastBundlePages = ref<Array<{ code: string; schema: Record<string, unknown> }>>([])

async function submit(): Promise<void> {
  let schema: Record<string, unknown>
  try {
    schema = JSON.parse(dialog.schemaText) as Record<string, unknown>
  } catch {
    ElMessage.error('页面模式不是合法 JSON')
    return
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
  } finally {
    dialog.submitting = false
  }
}

async function removePage(page: AppPageListItem): Promise<void> {
  if (!(await confirmDialog(`删除功能页「${page.name}」？菜单将在下次刷新后消失。`, '删除确认', { type: 'warning' }))) {
    return
  }
  await deletePage(appCode.value, page.id)
  ElMessage.success('已删除')
  await load()
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
        label="类型"
        width="90"
      >
        <template #default="{ row }">
          <el-tag
            size="small"
            :type="row.kind === 'display' ? 'success' : 'info'"
          >
            {{ row.kind === 'display' ? '展示页' : '管理页' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column
        label="公开"
        width="80"
      >
        <template #default="{ row }">
          <el-switch
            v-if="row.kind === 'display'"
            :model-value="pubPages.get(row.id) ?? 0"
            :active-value="1"
            :inactive-value="0"
            size="small"
            @change="(value: number | string | boolean) => togglePagePublic(row as AppPageListItem, Number(value))"
          />
          <span v-else>—</span>
        </template>
      </el-table-column>
      <el-table-column
        label="操作"
        width="300"
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
            v-if="row.kind === 'display'"
            link
            type="success"
            @click="previewPublic(row as AppPageListItem)"
          >
            预览
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
      width="720px"
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
          label="页面类型"
        >
          <el-radio-group
            v-model="dialog.kind"
            @change="applyTemplate"
          >
            <el-radio-button value="admin">
              管理页
            </el-radio-button>
            <el-radio-button value="display">
              展示页（公开只读）
            </el-radio-button>
          </el-radio-group>
          <span class="v-page-editor__hint">展示页无表单/动作，用于公开只读浏览（P12）</span>
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
          <el-input
            v-model="dialog.schemaText"
            type="textarea"
            :rows="16"
            spellcheck="false"
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
