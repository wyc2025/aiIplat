<template>
  <div class="v-provider">
    <!-- 左：厂商列表 -->
    <div class="v-left-panel">
      <ProTable
        :data="providerList"
        :loading="providerLoading"
        :load-error="providerLoadError"
        :total="providerTotal"
        :page-no="providerPageNo"
        :page-size="providerPageSize"
        highlight-current-row
        @search="providerSearch"
        @reset="providerReset"
        @retry="providerLoad"
        @page-change="handleProviderPageChange"
        @size-change="handleProviderSizeChange"
        @current-change="handleProviderChange"
      >
        <template #toolbar>
          <el-button
            v-permission="'ai:provider:create'"
            type="primary"
            :icon="Plus"
            @click="openProviderCreate"
          >
            新增厂商
          </el-button>
        </template>

        <el-table-column
          prop="name"
          label="厂商名称"
          min-width="110"
          show-overflow-tooltip
        />
        <el-table-column
          prop="code"
          label="标识"
          min-width="90"
          show-overflow-tooltip
        />
        <el-table-column
          label="状态"
          width="70"
          align="center"
        >
          <template #default="{ row }">
            <el-tag
              :type="row.status === 1 ? 'success' : 'info'"
              size="small"
            >
              {{ row.status === 1 ? '启用' : '禁用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column
          label="操作"
          width="110"
          fixed="right"
        >
          <template #default="{ row }">
            <el-button
              v-permission="'ai:provider:update'"
              link
              type="primary"
              @click.stop="openProviderEdit(row)"
            >
              编辑
            </el-button>
            <el-button
              v-permission="'ai:provider:delete'"
              link
              type="danger"
              @click.stop="handleProviderDelete(row)"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
      </ProTable>
    </div>

    <!-- 右：模型表格 -->
    <div class="v-right-panel">
      <template v-if="currentProvider">
        <ProTable
          :data="modelList"
          :loading="modelLoading"
          :load-error="modelLoadError"
          :pagination="false"
          @retry="loadModels"
        >
          <template #toolbar>
            <el-button
              v-permission="'ai:model:create'"
              type="primary"
              :icon="Plus"
              @click="openModelCreate"
            >
              新增模型
            </el-button>
            <span class="v-current-provider">当前厂商：{{ currentProvider.name }}（{{ currentProvider.code }}）</span>
          </template>

          <el-table-column
            prop="displayName"
            label="显示名"
            min-width="130"
            show-overflow-tooltip
          />
          <el-table-column
            prop="model"
            label="API 模型名"
            min-width="150"
            show-overflow-tooltip
          />
          <el-table-column
            prop="inputPrice"
            label="输入单价"
            width="90"
            align="right"
          />
          <el-table-column
            prop="outputPrice"
            label="输出单价"
            width="90"
            align="right"
          />
          <el-table-column
            prop="maxContext"
            label="上下文"
            width="90"
            align="right"
          />
          <el-table-column
            label="工具调用"
            width="80"
            align="center"
          >
            <template #default="{ row }">
              <el-tag
                :type="row.supportTool === 1 ? 'success' : 'info'"
                size="small"
              >
                {{ row.supportTool === 1 ? '支持' : '不支持' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column
            label="状态"
            width="70"
            align="center"
          >
            <template #default="{ row }">
              <el-tag
                :type="row.status === 1 ? 'success' : 'info'"
                size="small"
              >
                {{ row.status === 1 ? '启用' : '禁用' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column
            label="操作"
            width="110"
            fixed="right"
          >
            <template #default="{ row }">
              <el-button
                v-permission="'ai:model:update'"
                link
                type="primary"
                @click.stop="openModelEdit(row)"
              >
                编辑
              </el-button>
              <el-button
                v-permission="'ai:model:delete'"
                link
                type="danger"
                @click.stop="handleModelDelete(row)"
              >
                删除
              </el-button>
            </template>
          </el-table-column>
        </ProTable>
      </template>
      <div
        v-else
        class="v-model-empty"
      >
        <el-empty description="请先选择左侧厂商" />
      </div>
    </div>

    <!-- 厂商新增/编辑弹窗 -->
    <FormDialog
      v-model="providerDialogVisible"
      :title="providerIsEdit ? '编辑厂商' : '新增厂商'"
      :form="providerForm"
      :rules="providerRules"
      :submitting="providerSubmitting"
      label-width="110px"
      @submit="handleProviderSubmit"
    >
      <el-form-item
        label="厂商名称"
        prop="name"
      >
        <el-input
          v-model="providerForm.name"
          placeholder="如 DeepSeek"
        />
      </el-form-item>
      <el-form-item
        label="标识"
        prop="code"
      >
        <el-input
          v-model="providerForm.code"
          :disabled="providerIsEdit"
          placeholder="小写字母/数字，如 deepseek"
        />
      </el-form-item>
      <el-form-item
        label="Base URL"
        prop="baseUrl"
      >
        <el-input
          v-model="providerForm.baseUrl"
          placeholder="OpenAI 兼容端点，如 https://api.deepseek.com/v1"
        />
      </el-form-item>
      <el-form-item
        label="API Key"
        :prop="providerIsEdit ? '' : 'apiKey'"
      >
        <el-input
          v-model="providerForm.apiKey"
          type="password"
          show-password
          :placeholder="providerIsEdit ? currentProvider?.apiKeyMasked || '留空表示不修改' : '请输入 API Key'"
        />
      </el-form-item>
      <el-form-item label="状态">
        <el-radio-group v-model="providerForm.status">
          <el-radio :value="1">
            启用
          </el-radio>
          <el-radio :value="0">
            禁用
          </el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="排序">
        <el-input-number
          v-model="providerForm.sort"
          :min="0"
        />
      </el-form-item>
      <el-form-item label="备注">
        <el-input
          v-model="providerForm.remark"
          placeholder="备注（选填）"
        />
      </el-form-item>
    </FormDialog>

    <!-- 模型新增/编辑弹窗 -->
    <FormDialog
      v-model="modelDialogVisible"
      :title="modelIsEdit ? '编辑模型' : '新增模型'"
      :form="modelForm"
      :rules="modelRules"
      :submitting="modelSubmitting"
      label-width="110px"
      @submit="handleModelSubmit"
    >
      <el-form-item
        label="显示名"
        prop="displayName"
      >
        <el-input
          v-model="modelForm.displayName"
          placeholder="如 DeepSeek Chat"
        />
      </el-form-item>
      <el-form-item
        label="API 模型名"
        prop="model"
      >
        <el-input
          v-model="modelForm.model"
          :disabled="modelIsEdit"
          placeholder="如 deepseek-chat"
        />
      </el-form-item>
      <el-form-item
        label="输入单价"
        prop="inputPrice"
      >
        <el-input-number
          v-model="modelForm.inputPrice"
          :min="0"
          :precision="4"
          placeholder="积分/千 tokens"
        />
      </el-form-item>
      <el-form-item
        label="输出单价"
        prop="outputPrice"
      >
        <el-input-number
          v-model="modelForm.outputPrice"
          :min="0"
          :precision="4"
        />
      </el-form-item>
      <el-form-item
        label="上下文长度"
        prop="maxContext"
      >
        <el-input-number
          v-model="modelForm.maxContext"
          :min="1"
          placeholder="tokens"
        />
      </el-form-item>
      <el-form-item label="工具调用">
        <el-radio-group v-model="modelForm.supportTool">
          <el-radio :value="1">
            支持
          </el-radio>
          <el-radio :value="0">
            不支持
          </el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="状态">
        <el-radio-group v-model="modelForm.status">
          <el-radio :value="1">
            启用
          </el-radio>
          <el-radio :value="0">
            禁用
          </el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="排序">
        <el-input-number
          v-model="modelForm.sort"
          :min="0"
        />
      </el-form-item>
    </FormDialog>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import ProTable from '@/components/ProTable/index.vue'
import FormDialog from '@/components/FormDialog/index.vue'
import {
  createModel,
  createProvider,
  deleteModel,
  deleteProvider,
  getModelList,
  getProviderPage,
  updateModel,
  updateProvider,
  type ModelItem,
  type ProviderItem,
} from '@/api/ai/provider'
import { useTable } from '@/hooks/useTable'

// ========== 厂商（左） ==========
const {
  loading: providerLoading,
  list: providerList,
  total: providerTotal,
  pageNo: providerPageNo,
  pageSize: providerPageSize,
  loadError: providerLoadError,
  load: providerLoad,
  search: providerSearch,
  reset: providerReset,
  handlePageChange: handleProviderPageChange,
  handleSizeChange: handleProviderSizeChange,
} = useTable<ProviderItem>({ fetchApi: getProviderPage })

const currentProvider = ref<ProviderItem | null>(null)

// ========== 模型（右） ==========
const modelList = ref<ModelItem[]>([])
const modelLoading = ref(false)
const modelLoadError = ref(false)

async function handleProviderChange(row: ProviderItem | null) {
  currentProvider.value = row
  if (row) {
    await loadModels()
  } else {
    modelList.value = []
  }
}

async function loadModels() {
  if (!currentProvider.value) return
  modelLoading.value = true
  modelLoadError.value = false
  try {
    modelList.value = await getModelList(Number(currentProvider.value.id))
  } catch {
    modelList.value = []
    modelLoadError.value = true
  } finally {
    modelLoading.value = false
  }
}

// ========== 厂商弹窗 ==========
const providerDialogVisible = ref(false)
const providerIsEdit = ref(false)
const providerSubmitting = ref(false)
const providerForm = reactive({
  id: '',
  name: '',
  code: '',
  baseUrl: '',
  apiKey: '',
  status: 1,
  sort: 0,
  remark: '',
})
const providerRules = {
  name: [{ required: true, message: '请输入厂商名称', trigger: 'blur' }],
  code: [
    { required: true, message: '请输入厂商标识', trigger: 'blur' },
    { pattern: /^[a-z0-9_-]+$/, message: '仅支持小写字母、数字、下划线、中划线', trigger: 'blur' },
  ],
  baseUrl: [{ required: true, message: '请输入 Base URL', trigger: 'blur' }],
  apiKey: [{ required: true, message: '请输入 API Key', trigger: 'blur' }],
}

function openProviderCreate() {
  providerIsEdit.value = false
  Object.assign(providerForm, { id: '', name: '', code: '', baseUrl: '', apiKey: '', status: 1, sort: 0, remark: '' })
  providerDialogVisible.value = true
}

function openProviderEdit(row: ProviderItem) {
  providerIsEdit.value = true
  Object.assign(providerForm, {
    id: row.id,
    name: row.name,
    code: row.code,
    baseUrl: row.baseUrl,
    apiKey: '',
    status: row.status,
    sort: row.sort,
    remark: row.remark ?? '',
  })
  providerDialogVisible.value = true
}

async function handleProviderSubmit() {
  providerSubmitting.value = true
  try {
    if (providerIsEdit.value) {
      await updateProvider(providerForm.id, {
        name: providerForm.name,
        baseUrl: providerForm.baseUrl,
        ...(providerForm.apiKey ? { apiKey: providerForm.apiKey } : {}),
        status: providerForm.status,
        sort: providerForm.sort,
        remark: providerForm.remark,
      })
      ElMessage.success('编辑成功')
    } else {
      await createProvider({
        name: providerForm.name,
        code: providerForm.code,
        baseUrl: providerForm.baseUrl,
        apiKey: providerForm.apiKey,
        status: providerForm.status,
        sort: providerForm.sort,
        remark: providerForm.remark,
      })
      ElMessage.success('新增成功')
    }
    providerDialogVisible.value = false
    providerLoad()
  } finally {
    providerSubmitting.value = false
  }
}

async function handleProviderDelete(row: ProviderItem) {
  await ElMessageBox.confirm(`确认删除厂商「${row.name}」吗？其下模型将一并无法使用。`, '提示', { type: 'warning' })
  await deleteProvider(row.id)
  ElMessage.success('删除成功')
  if (currentProvider.value?.id === row.id) {
    currentProvider.value = null
    modelList.value = []
  }
  providerLoad()
}

// ========== 模型弹窗 ==========
const modelDialogVisible = ref(false)
const modelIsEdit = ref(false)
const modelSubmitting = ref(false)
const modelForm = reactive({
  id: '',
  displayName: '',
  model: '',
  inputPrice: 0,
  outputPrice: 0,
  maxContext: 8192,
  supportTool: 0,
  status: 1,
  sort: 0,
})
const modelRules = {
  displayName: [{ required: true, message: '请输入显示名', trigger: 'blur' }],
  model: [{ required: true, message: '请输入 API 模型名', trigger: 'blur' }],
  inputPrice: [{ required: true, message: '请输入输入单价', trigger: 'blur' }],
  outputPrice: [{ required: true, message: '请输入输出单价', trigger: 'blur' }],
  maxContext: [{ required: true, message: '请输入上下文长度', trigger: 'blur' }],
}

function openModelCreate() {
  modelIsEdit.value = false
  Object.assign(modelForm, { id: '', displayName: '', model: '', inputPrice: 0, outputPrice: 0, maxContext: 8192, supportTool: 0, status: 1, sort: 0 })
  modelDialogVisible.value = true
}

function openModelEdit(row: ModelItem) {
  modelIsEdit.value = true
  Object.assign(modelForm, {
    id: row.id,
    displayName: row.displayName,
    model: row.model,
    inputPrice: Number(row.inputPrice),
    outputPrice: Number(row.outputPrice),
    maxContext: row.maxContext,
    supportTool: row.supportTool,
    status: row.status,
    sort: row.sort,
  })
  modelDialogVisible.value = true
}

async function handleModelSubmit() {
  if (!currentProvider.value) return
  modelSubmitting.value = true
  try {
    if (modelIsEdit.value) {
      await updateModel(modelForm.id, {
        displayName: modelForm.displayName,
        inputPrice: modelForm.inputPrice,
        outputPrice: modelForm.outputPrice,
        maxContext: modelForm.maxContext,
        supportTool: modelForm.supportTool,
        status: modelForm.status,
        sort: modelForm.sort,
      })
      ElMessage.success('编辑成功')
    } else {
      await createModel({
        providerId: Number(currentProvider.value.id),
        displayName: modelForm.displayName,
        model: modelForm.model,
        inputPrice: modelForm.inputPrice,
        outputPrice: modelForm.outputPrice,
        maxContext: modelForm.maxContext,
        supportTool: modelForm.supportTool,
        status: modelForm.status,
        sort: modelForm.sort,
      })
      ElMessage.success('新增成功')
    }
    modelDialogVisible.value = false
    loadModels()
  } finally {
    modelSubmitting.value = false
  }
}

async function handleModelDelete(row: ModelItem) {
  await ElMessageBox.confirm(`确认删除模型「${row.displayName}」吗？`, '提示', { type: 'warning' })
  await deleteModel(row.id)
  ElMessage.success('删除成功')
  loadModels()
}
</script>

<style scoped>
.v-provider {
  display: flex;
  gap: 16px;
  height: 100%;
}
.v-left-panel {
  width: 46%;
  min-width: 0;
}
.v-right-panel {
  flex: 1;
  min-width: 0;
}
.v-current-provider {
  margin-left: 8px;
  font-size: 13px;
  color: #909399;
}
.v-model-empty {
  background: #fff;
  border-radius: 6px;
  padding: 60px 0;
}
</style>
