<template>
  <div class="v-ai-chat">
    <!-- 开通引导卡片：未开通套餐时整体展示 -->
    <div
      v-if="planMissing"
      class="v-plan-missing"
    >
      <el-empty description="尚未开通 AI 套餐">
        <el-button
          type="primary"
          @click="goPlan"
        >
          前往开通套餐
        </el-button>
      </el-empty>
    </div>

    <template v-else>
      <!-- 左：会话列表 -->
      <div class="v-session-panel">
        <div class="v-session-header">
          <el-button
            type="primary"
            :icon="Plus"
            style="width: 100%"
            @click="startNewConversation"
          >
            新建会话
          </el-button>
        </div>
        <el-scrollbar class="v-session-list">
          <div
            v-for="c in conversations"
            :key="c.id"
            class="v-session-item"
            :class="{ active: c.id === currentConversationId }"
            @click="selectConversation(c)"
          >
            <span class="v-session-title">{{ c.title }}</span>
            <span class="v-session-actions">
              <el-icon
                class="v-session-icon"
                title="重命名"
                @click.stop="renameConversation(c)"
              ><EditPen /></el-icon>
              <el-icon
                class="v-session-icon"
                title="删除"
                @click.stop="removeConversation(c)"
              ><Delete /></el-icon>
            </span>
          </div>
          <el-empty
            v-if="!conversations.length && !loadingConversations"
            description="暂无会话"
            :image-size="60"
          />
        </el-scrollbar>
      </div>

      <!-- 右：对话区 -->
      <div class="v-chat-panel">
        <!-- 顶部：模型选择器 -->
        <div class="v-chat-header">
          <el-select
            v-model="selectedModelId"
            placeholder="请选择模型"
            :disabled="streaming"
            style="width: 280px"
            @change="handleModelChange"
          >
            <el-option-group
              v-for="group in modelGroups"
              :key="group.providerCode"
              :label="group.providerName"
            >
              <el-option
                v-for="m in group.models"
                :key="m.id"
                :label="m.displayName"
                :value="m.id"
              >
                <span>{{ m.displayName }}</span>
                <el-tag
                  v-if="m.supportTool === 1"
                  type="success"
                  size="small"
                  class="v-tool-tag"
                >
                  工具
                </el-tag>
              </el-option>
            </el-option-group>
          </el-select>
          <span
            v-if="currentModel"
            class="v-model-price"
          >
            输入 {{ currentModel.inputPrice }} / 输出 {{ currentModel.outputPrice }} 积分·千 tokens
            <el-tag
              v-if="currentModel.supportTool !== 1"
              type="info"
              size="small"
            >
              不支持工具调用
            </el-tag>
          </span>
        </div>

        <!-- 中间：消息列表 -->
        <el-scrollbar
          ref="messageScroll"
          class="v-message-list"
        >
          <div class="v-message-inner">
            <!-- 空状态：统一引导（新会话 vs 空会话复用同一视觉，仅文案不同） -->
            <div
              v-if="!messages.length"
              class="v-message-empty"
            >
              <AppLogo :size="56" />
              <p class="v-empty-title">
                {{ currentConversationId ? '这个会话还没有消息' : '开始新的对话' }}
              </p>
              <p class="v-empty-sub">
                选择上方模型后输入消息即可提问。<br>
                点回形针可附加云盘文件或本地文本文件（≤5 个、单个 ≤2MB）。<br>
                小文件全文注入，大文件由 AI 按需分段读取。
              </p>
            </div>

            <div
              v-for="msg in messages"
              :key="msg.id"
              class="v-message-row"
              :class="msg.role"
            >
              <!-- 头像：AI 用平台标（公共组件 AppLogo），用户用本人头像/昵称首字 -->
              <div class="v-avatar">
                <AppLogo
                  v-if="msg.role === 'assistant'"
                  :size="30"
                />
                <el-avatar
                  v-else
                  :size="30"
                  :src="userStore.avatarUrl"
                >
                  {{ userInitial }}
                </el-avatar>
              </div>
              <div class="v-bubble">
                <MarkdownView
                  v-if="msg.role === 'assistant'"
                  :content="msg.content"
                />
                <div
                  v-else
                  class="v-user-text"
                >
                  {{ msg.content }}
                </div>
                <!-- P10 R86/R87：附件行（模式标签 / 失效置灰），历史消息同源渲染 -->
                <div
                  v-if="msg.role === 'user' && msg.attachments?.length"
                  class="v-msg-attachments"
                >
                  <div
                    v-for="item in msg.attachments"
                    :key="item.fileId"
                    class="v-msg-attach"
                    :class="{ invalid: item.invalid }"
                  >
                    <el-icon><Document /></el-icon>
                    <span class="v-msg-attach-name">{{ item.name }}</span>
                    <el-tag
                      v-if="item.mode === 'listed' && !item.invalid"
                      size="small"
                      type="warning"
                    >
                      AI 按需读取
                    </el-tag>
                    <span
                      v-if="item.invalid"
                      class="v-msg-attach-tip"
                    >源文件已删除</span>
                  </div>
                </div>
                <!-- 工具调用记录（read 结果标签 / write 确认卡片） -->
                <template v-if="msg.role === 'assistant' && msg.toolCalls?.length">
                  <ToolResultTag
                    v-for="tc in msg.toolCalls.filter((t) => t.kind === 'result')"
                    :key="tc.toolCallId"
                    :title="tc.title"
                    :summary="tc.summary"
                    :status="tc.status"
                  />
                  <ToolConfirmCard
                    v-for="tc in msg.toolCalls.filter((t) => t.kind === 'confirm')"
                    :key="tc.toolCallId"
                    :tool-call-id="tc.toolCallId"
                    :title="tc.title"
                    :summary="tc.summary"
                    :status="tc.status"
                    :expired="tc.status === 'pending' && isConfirmExpired(tc.toolCallId)"
                    @confirm="(approved) => handleToolConfirm(tc, approved)"
                  />
                </template>
                <span
                  v-if="msg.streaming"
                  class="v-cursor"
                />
                <div
                  v-if="msg.failed"
                  class="v-msg-error"
                >
                  生成失败，请重试
                </div>
              </div>
            </div>
          </div>
        </el-scrollbar>

        <!-- 底部：输入区（卡片式：聚焦时整卡高亮；工具栏在卡内底部） -->
        <div class="v-input-area">
          <div class="v-input-card">
            <!-- P10 R86：待发附件 chips（名称/大小/可移除；本地文件仅暂存内存，发送时才上传留档） -->
            <div
              v-if="pendingAttachments.length"
              class="v-attach-chips"
            >
              <div
                v-for="item in pendingAttachments"
                :key="item.key"
                class="v-attach-chip"
              >
                <el-icon><Document /></el-icon>
                <span
                  class="v-attach-name"
                  :title="item.name"
                >{{ item.name }}</span>
                <span class="v-attach-size">{{ formatSize(item.size) }}</span>
                <el-icon
                  class="v-attach-remove"
                  title="移除"
                  @click="removeAttachment(item.key)"
                >
                  <Close />
                </el-icon>
              </div>
            </div>
            <el-input
              v-model="inputText"
              class="v-input-textarea"
              type="textarea"
              :rows="3"
              resize="none"
              placeholder="输入消息，Enter 发送，Shift+Enter 换行"
              :disabled="streaming"
              @keydown="handleKeydown"
            />
            <div class="v-input-actions">
              <el-dropdown
                :disabled="streaming || uploading"
                trigger="click"
                @command="handleAttachCommand"
              >
                <el-button
                  :icon="Paperclip"
                  :disabled="streaming || uploading"
                  text
                  size="small"
                >
                  附件
                </el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="cloud">
                      从云盘选择
                    </el-dropdown-item>
                    <el-dropdown-item command="local">
                      上传本地文件
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
              <span class="v-attach-hint">
                最多 {{ ATTACHMENT_MAX_COUNT }} 个 · 文本类 · 单个 ≤2MB{{ uploading ? ' · 附件上传中…' : '' }}
              </span>
              <el-button
                v-if="streaming"
                type="danger"
                plain
                size="small"
                @click="stopGenerate"
              >
                停止生成
              </el-button>
              <el-button
                v-else
                class="v-send-btn"
                type="primary"
                size="small"
                :icon="Promotion"
                :disabled="!canSend"
                @click="sendMessage"
              >
                发送
              </el-button>
            </div>
          </div>
          <input
            ref="fileInput"
            type="file"
            multiple
            hidden
            :accept="acceptAttr"
            @change="handleLocalFiles"
          >
        </div>
      </div>

      <!-- P10 R86：云盘文件选择器（复用 P8 公共组件 FilePicker，不新造） -->
      <FilePicker
        v-model:visible="pickerVisible"
        title="选择云盘文件作为附件"
        :accept-exts="ATTACHMENT_EXTS"
        @select="handlePickFromCloud"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { confirmDialog } from '@/utils/confirm'
