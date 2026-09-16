<template>
  <div class="v-site-setting">
    <SiteSwitcher />
    <div
      v-loading="store.loading"
      class="v-ss-body"
    >
      <!-- 加载失败 -->
      <el-result
        v-if="loadError"
        icon="error"
        title="加载失败"
        sub-title="请稍后重试"
      >
        <template #extra>
          <el-button
            type="primary"
            @click="reload"
          >
            重试
          </el-button>
        </template>
      </el-result>

      <!-- 无站点：引导到站点列表创建（P4E：创建入口统一在站点列表页） -->
      <el-empty
        v-else-if="store.empty"
        description="还没有站点"
      >
        <el-button
          v-permission="'site:site:manage'"
          type="primary"
          @click="goSiteList"
        >
          去创建站点
        </el-button>
      </el-empty>

      <!-- 有当前站点：站点信息 + 编辑 + 模板库 -->
      <template v-else-if="site">
        <el-descriptions
          :column="1"
          border
          style="max-width: 640px"
        >
          <el-descriptions-item label="站点状态">
            <el-tag
              :type="site.status === 1 ? 'success' : 'info'"
              size="small"
            >
              {{ site.status === 1 ? '启用中' : '已停用' }}
            </el-tag>
            <el-button
              v-permission="'site:site:manage'"
              link
              :type="site.status === 1 ? 'danger' : 'primary'"
              style="margin-left: 12px"
              @click="toggleStatus"
            >
              {{ site.status === 1 ? '停用站点' : '启用站点' }}
            </el-button>
          </el-descriptions-item>
          <el-descriptions-item label="站点地址">
            <el-link
              type="primary"
              :href="siteUrl"
              target="_blank"
            >
              {{ site.siteUrl }}
            </el-link>
          </el-descriptions-item>
          <el-descriptions-item label="站点标识（slug）">
            {{ site.slug }}
          </el-descriptions-item>
          <el-descriptions-item label="站点标题">
            {{ site.title }}
          </el-descriptions-item>
          <el-descriptions-item label="站点描述">
            {{ site.description || '-' }}
          </el-descriptions-item>
          <el-descriptions-item label="评论审核">
            <el-switch
              v-permission="'site:site:manage'"
              :model-value="site.commentAudit === 1"
              @change="toggleCommentAudit"
            />
            <span class="v-ss-tip">开：访客评论需审核后展示；关：直接展示</span>
          </el-descriptions-item>
          <el-descriptions-item label="创建时间">
            {{ formatTime(site.createdAt) }}
          </el-descriptions-item>
        </el-descriptions>

        <el-button
          v-permission="'site:site:manage'"
          type="primary"
          style="margin-top: 20px"
          @click="openEdit"
        >
          编辑站点信息
        </el-button>

        <!-- 模板库（P4b T44） -->
        <div class="v-ss-templates">
          <h3 class="v-ss-templates-title">
            模板库
          </h3>
          <div
            v-loading="templatesLoading"
            class="v-ss-tpl-grid"
          >
            <div
              v-for="tpl in templates"
              :key="tpl.id"
              class="v-ss-tpl-card"
              :class="{ selected: selectedTemplateId === tpl.id }"
              @click="selectedTemplateId = tpl.id"
            >
              <!-- 预览图（P6 T80/R72：缺图或加载失败降级占位，不裂图） -->
              <div class="v-ss-tpl-preview">
                <el-image
                  v-if="tpl.previewUrl"
                  :src="tpl.previewUrl"
                  fit="cover"
                >
                  <template #error>
                    <div class="v-ss-tpl-preview-empty">
                      预览图加载失败
                    </div>
                  </template>
                </el-image>
                <div
                  v-else
                  class="v-ss-tpl-preview-empty"
                >
                  暂无预览图
                </div>
              </div>
              <div class="v-ss-tpl-name">
                {{ tpl.name }}
              </div>
              <div class="v-ss-tpl-desc">
                {{ tpl.description }}
              </div>
            </div>
            <el-empty
              v-if="!templatesLoading && templates.length === 0"
              description="暂无可用模板"
              :image-size="60"
            />
          </div>
          <div class="v-ss-tpl-actions">
            <el-button
              v-permission="'site:site:manage'"
              type="primary"
              :disabled="!selectedTemplateId"
              :loading="applying"
              @click="onApplyTemplate"
            >
              应用所选模板
            </el-button>
            <span class="v-ss-tip">
              应用后：模板自带文件覆盖站点同名文件（旧版进回收站可还原），media/ 与模板外文件不受影响
            </span>
          </div>
        </div>
      </template>
    </div>

    <!-- 编辑站点 -->
    <el-dialog
      v-model="editVisible"
      title="编辑站点信息"
      width="520px"
      :close-on-click-modal="false"
    >
      <el-form
        ref="editFormRef"
        :model="editForm"
        :rules="editRules"
        label-width="100px"
      >
        <el-form-item
          label="站点标识"
          prop="slug"
        >
          <el-input
            v-model="editForm.slug"
            maxlength="32"
          />
          <div class="v-ss-tip">
            修改后旧地址立即全部失效
          </div>
        </el-form-item>
        <el-form-item
          label="站点标题"
          prop="title"
        >
          <el-input
            v-model="editForm.title"
            maxlength="50"
            show-word-limit
          />
        </el-form-item>
        <el-form-item label="站点描述">
          <el-input
            v-model="editForm.description"
            type="textarea"
            :rows="3"
            maxlength="200"
            show-word-limit
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">
          取消
        </el-button>
        <el-button
          type="primary"
          :loading="submitting"
          @click="submitEdit"
        >
          保存
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { confirmDialog } from '@/utils/confirm'
import type { FormInstance, FormRules } from 'element-plus'
import { formatTime } from '@/utils/format'
import SiteSwitcher from '@/components/SiteSwitcher/index.vue'
import { updateSite, listTemplates, applyTemplate } from '@/api/site/site'
import { useSiteStore } from '@/stores/site'
import type { SiteTemplateItem } from '@/types/api'

