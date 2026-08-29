<template>
  <div class="v-site-column">
    <ProTable
      :data="tree"
      :loading="loading"
      :load-error="loadError"
      :pagination="false"
      row-key="id"
      :tree-props="{ children: 'children' }"
      default-expand-all
      @retry="reload"
    >
      <template #toolbar>
        <el-button
          v-permission="'site:column:create'"
          type="primary"
          :icon="Plus"
          @click="openCreate(0)"
        >
          新增一级栏目
        </el-button>
      </template>
      <el-table-column
        label="栏目名称"
        min-width="260"
      >
        <template #default="{ row }">
          {{ row.name }}
        </template>
      </el-table-column>
      <el-table-column
        label="同级排序"
        width="100"
        prop="sort"
      />
      <el-table-column
        label="文章数"
        width="100"
        prop="articleCount"
      />
      <el-table-column
        label="创建时间"
        width="180"
        :formatter="(r: SiteColumnItem) => formatTime(r.createdAt)"
      />
      <el-table-column
        label="操作"
        width="220"
        fixed="right"
      >
        <template #default="{ row }">
          <el-button
            v-permission="'site:column:create'"
            link
            type="primary"
            @click="openCreate(row)"
          >
            新增子栏目
          </el-button>
          <el-button
            v-permission="'site:column:update'"
            link
            type="primary"
            @click="openEdit(row)"
          >
            编辑
          </el-button>
          <el-button
            v-permission="'site:column:delete'"
            link
            type="danger"
            @click="onRemove(row)"
          >
            删除
          </el-button>
        </template>
      </el-table-column>
      <template #empty>
        <el-empty
          v-if="!loadError"
          description="还没有栏目"
        />
      </template>
    </ProTable>

    <!-- 新增/编辑（同一弹窗） -->
    <el-dialog
      v-model="dialogVisible"
      :title="editingId ? '编辑栏目' : '新增栏目'"
      width="460px"
      :close-on-click-modal="false"
    >
      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-width="90px"
      >
        <el-form-item label="上级栏目">
          <el-select
            v-model="form.parentId"
            style="width: 100%"
            :disabled="editingId !== 0"
          >
            <el-option
              label="（一级栏目）"
              :value="0"
            />
            <el-option
              v-for="opt in parentOptions"
              :key="opt.id"
              :label="opt.label"
              :value="opt.id"
              :disabled="opt.disabled"
            />
          </el-select>
        </el-form-item>
        <el-form-item
          label="栏目名称"
          prop="name"
        >
          <el-input
            v-model="form.name"
            maxlength="32"
            show-word-limit
          />
        </el-form-item>
        <el-form-item label="同级排序">
          <el-input-number
            v-model="form.sort"
            :min="0"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">
          取消
        </el-button>
        <el-button
          type="primary"
          :loading="submitting"
          @click="submit"
        >
          确定
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import type { FormInstance, FormRules } from 'element-plus'
import ProTable from '@/components/ProTable/index.vue'
import { formatTime } from '@/utils/format'
import { listColumns, createColumn, updateColumn, removeColumn } from '@/api/site/site'
import type { SiteColumnItem } from '@/types/api'

const loading = ref(false)
const loadError = ref(false)
const list = ref<SiteColumnItem[]>([])

const dialogVisible = ref(false)
const submitting = ref(false)
const formRef = ref<FormInstance>()
/** 0 = 新增模式 */
const editingId = ref(0)
const form = reactive({ parentId: 0, name: '', sort: 0 })
const rules: FormRules = {
  name: [{ required: true, message: '请输入栏目名称', trigger: 'blur' }],
}

/** 平铺 → 树（≤3 级） */
const tree = computed<SiteColumnItem[]>(() => {
  const nodes = new Map<string, SiteColumnItem>()
  const roots: SiteColumnItem[] = []
  for (const c of list.value) {
    nodes.set(c.id, { ...c, children: [] })
  }
  for (const c of list.value) {
    const node = nodes.get(c.id)!
    if (c.parentId === '0' || !nodes.get(c.parentId)) roots.push(node)
    else nodes.get(c.parentId)!.children!.push(node)
  }
  return roots
})

/** 上级下拉选项（新增子栏目时限定父级层级 ≤2，保证结果 ≤3 级） */
const parentOptions = computed(() => {
  const options: Array<{ id: number; label: string; disabled: boolean }> = []
  const walk = (items: SiteColumnItem[], depth: number, prefix: string) => {
    for (const item of items) {
      const label = `${prefix}${item.name}`
      options.push({ id: Number(item.id), label, disabled: depth >= 2 })
      walk(item.children ?? [], depth + 1, `${label} / `)
    }
  }
  walk(tree.value, 1, '')
  return options
})

async function reload() {
  loading.value = true
  loadError.value = false
  try {
    list.value = await listColumns()
  } catch {
    list.value = []
    loadError.value = true
  } finally {
    loading.value = false
  }
}

function openCreate(parent?: SiteColumnItem | 0) {
  editingId.value = 0
  form.parentId = typeof parent === 'object' && parent !== null ? Number(parent.id) : 0
  form.name = ''
  form.sort = 0
  dialogVisible.value = true
}

function openEdit(row: SiteColumnItem) {
  editingId.value = Number(row.id)
  form.parentId = Number(row.parentId)
  form.name = row.name
  form.sort = row.sort
  dialogVisible.value = true
}

async function submit() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  submitting.value = true
  try {
    if (editingId.value) {
      await updateColumn(editingId.value, { name: form.name, sort: form.sort })
      ElMessage.success('已保存')
    } else {
      await createColumn({ parentId: form.parentId, name: form.name, sort: form.sort })
      ElMessage.success('已创建')
    }
    dialogVisible.value = false
    reload()
  } catch {
    // 拦截器提示（40107 超级/保护）
  } finally {
    submitting.value = false
  }
}

async function onRemove(row: SiteColumnItem) {
  await ElMessageBox.confirm(`确认删除栏目「${row.name}」？`, '提示', { type: 'warning' })
  try {
    await removeColumn(Number(row.id))
    ElMessage.success('已删除')
    reload()
  } catch {
    // 拦截器提示（40107：有子栏目/文章）
  }
}

onMounted(reload)
</script>

<style scoped>
.v-site-column {
  padding: 16px;
  background: #fff;
  border-radius: 6px;
  min-height: 100%;
}
</style>