import { formatSize } from '@/utils/format'
import { Close, Delete, Document, EditPen, Paperclip, Plus, Promotion } from '@element-plus/icons-vue'
import type { ElScrollbar } from 'element-plus'
import { listFiles, mkdir, uploadFile } from '@/api/cloud/file'
import AppLogo from '@/components/AppLogo/index.vue'
import { useUserStore } from '@/stores/user'
import {
  confirmToolCall,
  deleteConversation,
  getConversationPage,
  getMessages,
  getModels,
  getMyPlan,
  sendChatMessage,
  updateConversation,
  type AvailableModel,
  type ConversationItem,
  type MessageAttachment,
  type SseSession,
  type ToolCallItem,
  type ToolSummaryItem,
} from '@/api/ai/chat'
import MarkdownView from '@/components/MarkdownView/index.vue'
import FilePicker from '@/components/FilePicker/index.vue'
import {
  ATTACHMENT_DIR_NAME,
  ATTACHMENT_EXTS,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_COUNT,
  attachmentAcceptAttr,
  isAllowedAttachment,
} from '@/views/ai/utils/attachment'
import ToolConfirmCard from '../components/ToolConfirmCard.vue'
import ToolResultTag from '../components/ToolResultTag.vue'

const router = useRouter()
const userStore = useUserStore()

