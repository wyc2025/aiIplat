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
            <el-empty
              v-if="!messages.length && !currentConversationId"
              description="选择模型，输入消息开始对话"
              :image-size="90"
            />
            <el-empty
              v-else-if="!messages.length"
              description="暂无消息"
              :image-size="90"
            />

            <div
              v-for="msg in messages"
              :key="msg.id"
              class="v-message-row"
              :class="msg.role"
            >
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

        <!-- 底部：输入区 -->
        <div class="v-input-area">
          <el-input
            v-model="inputText"
            type="textarea"
            :rows="3"
            resize="none"
            placeholder="输入消息，Enter 发送，Shift+Enter 换行"
            :disabled="streaming"
            @keydown="handleKeydown"
          />
          <div class="v-input-actions">
            <el-button
              v-if="streaming"
              type="danger"
              @click="stopGenerate"
            >
              停止生成
            </el-button>
            <el-button
              v-else
              type="primary"
              :disabled="!canSend"
              @click="sendMessage"
            >
              发送
            </el-button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { confirmDialog } from '@/utils/confirm'
import { Plus, EditPen, Delete } from '@element-plus/icons-vue'
import type { ElScrollbar } from 'element-plus'
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
  type SseSession,
  type ToolCallItem,
  type ToolSummaryItem,
} from '@/api/ai/chat'
import MarkdownView from '@/components/MarkdownView/index.vue'
import ToolConfirmCard from '../components/ToolConfirmCard.vue'
import ToolResultTag from '../components/ToolResultTag.vue'

const router = useRouter()

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

const canSend = computed(() => !streaming.value && inputText.value.trim().length > 0 && !!selectedModelId.value)

// ========== 初始化 ==========
onMounted(async () => {
  await Promise.all([checkPlan(), loadModels(), loadConversations()])
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
  inputText.value = ''

  // 本地插入 user 消息 + assistant 占位（通过数组索引访问 Proxy 对象，确保响应式更新）
  messages.value.push({ id: `u-${Date.now()}`, role: 'user', content })
  messages.value.push({ id: `a-${Date.now()}`, role: 'assistant', content: '', streaming: true })
  const assistantIndex = messages.value.length - 1
  scrollToBottom()

  streaming.value = true
  const payload = {
    content,
    ...(currentConversationId.value ? { conversationId: Number(currentConversationId.value) } : { modelId: Number(selectedModelId.value) }),
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

  confirmToolCall({ toolCallId: Number(tc.toolCallId), approved }, {
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
  gap: 16px;
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
  width: 260px;
  flex-shrink: 0;
  background: #fff;
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.v-session-header {
  padding: 12px;
  border-bottom: 1px solid #ebeef5;
}
.v-session-list {
  flex: 1;
}
.v-session-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  cursor: pointer;
  border-bottom: 1px solid #f5f7fa;
}
.v-session-item:hover {
  background: #f5f7fa;
}
.v-session-item.active {
  background: #ecf5ff;
}
.v-session-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}
.v-session-actions {
  display: none;
  gap: 6px;
}
.v-session-item:hover .v-session-actions {
  display: flex;
}
.v-session-icon {
  color: #909399;
  font-size: 14px;
}
.v-session-icon:hover {
  color: #409eff;
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
  padding: 12px 16px;
  border-bottom: 1px solid #ebeef5;
  display: flex;
  align-items: center;
  gap: 12px;
}
.v-model-price {
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
  padding: 16px 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.v-message-row {
  display: flex;
}
.v-message-row.user {
  justify-content: flex-end;
}
.v-message-row.assistant {
  justify-content: flex-start;
}
.v-bubble {
  max-width: 72%;
  padding: 10px 14px;
  border-radius: 8px;
}
.v-message-row.user .v-bubble {
  background: #409eff;
  color: #fff;
}
.v-message-row.assistant .v-bubble {
  background: #fff;
  border: 1px solid #e4e7ed;
  color: #303133;
}
.v-user-text {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.6;
}
.v-cursor {
  display: inline-block;
  width: 8px;
  height: 16px;
  background: #409eff;
  margin-left: 2px;
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
.v-input-area {
  padding: 12px 16px;
  border-top: 1px solid #ebeef5;
}
.v-input-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 10px;
}
</style>
