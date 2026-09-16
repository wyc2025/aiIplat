<template>
  <div class="v-site-tag">
    <SiteSwitcher />
    <ProTable
      :data="list"
      :loading="loading"
      :load-error="loadError"
      :pagination="false"
      @retry="reload"
    >
      <template #toolbar>
        <el-button
          v-permission="'site:tag:create'"
          type="primary"
          :icon="Plus"
          @click="openCreate"
        >
          新增标签
        </el-button>
      </template>
      <el-table-column
        label="标签名称"
        min-width="200"
        prop="name"
      />
      <el-table-column
        label="文章数"
        width="100"
        prop="articleCount"
      />
      <el-table-column
        label="创建时间"
        width="180"
        :formatter="(r: SiteTagItem) => formatTime(r.createdAt)"
      />
      <el-table-column
        label="操作"
        width="160"
        fixed="right"
      >
        <template #default="{ row }">
          <el-button
            v-permission="'site:tag:update'"
            link
            type="primary"
            @click="openEdit(row)"
          >
            编辑
          </el-button>
          <el-button
            v-permission="'site:tag:delete'"
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
          :description="emptyText"
        />
      </template>
    </ProTable>

    <el-dialog
      v-model="dialogVisible"
      :title="editingId ? '编辑标签' : '新增标签'"
      width="420px"
      :close-on-click-modal="false"
    >
      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
      >
        <el-form-item
          label="标签名称"
          prop="name"
        >
          <el-input
            v-model="form.name"
            maxlength="32"
            show-word-limit
            @keyup.enter="submit"
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
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { confirmDialog } from '@/utils/confirm'
import { Plus } from '@element-plus/icons-vue'
import type { FormInstance, FormRules } from 'element-plus'
import ProTable from '@/components/ProTable/index.vue'
import SiteSwitcher from '@/components/SiteSwitcher/index.vue'
import { formatTime } from '@/utils/format'
import { listTags, createTag, updateTag, removeTag } from '@/api/site/site'
import { useSiteStore } from '@/stores/site'
import type { SiteTagItem } from '@/types/api'

const siteStore = useSiteStore()
const loading = ref(false)
const loadError = ref(false)
const list = ref<SiteTagItem[]>([])
/** 无站点时的空态文案（P4E：站点为 0 时不做接口请求） */
const emptyText = computed(() => (siteStore.empty ? '还没有站点，请先到「站点列表」创建' : '还没有标签'))

const dialogVisible = ref(false)
const submitting = ref(false)
const formRef = ref<FormInstance>()
const editingId = ref(0)
const form = reactive({ name: '' })
const rules: FormRules = {
  name: [{ required: true, message: '请输入标签名称', trigger: 'blur' }],
}

async function reload() {
  loadError.value = false
  if (!siteStore.currentSiteId) {
    list.value = []
    return
  }
  loading.value = true
  try {
    list.value = await listTags(siteStore.currentSiteId)
  } catch {
    list.value = []
    loadError.value = true
  } finally {
    loading.value = false
  }
}

function openCreate() {
  editingId.value = 0
  form.name = ''
  dialogVisible.value = true
}

function openEdit(row: SiteTagItem) {
  editingId.value = Number(row.id)
  form.name = row.name
  dialogVisible.value = true
}

async function submit() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  submitting.value = true
  try {
    if (editingId.value) {
      await updateTag(editingId.value, form.name)
      ElMessage.success('已保存')
    } else {
      await createTag(Number(siteStore.currentSiteId), form.name)
      ElMessage.success('已创建')
    }
    dialogVisible.value = false
    reload()
  } catch {
    // 拦截器提示（40108 重名）
  } finally {
    submitting.value = false
  }
}

async function onRemove(row: SiteTagItem) {
  const confirmed = await confirmDialog(`确认删除标签「${row.name}」？文章上的该标签将同步移除`, '提示', {
    type: 'warning',
  })
  if (!confirmed) return
  try {
    await removeTag(Number(row.id))
    ElMessage.success('已删除')
    reload()
  } catch {
    // 拦截器提示
  }
}

onMounted(async () => {
  await siteStore.ensureLoaded().catch(() => undefined)
  reload()
})

// 切换当前站点 → 重新拉取本页数据（P4E D54）
watch(
  () => siteStore.currentSiteId,
  () => reload(),
)
</script>

<style scoped>
.v-site-tag {
  padding: 16px;
  background: #fff;
  border-radius: 6px;
  min-height: 100%;
}
</style>