/** 用户头像回退字符（昵称/账号首字，头像未设置时 el-avatar 显示） */
const userInitial = computed(() => (userStore.nickname || '我').slice(0, 1).toUpperCase())

/** 本地工具记录（read 结果 / write 确认） */
interface LocalToolCall extends ToolCallItem {
  kind: 'result' | 'confirm'
}

/** 本地消息（流式状态） */
interface LocalMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
  failed?: boolean
  toolCalls?: LocalToolCall[]
  /** P10：附件元信息（发送时先乐观渲染，meta 事件到达后由后端权威数据覆盖） */
  attachments?: MessageAttachment[]
}

/** 待发附件（P10 R86；本地文件仅暂存 File 对象，**发送时**才上传留档，未发送不占云盘） */
interface PendingAttachment {
  key: string
  name: string
  size: number
  /** 云盘文件 id（云盘选择时即有；本地上传成功后才填） */
  fileId?: string
  /** 本地待上传文件 */
  file?: File
}

// ========== 套餐状态 ==========
const planMissing = ref(false)

// ========== 模型 ==========
const models = ref<AvailableModel[]>([])
const selectedModelId = ref<string>('')
const modelGroups = computed(() => {
  const map = new Map<string, { providerCode: string; providerName: string; models: AvailableModel[] }>()
  for (const m of models.value) {
    if (!map.has(m.providerCode)) {
      map.set(m.providerCode, { providerCode: m.providerCode, providerName: m.providerName, models: [] })
    }
    map.get(m.providerCode)!.models.push(m)
  }
  return [...map.values()]
})
const currentModel = computed(() => models.value.find((m) => m.id === selectedModelId.value) ?? null)

// ========== 会话 ==========
const conversations = ref<ConversationItem[]>([])
const loadingConversations = ref(false)
const currentConversationId = ref<string | null>(null)

// ========== 消息 ==========
const messages = ref<LocalMessage[]>([])
const messageScroll = ref<InstanceType<typeof ElScrollbar>>()

// ========== 输入与流式 ==========
const inputText = ref('')
const streaming = ref(false)
let currentSession: SseSession | null = null

// ========== 附件（P10 R86） ==========
const pendingAttachments = ref<PendingAttachment[]>([])
const pickerVisible = ref(false)
const uploading = ref(false)
const fileInput = ref<HTMLInputElement>()
const acceptAttr = attachmentAcceptAttr()