/**
 * 站点设置页（P4E T63）：作用于「当前站点」（store 提供），单站用户与现状零差异。
 * 创建入口统一收敛到站点列表页；本页 0 站时给出跳转引导。
 */
const router = useRouter()
const store = useSiteStore()

const loadError = ref(false)
const submitting = ref(false)

const editVisible = ref(false)
const editFormRef = ref<FormInstance>()
const editForm = reactive({ slug: '', title: '', description: '' })

const site = computed(() => store.currentSite)
const siteUrl = computed(() => (site.value ? `${window.location.origin}${site.value.siteUrl}` : ''))

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{2,31}$/
const slugValidator = (_rule: unknown, value: string, callback: (err?: Error) => void) => {
  if (!SLUG_PATTERN.test(value)) {
    callback(new Error('需为 3~32 位小写字母/数字/连字符，且以字母或数字开头'))
  } else if (['api', 'www', 'admin', 'manage', 'system', 'open', 'static', 'assets', 'public', 'login', 's', 'site'].includes(value)) {
    callback(new Error('该标识为系统保留字'))
  } else {
    callback()
  }
}
const editRules: FormRules = {
  slug: [{ required: true, validator: slugValidator, trigger: 'blur' }],
  title: [{ required: true, message: '请输入站点标题', trigger: 'blur' }],
}

async function reload() {
  loadError.value = false
  try {
    await store.load()
  } catch {
    loadError.value = true
  }
}

function goSiteList() {
  router.push('/site/site')
}

function openEdit() {
  if (!site.value) return
  editForm.slug = site.value.slug
  editForm.title = site.value.title
  editForm.description = site.value.description ?? ''
  editVisible.value = true
}

async function submitEdit() {
  if (!site.value) return
  const valid = await editFormRef.value?.validate().catch(() => false)
  if (!valid) return
  submitting.value = true
  try {
    await updateSite(site.value.id, {
      slug: editForm.slug,
      title: editForm.title,
      description: editForm.description,
    })
    ElMessage.success('已保存')
    editVisible.value = false
    await store.load()
  } catch {
    // 拦截器提示
  } finally {
    submitting.value = false
  }
}