const canSend = computed(
  () => !streaming.value && !uploading.value && inputText.value.trim().length > 0 && !!selectedModelId.value,
)

// ========== 初始化 ==========
onMounted(async () => {
  await Promise.all([checkPlan(), loadModels(), loadConversations()])
})

/**
 * 离开对话页即中断进行中的生成（2026-09-29 修复）。
 * 背景：`<script setup>` 里的 `currentSession` 属于**组件实例作用域**，组件卸载后引用即丢失，
 * 再也没人能调 `stop()`；而后端 `/ai/chat`（与 `/ai/tool/confirm`）持有**单用户并发流锁**
 * （Redis `ai:chatting:{userId}`，20007），只在流真正结束时才删除 ——
 * 于是「生成中切页面 → 回到对话页」后每次发送都被拒：
 * 「上一段对话仍在生成中，请稍候」（要等旧流跑完或 5 分钟 TTL 兜底过期）。
 * 这里在卸载钩子里显式中断：fetch 断开 → 后端 `res.on('close')` 中断上游 → 锁随即释放。
 */
onBeforeUnmount(() => {
  if (streaming.value) currentSession?.stop()
  currentSession = null
})

async function checkPlan() {
  try {
    const result = await getMyPlan()
    planMissing.value = !result.plan
  } catch {
    planMissing.value = false
  }
}

async function loadModels() {
  try {
    models.value = await getModels()
    if (models.value.length && !selectedModelId.value) {
      selectedModelId.value = models.value[0].id
    }
  } catch {
    models.value = []
  }
}

async function loadConversations() {
  loadingConversations.value = true
  try {
    const result = await getConversationPage({ pageNo: 1, pageSize: 50 })
    conversations.value = result.list
  } catch {
    conversations.value = []
  } finally {
    loadingConversations.value = false
  }
}

// ========== 会话操作 ==========
function startNewConversation() {
  currentConversationId.value = null
  messages.value = []
  // 新会话默认选第一个模型
  if (models.value.length && !selectedModelId.value) {
    selectedModelId.value = models.value[0].id
  }
}

async function selectConversation(c: ConversationItem) {
  if (streaming.value) {
    ElMessage.warning('正在生成中，请先停止')
    return
  }
  currentConversationId.value = c.id
  selectedModelId.value = c.modelId ?? selectedModelId.value
  messages.value = []
  try {
    const list = await getMessages(c.id)
    messages.value = list.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      failed: m.status === 2,
      toolCalls: (m.toolCalls ?? []).map((tc) => ({
        ...tc,
        kind: tc.risk === 'write' ? 'confirm' : 'result',
      })),
      attachments: m.attachments ?? [],
    }))
    scrollToBottom()
  } catch {
    ElMessage.error('加载消息失败')
  }
}

async function renameConversation(c: ConversationItem) {
  const { value } = await ElMessageBox.prompt('请输入会话名称', '重命名会话', {
    inputValue: c.title,
    inputValidator: (v) => (v && v.length >= 1 && v.length <= 50) || '名称长度需在 1~50 字之间',
  })
  if (!value) return
  await updateConversation(c.id, { title: value })
  ElMessage.success('重命名成功')
  loadConversations()
}

async function removeConversation(c: ConversationItem) {
  if (!(await confirmDialog(`确认删除会话「${c.title}」吗？`, '提示', { type: 'warning' }))) return
  await deleteConversation(c.id)
  ElMessage.success('删除成功')
  if (currentConversationId.value === c.id) {
    startNewConversation()
  }
  loadConversations()
}

// ========== 模型切换 ==========
async function handleModelChange(modelId: string) {
  // 已有会话：同步更新会话绑定模型
  if (currentConversationId.value) {
    try {
      await updateConversation(currentConversationId.value, { modelId: Number(modelId) })
      loadConversations()
    } catch {
      // 错误提示由 request 统一处理
    }
  }
}

// ========== 附件操作（P10 R86） ==========
/** 数量帽校验（前后端同口径 ≤5） */
function ensureAttachCapacity(): boolean {
  if (pendingAttachments.value.length >= ATTACHMENT_MAX_COUNT) {
    ElMessage.warning(`单条消息最多 ${ATTACHMENT_MAX_COUNT} 个附件`)
    return false
  }
  return true
}

/** 回形针菜单：从云盘选择 / 上传本地文件 */
function handleAttachCommand(command: string | number | object): void {
  if (!ensureAttachCapacity()) return
  if (command === 'cloud') {
    pickerVisible.value = true
  } else if (command === 'local') {
    fileInput.value?.click()
  }
}

/** 云盘选择（只读引用，不产生新文件） */
function handlePickFromCloud(file: { id: string; name: string; ext: string; size: string }): void {
  if (!ensureAttachCapacity()) return
  if (pendingAttachments.value.some((item) => item.fileId === file.id)) {
    ElMessage.warning('该文件已在待发附件中')
    return
  }
  pendingAttachments.value.push({ key: `c-${file.id}`, name: file.name, size: Number(file.size), fileId: file.id })
}

/** 本地选择（仅暂存内存；类型/体积前端预校验，真正校验链在后端） */
function handleLocalFiles(event: Event): void {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  // 清空 value，允许再次选择同一文件
  input.value = ''
  for (const file of files) {
    if (!ensureAttachCapacity()) break
    if (!isAllowedAttachment(file.name)) {
      ElMessage.warning(`「${file.name}」类型不支持，仅支持文本类文件`)
      continue
    }
    if (file.size > ATTACHMENT_MAX_BYTES) {
      ElMessage.warning(`「${file.name}」超过 2MB`)
      continue
    }
    pendingAttachments.value.push({ key: `l-${Date.now()}-${file.name}`, name: file.name, size: file.size, file })
  }
}

function removeAttachment(key: string): void {
  pendingAttachments.value = pendingAttachments.value.filter((item) => item.key !== key)
}

/** 云盘根下的附件留档目录（自动创建，D84；同名 "(1)" 时复用已存在目录） */
async function ensureAttachmentDir(): Promise<number> {
  const root = await listFiles(0)
  const existed = root.list.find((item) => item.isDir && item.name === ATTACHMENT_DIR_NAME)
  if (existed) return Number(existed.id)
  const created = await mkdir(0, ATTACHMENT_DIR_NAME)
  return Number(created.id)
}

/** 发送前上传本地附件（失败向上抛：整条不发出、chips 保留可重试） */
async function uploadPendingAttachments(): Promise<string[]> {
  const localItems = pendingAttachments.value.filter((item) => item.file)
  if (localItems.length > 0) {
    uploading.value = true
    try {
      const dirId = await ensureAttachmentDir()
      for (const item of localItems) {
        const uploaded = await uploadFile(dirId, item.file as File)
        item.fileId = uploaded.id
        item.file = undefined
      }
    } finally {
      uploading.value = false
    }
  }
  return pendingAttachments.value.map((item) => item.fileId ?? '').filter((id) => id !== '')
}

// ========== 发送 ==========
function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
}