async function toggleStatus() {
  if (!site.value) return
  const disabling = site.value.status === 1
  if (disabling) {
    const confirmed = await confirmDialog('停用后站点将对访客全部不可见，确认停用？', '提示', { type: 'warning' })
    if (!confirmed) return
  }
  await updateSite(site.value.id, { status: disabling ? 0 : 1 })
  await store.load()
  ElMessage.success(disabling ? '已停用' : '已启用')
}

async function toggleCommentAudit() {
  if (!site.value) return
  const next = site.value.commentAudit === 1 ? 0 : 1
  await updateSite(site.value.id, { commentAudit: next })
  await store.load()
  ElMessage.success(next === 1 ? '已开启评论审核' : '已关闭评论审核（新评论直接展示）')
}

// ========== 模板库（P4b T44） ==========
const templates = ref<SiteTemplateItem[]>([])
const templatesLoading = ref(false)
const selectedTemplateId = ref('')
const applying = ref(false)

async function loadTemplates() {
  templatesLoading.value = true
  try {
    templates.value = await listTemplates()
  } catch {
    // 拦截器提示
  } finally {
    templatesLoading.value = false
  }
}

async function onApplyTemplate() {
  const tpl = templates.value.find((t) => t.id === selectedTemplateId.value)
  if (!tpl || !site.value) return
  const confirmed = await confirmDialog(
    `确认应用「${tpl.name}」？同名文件将被覆盖，旧版可在回收站还原；media/ 与模板外文件不受影响。`,
    '应用模板',
    { type: 'warning', confirmButtonText: '应用' },
  )
  if (!confirmed) return
  applying.value = true
  try {
    const results = await applyTemplate(site.value.id, tpl.id)
    const okCount = results.filter((r) => r.ok).length
    const failCount = results.length - okCount
    if (failCount > 0) {
      ElMessage.warning(`已应用 ${okCount} 个文件，${failCount} 个失败`)
    } else {
      ElMessage.success(`模板应用成功（${okCount} 个文件）`)
    }
  } catch {
    // 拦截器提示（40119 非属主 / 40116 模板不存在）
  } finally {
    applying.value = false
  }
}

onMounted(() => {
  reload()
  loadTemplates()
})
</script>

<style scoped>
.v-site-setting {
  padding: 16px;
  background: #fff;
  border-radius: 6px;
  min-height: 100%;
}
.v-ss-body {
  min-height: 200px;
}
.v-ss-tip {
  color: #909399;
  font-size: 12px;
  margin-left: 10px;
}

/* 模板库卡片（P4b T44） */
.v-ss-templates {
  max-width: 760px;
  margin-top: 36px;
  padding-top: 20px;
  border-top: 1px solid #ebeef5;
}
.v-ss-templates-title {
  font-size: 16px;
  margin-bottom: 14px;
}
.v-ss-tpl-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
  min-height: 80px;
}
.v-ss-tpl-card {
  padding: 14px 16px;
  border: 1px solid #dcdfe6;
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.v-ss-tpl-card:hover {
  border-color: #409eff;
}
.v-ss-tpl-card.selected {
  border-color: #409eff;
  box-shadow: 0 0 0 1px #409eff inset;
}
.v-ss-tpl-name {
  font-weight: 600;
  margin-bottom: 6px;
}
/* 预览图（P6 T80）：固定比例占位，缺图/失败时同一容器显示提示文案 */
.v-ss-tpl-preview {
  height: 120px;
  margin-bottom: 10px;
  overflow: hidden;
  background: #f5f7fa;
  border-radius: 6px;
}
.v-ss-tpl-preview :deep(.el-image) {
  width: 100%;
  height: 100%;
  display: block;
}
.v-ss-tpl-preview-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #909399;
  font-size: 12px;
}
.v-ss-tpl-desc {
  color: #909399;
  font-size: 12px;
  line-height: 1.5;
}
.v-ss-tpl-actions {
  margin-top: 14px;
  display: flex;
  align-items: center;
  gap: 6px;
}
</style>