async function sendMessage() {
  if (!canSend.value) return
  const content = inputText.value.trim()

  // P10 R86：本地附件「发送时才上传留档」——失败则整条不发出、chips 保留可重试
  let attachmentIds: string[] = []
  if (pendingAttachments.value.length > 0) {
    try {
      attachmentIds = await uploadPendingAttachments()
    } catch {
      return
    }
  }
  const sentAttachments: MessageAttachment[] = pendingAttachments.value.map((item) => ({
    fileId: item.fileId ?? '',
    name: item.name,
    ext: '',
    size: item.size,
    chars: 0,
    mode: 'inject',
    path: '',
  }))
  pendingAttachments.value = []
  inputText.value = ''

  // 本地插入 user 消息 + assistant 占位（通过数组索引访问 Proxy 对象，确保响应式更新）
  messages.value.push({ id: `u-${Date.now()}`, role: 'user', content, attachments: sentAttachments })
  messages.value.push({ id: `a-${Date.now()}`, role: 'assistant', content: '', streaming: true })
  const assistantIndex = messages.value.length - 1
  scrollToBottom()

  streaming.value = true
  const payload = {
    content,
    ...(currentConversationId.value
      ? { conversationId: Number(currentConversationId.value) }
      : { modelId: Number(selectedModelId.value) }),
    ...(attachmentIds.length > 0 ? { attachments: attachmentIds.map((fileId) => ({ fileId })) } : {}),
  }

  currentSession = sendChatMessage(payload, {
    onEvent: (event) => {
      const assistantMsg = messages.value[assistantIndex]
      if (!assistantMsg) return
      if (event.type === 'meta') {
        // 新会话：meta 返回的 conversationId 即创建成功的会话
        if (!currentConversationId.value && event.conversationId) {
          currentConversationId.value = event.conversationId as string
        }
        // P10：后端权威附件元信息（含 inject/listed 分流结果）覆盖乐观渲染
        const metas = event.attachments as MessageAttachment[] | undefined
        const userMsg = messages.value[assistantIndex - 1]
        if (metas?.length && userMsg) userMsg.attachments = metas
      } else if (event.type === 'delta') {
        assistantMsg.content += (event.content as string) ?? ''
        scrollToBottom()
      } else if (event.type === 'tool_result') {
        // read 工具结果 → 折叠标签
        pushToolCall(assistantMsg, {
          toolCallId: event.toolCallId as string,
          toolName: event.toolName as string,
          title: event.title as string,
          summary: event.summary as string | ToolSummaryItem[],
          params: {},
          status: event.status as string,
          risk: 'read',
          kind: 'result',
        })
        scrollToBottom()
      } else if (event.type === 'tool_confirm') {
        // write 工具待确认 → 确认卡片
        pushToolCall(assistantMsg, {
          toolCallId: event.toolCallId as string,
          toolName: event.toolName as string,
          title: event.title as string,
          summary: event.summary as string | ToolSummaryItem[],
          params: (event.params as Record<string, unknown>) ?? {},
          status: 'pending',
          risk: 'write',
          kind: 'confirm',
        })
        scrollToBottom()
      } else if (event.type === 'done') {
        streaming.value = false
        assistantMsg.streaming = false
        loadConversations()
        scrollToBottom()
      } else if (event.type === 'error') {
        streaming.value = false
        assistantMsg.streaming = false
        assistantMsg.failed = true
        handleChatError(event.code as number, event.message as string)
      }
    },
    onError: (code, message) => {
      streaming.value = false
      const assistantMsg = messages.value[assistantIndex]
      if (assistantMsg) {
        assistantMsg.streaming = false
        assistantMsg.failed = true
      }
      handleChatError(code, message)
    },
  })
}

function stopGenerate() {
  currentSession?.stop()
  streaming.value = false
  const last = messages.value[messages.value.length - 1]
  if (last?.role === 'assistant') {
    last.streaming = false
  }
  loadConversations()
}

/** 向 assistant 消息追加工具记录（确保响应式） */
function pushToolCall(msg: LocalMessage, tc: LocalToolCall) {
  if (!msg.toolCalls) msg.toolCalls = []
  msg.toolCalls.push(tc)
}

/** 确认卡片按钮：调 confirm 接口，SSE 渲染为新 AI 气泡（不续接） */
function handleToolConfirm(tc: LocalToolCall, approved: boolean) {
  if (streaming.value) return
  // 立即把卡片置为已处理状态（避免重复点击）
  tc.status = approved ? 'executed' : 'rejected'

  // 追加新 assistant 占位气泡
  messages.value.push({ id: `c-${Date.now()}`, role: 'assistant', content: '', streaming: true })
  const newIndex = messages.value.length - 1
  scrollToBottom()
  streaming.value = true

  // 保存句柄：确认链路的流此前未记录，导致「停止生成」与「离开页面」都中断不了它（锁会一直占着）
  currentSession = confirmToolCall({ toolCallId: Number(tc.toolCallId), approved }, {
    onEvent: (event) => {
      const assistantMsg = messages.value[newIndex]
      if (!assistantMsg) return
      if (event.type === 'delta') {
        assistantMsg.content += (event.content as string) ?? ''
        scrollToBottom()
      } else if (event.type === 'tool_result') {
        pushToolCall(assistantMsg, {
          toolCallId: event.toolCallId as string,
          toolName: event.toolName as string,
          title: event.title as string,
          summary: event.summary as string | ToolSummaryItem[],
          params: {},
          status: event.status as string,
          risk: 'read',
          kind: 'result',
        })
        scrollToBottom()
      } else if (event.type === 'tool_confirm') {
        pushToolCall(assistantMsg, {
          toolCallId: event.toolCallId as string,
          toolName: event.toolName as string,
          title: event.title as string,
          summary: event.summary as string | ToolSummaryItem[],
          params: (event.params as Record<string, unknown>) ?? {},
          status: 'pending',
          risk: 'write',
          kind: 'confirm',
        })
        scrollToBottom()
      } else if (event.type === 'done') {
        streaming.value = false
        assistantMsg.streaming = false
        loadConversations()
        scrollToBottom()
      } else if (event.type === 'error') {
        streaming.value = false
        assistantMsg.streaming = false
        assistantMsg.failed = true
        handleChatError(event.code as number, event.message as string)
      }
    },
    onError: (code, message) => {
      streaming.value = false
      const assistantMsg = messages.value[newIndex]
      if (assistantMsg) {
        assistantMsg.streaming = false
        assistantMsg.failed = true
      }
      // 20016 确认单过期：恢复卡片为过期态
      if (code === 20016) {
        tc.status = 'pending'
      }
      handleChatError(code, message)
    },
  })
}

/** 判断确认单是否过期（前端无法精确计时，暂以 false 兜底，后端 20016 校验） */
function isConfirmExpired(_toolCallId: string): boolean {
  return false
}

// ========== 错误处理 ==========
function handleChatError(code: number, message: string) {
  if (code === 20001) {
    // 未开通套餐
    planMissing.value = true
    return
  }
  if (code === 20002) {
    ElMessage.error('本周期积分已用尽，请前往开通套餐页升级')
    return
  }
  ElMessage.error(message || '发送失败')
}

function goPlan() {
  router.push('/ai/plan')
}

// ========== 工具 ==========
async function scrollToBottom() {
  await nextTick()
  messageScroll.value?.setScrollTop(Number.MAX_SAFE_INTEGER)
}
</script>

<style scoped>
.v-ai-chat {
  display: flex;
  gap: 12px;
  height: calc(100vh - 130px);
  min-height: 500px;
}
.v-plan-missing {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fff;
  border-radius: 6px;
}

/* 左：会话列表 */
.v-session-panel {
  width: 264px;
  flex-shrink: 0;
  background: #fff;
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.v-session-header {
  padding: 12px;
  border-bottom: 1px solid #f0f2f5;
}
.v-session-list {
  flex: 1;
}
.v-session-list :deep(.el-scrollbar__view) {
  padding: 8px;
}
.v-session-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 9px 10px;
  margin-bottom: 2px;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 0.2s;
}
.v-session-item:hover {
  background: #f5f7fa;
}
.v-session-item.active {
  background: #ecf5ff;
}
/* 选中态：左侧主色竖条（绝对定位，不占布局宽度） */
.v-session-item.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  width: 3px;
  height: 16px;
  border-radius: 0 2px 2px 0;
  background: var(--el-color-primary);
  transform: translateY(-50%);
}
.v-session-item.active .v-session-title {
  color: var(--el-color-primary);
  font-weight: 500;
}
.v-session-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: #303133;
}
.v-session-actions {
  display: none;
  gap: 2px;
}
.v-session-item:hover .v-session-actions,
.v-session-item.active .v-session-actions {
  display: flex;
}
.v-session-icon {
  padding: 3px;
  border-radius: 4px;
  color: #909399;
  font-size: 14px;
  transition:
    color 0.2s,
    background-color 0.2s;
}
.v-session-icon:hover {
  color: var(--el-color-primary);
  background: rgba(64, 158, 255, 0.12);
}

/* 右：对话区 */
.v-chat-panel {
  flex: 1;
  min-width: 0;
  background: #fff;
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.v-chat-header {
  padding: 10px 16px;
  border-bottom: 1px solid #f0f2f5;
  display: flex;
  align-items: center;
  gap: 12px;
}
.v-model-price {
  margin-left: auto;
  font-size: 12px;
  color: #909399;
  display: flex;
  align-items: center;
  gap: 8px;
}
.v-tool-tag {
  margin-left: 8px;
}
.v-message-list {
  flex: 1;
  background: #f7f8fa;
}
.v-message-inner {
  padding: 20px 24px 24px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
/* 空状态（新会话 / 空会话共用视觉，文案区分）
   注意：AppLogo 内部是 display:block 的 SVG，仅靠 text-align:center 不会居中，故用纵向 flex 居中 */
.v-message-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  max-width: 460px;
  margin: auto;
  padding: 40px 0;
  text-align: center;
}
.v-empty-title {
  margin: 16px 0 6px;
  font-size: 15px;
  font-weight: 500;
  color: #303133;
}
.v-empty-sub {
  margin: 0;
  font-size: 12px;
  line-height: 1.8;
  color: #909399;
}
.v-message-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
/* 用户消息镜像排列：头像靠右、气泡贴右（DOM 顺序与 AI 消息一致，便于复用） */
.v-message-row.user {
  flex-direction: row-reverse;
}
.v-avatar {
  flex-shrink: 0;
  margin-top: 2px;
  line-height: 0;
}
.v-avatar :deep(.el-avatar) {
  background: #c0c4cc;
  font-size: 13px;
}
.v-bubble {
  max-width: 76%;
  padding: 10px 14px;
  border-radius: 10px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}
/* 贴近头像的一角收窄，形成「从该侧发出」的指向感 */
.v-message-row.assistant .v-bubble {
  background: #fff;
  color: #303133;
  border-top-left-radius: 2px;
}
.v-message-row.user .v-bubble {
  background: var(--el-color-primary);
  color: #fff;
  border-top-right-radius: 2px;
  box-shadow: none;
}
.v-user-text {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.6;
}
.v-cursor {
  display: inline-block;
  width: 2px;
  height: 15px;
  border-radius: 1px;
  background: var(--el-color-primary);
  margin-left: 3px;
  vertical-align: text-bottom;
  animation: v-blink 1s step-start infinite;
}
@keyframes v-blink {
  50% {
    opacity: 0;
  }
}
.v-msg-error {
  margin-top: 6px;
  font-size: 12px;
  color: #f56c6c;
}
/* P10 R86/R87：气泡附件行（模式标签 / 失效置灰） */
.v-msg-attachments {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.35);
}
.v-msg-attach {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
.v-msg-attach-name {
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.v-msg-attach.invalid {
  opacity: 0.75;
  text-decoration: line-through;
}
.v-msg-attach-tip {
  font-size: 12px;
}
/* 附件标签落在主色气泡内：改白底，避免黄色标签与主色蓝互斥 */
.v-msg-attachments :deep(.el-tag) {
  --el-tag-bg-color: rgba(255, 255, 255, 0.92);
  --el-tag-border-color: transparent;
  --el-tag-text-color: #b88230;
}
/* 输入区：卡片包裹（聚焦时整卡高亮），工具栏收进卡内底部 */
.v-input-area {
  padding: 12px 16px 16px;
  border-top: 1px solid #f0f2f5;
}
.v-input-card {
  padding: 6px 8px 4px;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  transition:
    border-color 0.2s,
    box-shadow 0.2s;
}
.v-input-card:focus-within {
  border-color: var(--el-color-primary);
  box-shadow: 0 0 0 3px rgba(64, 158, 255, 0.12);
}
/* textarea 去边框（外框由 .v-input-card 承担，避免双层边框） */
.v-input-textarea :deep(.el-textarea__inner) {
  padding: 4px 4px 0;
  border: none;
  background: transparent;
  box-shadow: none;
  font-size: 14px;
  line-height: 1.6;
}
.v-input-textarea :deep(.el-textarea__inner:focus) {
  box-shadow: none;
}
.v-input-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 4px;
  border-top: 1px solid #f5f7fa;
}
.v-send-btn {
  margin-left: auto;
}
/* P10 R86：待发附件 chips */
.v-attach-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 2px 2px 6px;
}
.v-attach-chip {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  background: #f7f8fa;
  font-size: 12px;
  color: #606266;
}
.v-attach-name {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.v-attach-size {
  color: #a8abb2;
}
.v-attach-remove {
  cursor: pointer;
  transition: color 0.2s;
}
.v-attach-remove:hover {
  color: #f56c6c;
}
.v-attach-hint {
  font-size: 12px;
  color: #a8abb2;
}
</style>
