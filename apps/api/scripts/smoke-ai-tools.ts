/**
 * AI 工具链路冒烟（真实模型对话 + ai_tool_call 落库断言）。P9 T95（可重跑资产）。
 *
 * 为什么需要它：
 * - `check:ai` 只做静态核查（注册 / 归组 / perms / 手册字数），**查不出「模型拿到工具后是否用得起来」**；
 * - 直调工具 handler 也测不出——参数是人手写死的，永远能通（P4b 时期冒烟以直调 handler 为主，
 *   正因如此 P9 T92 的缺口「工具只收 fileId 而 list_cloud_files 只回 path」溜过了全部静态检查）；
 * - 只有真实对话 + `ai_tool_call` 落库证据能证明「模型确实调用了该工具、带了什么参数、结果如何」。
 *
 * 何时必须跑（详见 docs/PROGRESS.md「AI 冒烟清单」）：
 *   动过 AI 工具定义（name / description / parameters / 返回值 / perms）、工具下发链（分组 / 关键词 /
 *   能力清单 / 手册）或 write 确认链路时。
 *
 * 跑法（apps/api 目录下）：
 *   pnpm --filter @iplat/api smoke:ai
 *
 * 前置：MySQL / Redis 与 API 实例已起（默认 http://127.0.0.1:3000）；
 *       厂商模型管理里至少一个 support_tool=1 的模型启用且厂商已填 API Key；账号套餐有余量。
 * 可用环境变量覆盖：SMOKE_BASE_URL / SMOKE_USERNAME / SMOKE_PASSWORD。
 *
 * 退出码：0 = 全过；1 = 有失败；2 = 前置不满足（API 不可达 / 无可用模型，按「跳过」处理而非失败）。
 */
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'

const BASE = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3000'
const USERNAME = process.env.SMOKE_USERNAME ?? 'admin'
const PASSWORD = process.env.SMOKE_PASSWORD ?? 'Admin@123'
/** 用户云盘虚拟根（cloud_file.parent_id = 0） */
const USER_ROOT_ID = BigInt(0)
/** 每条用例最多尝试次数（模型偶发纯文字回复不调工具，属上游行为，见 PROGRESS P4b T45 登记） */
const MAX_ATTEMPT = 3
/** 单次对话流超时（毫秒） */
const CHAT_TIMEOUT_MS = 180_000
/** 重试间隔（毫秒）：/ai/chat 有 20 次/分/用户 限流，连击会把重试机会浪费在限流上 */
const RETRY_DELAY_MS = 3_000

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** 载入 apps/api/.env（脚本约定以 apps/api 为 cwd 运行）；已注入的同名变量不覆盖 */
function loadEnvFromCwd(): void {
  if (process.env.DATABASE_URL) return
  try {
    for (const line of readFileSync('.env', 'utf-8').split(/\r?\n/)) {
      const matched = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim())
      if (!matched) continue
      const key = matched[1]
      const value = matched[2].replace(/^"|"$/g, '')
      if (!process.env[key]) process.env[key] = value
    }
  } catch {
    // 无 .env 时依赖外部环境变量注入
  }
}

interface CheckResult {
  ok: boolean
  reason: string
}

/** 一次对话流的观察结果（用于失败诊断，不参与判定） */
interface StreamOutcome {
  /** 是否收到 done 事件 */
  finished: boolean
  /** error 事件的内容（上游/预检失败时给诊断线索） */
  errorEvent: string | null
  /** 收到的字节数（0 = 流几乎没内容） */
  bytes: number
  /** meta 事件负载（P10：含 userMessageId 与 attachments 元信息） */
  meta: Record<string, unknown> | null
  /** 累积的助手文本（P10 用例：断言「模型确实读到了附件内容」） */
  content: string
  /** write 工具的确认请求（P11 L 用例：自动批准 app 组写工具） */
  confirms: StreamConfirm[]
  /** meta 事件中的会话 id（P11 L 用例：追加推进消息须续接同一会话） */
  conversationId: number | null
}

/** tool_confirm 事件（写工具确认卡） */
interface StreamConfirm {
  toolCallId: string
  toolName: string
}

/** 云盘根下的附件留档目录（与前端/后端同口径，D84） */
const ATTACHMENT_DIR = 'ai-attachments'
/** 附件夹具核对码（固定值：文件已存在时复用，避免反复占用配额） */
const INJECT_MARKER = 'IPLAT-INJECT-OK'
const LISTED_MARKER = 'IPLAT-TAIL-OK'
/** 附件夹具文件名 */
const INJECT_FIXTURE = 'smoke-attach-inject.txt'
const LISTED_FIXTURE = 'smoke-attach-listed.txt'

/** 取登录 token（失败直接抛出，属前置问题） */
async function login(): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  })
  const body = (await res.json()) as { code?: number; data?: { accessToken?: string } }
  const token = body.data?.accessToken
  if (body.code !== 0 || !token) throw new Error(`登录失败（code=${body.code ?? 'HTTP ' + res.status}）`)
  return token
}

/**
 * 发一条消息并读完整条 SSE 流。
 * 判定结论一律以 ai_tool_call / ai_message 落库为准；本函数只负责「等模型跑完」并收集失败诊断信息。
 * P10：可选 attachments（附件用例）；同时收集 meta 事件（附件元信息）与助手文本（内容引用断言）。
 */
async function chat(
  token: string,
  modelId: number,
  content: string,
  attachments?: Array<{ fileId: string }>,
  conversationId?: number | null,
): Promise<StreamOutcome> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS)
  const outcome: StreamOutcome = {
    finished: false,
    errorEvent: null,
    bytes: 0,
    meta: null,
    content: '',
    confirms: [],
    conversationId: null,
  }
  try {
    const res = await fetch(`${BASE}/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        modelId,
        content,
        ...(attachments?.length ? { attachments } : {}),
        ...(conversationId ? { conversationId } : {}),
      }),
      signal: controller.signal,
    })
    if (!res.ok || !res.body) {
      // 未进流式（统一 JSON 错误体）：把响应体读出来当诊断
      outcome.errorEvent = `HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`
      return outcome
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (!outcome.finished) {
      const { done, value } = await reader.read()
      if (done) break
      outcome.bytes += value?.byteLength ?? 0
      buffer += decoder.decode(value, { stream: true })
      let index = buffer.indexOf('\n\n')
      while (index >= 0) {
        const rawEvent = buffer.slice(0, index)
        buffer = buffer.slice(index + 2)
        // SSE 帧为单条 `data: {json}`（type 在 JSON 体内，无 event: 行）
        const dataLine = /^data:\s*(.+)$/m.exec(rawEvent)?.[1]?.trim()
        if (dataLine) {
          try {
            const payload = JSON.parse(dataLine) as Record<string, unknown> & { type?: string; content?: string }
            if (payload.type === 'done') outcome.finished = true
            else if (payload.type === 'meta') {
              outcome.meta = payload
              const rawConv = (payload as { conversationId?: unknown }).conversationId
              if (rawConv !== undefined && rawConv !== null) {
                const parsed = Number(rawConv)
                if (Number.isFinite(parsed)) outcome.conversationId = parsed
              }
            }
            else if (payload.type === 'delta' && typeof payload.content === 'string') outcome.content += payload.content
            else if (payload.type === 'tool_confirm' && payload.toolCallId !== undefined) {
              outcome.confirms.push({
                toolCallId: String(payload.toolCallId),
                toolName: String(payload.toolName ?? ''),
              })
            } else if (payload.type === 'error') outcome.errorEvent = JSON.stringify(payload).slice(0, 200)
          } catch {
            // 非 JSON data 行（心跳等）：忽略
          }
        }
        index = buffer.indexOf('\n\n')
      }
    }
    return outcome
  } finally {
    clearTimeout(timer)
  }
}

// ==================== P10 附件夹具（云盘 API 直接操作，走真实业务链路） ====================

interface ApiEnvelope<T> {
  code?: number
  message?: string
  data?: T
}

/** 统一请求（自动带 token、解开统一响应体；非 0 即抛） */
async function api<T>(
  token: string,
  path: string,
  options: { method?: string; json?: unknown; form?: FormData } = {},
): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
  let body: FormData | string | undefined
  if (options.form) {
    body = options.form
  } else if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(options.json)
  }
  const res = await fetch(`${BASE}${path}`, { method: options.method ?? 'GET', headers, body })
  const payload = (await res.json()) as ApiEnvelope<T>
  if (payload.code !== 0) {
    throw new Error(`${path} → code=${payload.code ?? res.status} ${payload.message ?? ''}`)
  }
  return payload.data as T
}

/** 附件留档目录（存在即复用，不存在才创建） */
async function ensureAttachmentDir(token: string): Promise<string> {
  const root = await api<{ list: Array<{ id: string; name: string; isDir: boolean }> }>(
    token,
    '/api/cloud/file/list?parentId=0',
  )
  const existed = root.list.find((item) => item.isDir && item.name === ATTACHMENT_DIR)
  if (existed) return existed.id
  const created = await api<{ id: string }>(token, '/api/cloud/file/mkdir', {
    method: 'POST',
    json: { parentId: 0, name: ATTACHMENT_DIR },
  })
  return created.id
}

/**
 * 附件夹具（固定文件名 + 固定内容）：已存在则复用。
 * 复用而非每次重建，是因为云盘软删不释放 used（R2 语义），反复建夹具会持续蚕食配额。
 */
async function ensureFixture(token: string, name: string, content: string): Promise<string> {
  const dirId = await ensureAttachmentDir(token)
  const dir = await api<{ list: Array<{ id: string; name: string; isDir: boolean }> }>(
    token,
    `/api/cloud/file/list?parentId=${dirId}`,
  )
  const existed = dir.list.find((item) => !item.isDir && item.name === name)
  if (existed) return existed.id

  const form = new FormData()
  form.append('file', new Blob([content], { type: 'text/plain' }), name)
  const uploaded = await api<{ id: string }>(token, `/api/cloud/file/upload?parentId=${dirId}`, {
    method: 'POST',
    form,
  })
  return uploaded.id
}

/** inject 用例夹具：小文件（全文注入，模型应直接答出核对码） */
function injectFixtureContent(): string {
  return (
    `# 小附件核对\n\n核对码：${INJECT_MARKER}\n\n` + '本行用于撑出若干行文本，验证全文注入。\n'.repeat(30)
  )
}

/** listed 用例夹具：>3 万字符（触发清单模式），核对码放在**文件末尾**（迫使模型分段读到后段） */
function listedFixtureContent(): string {
  const filler = '这一行用于把文件撑到三万字符以上，触发清单模式与分段自读。\n'
  return `# 大附件核对\n\n开头说明：本文件很长，末尾才是核对码。\n\n${filler.repeat(1200)}\n文件末尾核对码：${LISTED_MARKER}\n`
}

/** 从 meta 事件读取本次附件元信息（后端分流结果，权威） */
function metaAttachments(outcome: StreamOutcome): Array<{ fileId: string; mode: string; chars: number }> {
  const raw = outcome.meta?.attachments
  return Array.isArray(raw) ? (raw as Array<{ fileId: string; mode: string; chars: number }>) : []
}

/** since 之后该工具最近一条留痕的断言（无记录 / 状态非 executed / verify 不通过 → 失败原因） */
async function assertToolCall(
  prisma: PrismaClient,
  userId: bigint,
  toolName: string,
  since: Date,
  verify: (params: Record<string, unknown>, result: string) => string | null,
): Promise<CheckResult> {
  const row = await prisma.aiToolCall.findFirst({
    where: { userId, toolName, createdAt: { gte: since } },
    orderBy: { id: 'desc' },
  })
  if (!row) return { ok: false, reason: `未出现 ${toolName} 调用记录（模型未选中该工具？）` }
  if (row.status !== 'executed') {
    return {
      ok: false,
      reason: `${toolName} #${row.id} status=${row.status}${row.errorMsg ? ` err=${row.errorMsg}` : ''}`,
    }
  }
  const params = (row.params ?? {}) as Record<string, unknown>
  const reason = verify(params, row.result ?? '')
  return reason ? { ok: false, reason } : { ok: true, reason: `#${row.id} executed` }
}

// ==================== P11 数据应用写工具自动确认（L 用例） ====================

/** app 组工具名（写工具，需确认卡批准后才会执行） */
const APP_WRITE_TOOLS = new Set([
  'create_data_app',
  'add_table',
  'add_fields',
  'set_relation',
  'gen_admin_page',
  'adjust_page',
  'confirm_data_app',
])

/** 批准一次写工具确认（SSE 流式返回总结；同时收集后续可能出现的确认） */
async function confirmTool(
  token: string,
  toolCallId: string,
  approved: boolean,
): Promise<{ confirms: StreamConfirm[]; finished: boolean; errorEvent: string | null }> {
  const confirms: StreamConfirm[] = []
  let finished = false
  let errorEvent: string | null = null
  const res = await fetch(`${BASE}/api/ai/tool/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ toolCallId: Number(toolCallId), approved }),
  })
  if (!res.ok || !res.body) {
    return { confirms, finished, errorEvent: `HTTP ${res.status}` }
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (!finished) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let index = buffer.indexOf('\n\n')
    while (index >= 0) {
      const rawEvent = buffer.slice(0, index)
      buffer = buffer.slice(index + 2)
      const dataLine = /^data:\s*(.+)$/m.exec(rawEvent)?.[1]?.trim()
      if (dataLine) {
        try {
          const payload = JSON.parse(dataLine) as Record<string, unknown> & { type?: string }
          if (payload.type === 'done') finished = true
          else if (payload.type === 'tool_confirm' && payload.toolCallId !== undefined) {
            confirms.push({
              toolCallId: String(payload.toolCallId),
              toolName: String(payload.toolName ?? ''),
            })
          } else if (payload.type === 'error') errorEvent = JSON.stringify(payload).slice(0, 200)
        } catch {
          // 心跳等非 JSON 行
        }
      }
      index = buffer.indexOf('\n\n')
    }
  }
  return { confirms, finished, errorEvent }
}

/**
 * 数据应用冒烟：清理历次 run 留下的「读书笔记」应用/草稿。
 *
 * 为什么必须清理：草稿上限 3 个（R91），L 用例每次重试都会新建草稿；不清理则第 2/3 次重试
 * 直接被 50002 挡住（首轮实测暴露：3 次重试分别 app / app(1) / app(2)，第三次建应用即失败）。
 */
const SMOKE_APP_NAME = '读书笔记'

async function cleanupSmokeApps(token: string): Promise<number> {
  try {
    const apps = await api<Array<{ appCode: string; name: string }>>(token, '/api/app')
    const targets = apps.filter((item) => item.name.includes(SMOKE_APP_NAME))
    for (const target of targets) {
      await api(token, `/api/app/${target.appCode}`, { method: 'DELETE' })
    }
    return targets.length
  } catch {
    return 0
  }
}

/**
 * L 用例的推进消息：实测模型每条用户消息只推进 1~2 个写工具就停下（会先汇报进度或询问），
 * 需要像真实用户一样继续对话；每条推进消息后同样自动批准新出现的确认卡。
 */
const APP_FLOW_FOLLOW_UPS = [
  '继续完成这个数据应用：补齐剩余的表（笔记表，含内容字段并关联到书），再生成一个管理页面。',
  '继续：为这个数据应用生成管理页面（gen_admin_page）。',
  '继续：确认这个数据应用入册（confirm_data_app）。',
]

/**
 * 跑一遍数据应用创建链：首发消息 → 逐张确认卡自动批准（app 组写工具）→ 按需追加推进消息
 * （每次同样批准新确认卡），直到 confirm_data_app 执行或推进消息用尽；返回被确认的工具名集合。
 */
async function runAppToolFlow(
  token: string,
  modelId: number,
  prompt: string,
): Promise<{ calledTools: string[]; errorEvent: string | null }> {
  const called = new Set<string>()
  let errorEvent: string | null = null

  const drain = async (confirms: StreamConfirm[]): Promise<void> => {
    const queue = [...confirms]
    let rounds = 0
    while (queue.length > 0 && rounds < 12) {
      const next = queue.shift()!
      called.add(next.toolName)
      const follow = await confirmTool(token, next.toolCallId, true)
      if (follow.errorEvent) errorEvent = follow.errorEvent
      for (const confirm of follow.confirms) queue.push(confirm)
      rounds += 1
    }
  }

  const first = await chat(token, modelId, prompt)
  if (first.errorEvent) errorEvent = first.errorEvent
  await drain(first.confirms)

  // 关键：追加推进消息必须续接**同一会话**（不带 conversationId 会新开会话，模型丢失上下文，
  // 实测表现为只会重新 create_data_app/add_table，永远推进不到 gen_admin_page）
  const conversationId = first.conversationId
  for (const message of APP_FLOW_FOLLOW_UPS) {
    if (called.has('confirm_data_app')) break
    const outcome = await chat(token, modelId, message, undefined, conversationId)
    if (outcome.errorEvent) errorEvent = outcome.errorEvent
    await drain(outcome.confirms)
  }
  return { calledTools: [...called], errorEvent }
}

/** 自 cloud_file 向上拼出相对云盘根的路径（AI 工具按 path 寻址） */
async function resolveCloudPath(
  prisma: PrismaClient,
  userId: bigint,
  name: string,
  parentId: bigint,
): Promise<string> {
  const segments = [name]
  let cursor = parentId
  for (let depth = 0; depth < 10 && cursor !== USER_ROOT_ID; depth += 1) {
    const parent = await prisma.cloudFile.findFirst({
      where: { id: cursor, userId },
      select: { name: true, parentId: true },
    })
    if (!parent) break
    segments.unshift(parent.name)
    cursor = parent.parentId
  }
  return segments.join('/')
}

/** 失败诊断：把流状态拼进原因，便于区分「模型没调工具」与「上游/预检报错」 */
function withStreamHint(reason: string, outcome: StreamOutcome): string {
  if (outcome.errorEvent) return `${reason}｜服务端 error：${outcome.errorEvent}`
  if (!outcome.finished) return `${reason}｜流未收到 done（${outcome.bytes} 字节）`
  return reason
}

async function main(): Promise<void> {
  loadEnvFromCwd()
  const prisma = new PrismaClient()
  const failures: string[] = []
  let passed = 0
  const report = (label: string, result: CheckResult): void => {
    if (result.ok) {
      passed += 1
      console.log(`  ✓ ${label} — ${result.reason}`)
    } else {
      failures.push(`${label}：${result.reason}`)
      console.log(`  ✗ ${label} — ${result.reason}`)
    }
  }

  try {
    // 前置 1：API 可达
    try {
      const health = await fetch(`${BASE}/api/docs`)
      if (!health.ok) throw new Error(`HTTP ${health.status}`)
    } catch (error) {
      console.error(`前置不满足：API 不可达（${BASE}/api/docs）—— ${(error as Error).message}`)
      console.error('请先启动 MySQL/Redis 与 API 实例（apps/api: pnpm start:prod）。')
      process.exitCode = 2
      return
    }

    const token = await login()
    const user = await prisma.sysUser.findFirst({ where: { username: USERNAME }, select: { id: true } })
    if (!user) {
      console.error(`前置不满足：账号 ${USERNAME} 不存在`)
      process.exitCode = 2
      return
    }
    const userId = user.id

    // 前置 2：可用模型（启用 + 支持工具 + 厂商有 API Key）
    const models = await prisma.aiModel.findMany({
      where: { status: 1, supportTool: 1, provider: { status: 1 } },
      orderBy: { id: 'asc' },
      include: { provider: { select: { name: true, code: true, apiKey: true } } },
    })
    const model = models.find((item) => (item.provider.apiKey ?? '').trim() !== '')
    if (!model) {
      console.error('前置不满足：无可用模型（需 support_tool=1 且状态启用的模型，且其厂商已填 API Key）')
      console.error('请在「AI 管理 → 厂商模型」配置后重跑。')
      process.exitCode = 2
      return
    }
    // Prisma 主键是 BigInt：JSON.stringify 不接受，故出参前转 number
    const modelId = Number(model.id)
    console.log(`冒烟开始：${BASE}｜账号 ${USERNAME}（#${userId}）｜模型 ${model.displayName}（#${modelId}）\n`)

    // 用例 F：一键排版（read 级，自动执行）
    console.log('F. format_site_article（排版）')
    {
      const prompt = '请对这段正文一键排版：iplat平台在2026年9月上线了3个新功能,效果不错...'
      let lastReason = '未执行'
      let done = false
      for (let attempt = 1; attempt <= MAX_ATTEMPT && !done; attempt += 1) {
        const since = new Date()
        const outcome = await chat(token, modelId, prompt)
        const result = await assertToolCall(prisma, userId, 'format_site_article', since, (params, res) => {
          if (typeof params.contentMd !== 'string' || params.contentMd.length === 0) {
            return 'params.contentMd 缺失或非字符串'
          }
          if (!res.includes('"contentMd"')) return `result 未含排版后全文（${res.slice(0, 80)}）`
          if (!res.includes('"stats"')) return 'result 未含 stats（规则统计）'
          return null
        })
        if (result.ok) {
          report('F 排版工具被调用且成功落库', result)
          done = true
          break
        }
        lastReason = withStreamHint(result.reason, outcome)
        console.log(`  · 第 ${attempt}/${MAX_ATTEMPT} 次未通过：${lastReason}`)
        if (attempt < MAX_ATTEMPT) await sleep(RETRY_DELAY_MS)
      }
      if (!done) report('F 排版工具被调用且成功落库', { ok: false, reason: lastReason })
    }

    // 用例 I：云盘文件导入（需要一份 md/markdown/txt；无则跳过）
    console.log('I. import_site_article（导入解析）')
    // 候选过滤：排除附件夹具目录（J/K 的夹具含 >2MB 大文件，导入链上限 2MB 会被 30013 拒），并限体积 ≤2MB
    const attachmentDirId = await ensureAttachmentDir(token)
    const candidate = await prisma.cloudFile.findFirst({
      where: {
        userId,
        deletedAt: null,
        isDir: 0,
        ext: { in: ['md', 'markdown', 'txt'] },
        size: { lte: BigInt(2 * 1024 * 1024) },
        parentId: { not: BigInt(attachmentDirId) },
      },
      orderBy: { id: 'desc' },
      select: { name: true, parentId: true, size: true },
    })
    if (!candidate) {
      console.log('  · 跳过：云盘里没有 md/markdown/txt 文件（先上传一个再重跑可覆盖本用例）')
    } else {
      const path = await resolveCloudPath(prisma, userId, candidate.name, candidate.parentId)
      console.log(`  · 使用文件：${path}（${Number(candidate.size)} 字节）`)
      let lastReason = '未执行'
      let done = false
      for (let attempt = 1; attempt <= MAX_ATTEMPT && !done; attempt += 1) {
        const since = new Date()
        const outcome = await chat(token, modelId, `把云盘里的 ${path} 导入成文章草稿`)
        const result = await assertToolCall(prisma, userId, 'import_site_article', since, (params, res) => {
          const hasPath = typeof params.path === 'string' && params.path.length > 0
          // 模型可能给数字或纯数字字符串（工具层 readNumParam 两者都收）
          const hasId = typeof params.fileId === 'number' || typeof params.fileId === 'string'
          if (!hasPath && !hasId) return 'params 既无 path 也无 fileId（寻址参数喂不进去）'
          if (!res.includes('"ok":true')) return `result 非成功（${res.slice(0, 80)}）`
          if (!res.includes('"contentMd"') && !res.includes('"title"')) return 'result 未含解析结果（title/contentMd）'
          return null
        })
        if (result.ok) {
          report('I 导入工具被调用且成功落库', result)
          done = true
          break
        }
        lastReason = withStreamHint(result.reason, outcome)
        console.log(`  · 第 ${attempt}/${MAX_ATTEMPT} 次未通过：${lastReason}`)
        if (attempt < MAX_ATTEMPT) await sleep(RETRY_DELAY_MS)
      }
      if (!done) report('I 导入工具被调用且成功落库', { ok: false, reason: lastReason })
    }

    // 用例 J：附件 inject（P10 T99 验收 1）——小文件全文注入，模型无需调工具即可答出文件内核对码
    console.log('J. 附件 inject（小文件全文注入）')
    {
      const fixture = injectFixtureContent()
      try {
        const fileId = await ensureFixture(token, INJECT_FIXTURE, fixture)
        console.log(`  · 夹具附件 #${fileId}（${fixture.length} 字符，${ATTACHMENT_DIR}/${INJECT_FIXTURE}）`)
        let lastReason = '未执行'
        let done = false
        for (let attempt = 1; attempt <= MAX_ATTEMPT && !done; attempt += 1) {
          const outcome = await chat(
            token,
            modelId,
            '请读一下我附带的文件，其中有一个核对码，只回答核对码本身。',
            [{ fileId }],
          )
          const target = metaAttachments(outcome).find((item) => item.fileId === fileId)
          let result: CheckResult
          if (!target) {
            result = { ok: false, reason: withStreamHint('meta.attachments 未包含本次附件', outcome) }
          } else if (target.mode !== 'inject') {
            result = { ok: false, reason: `附件被分流为 ${target.mode}（小文件应为 inject）` }
          } else if (!outcome.content.includes(INJECT_MARKER)) {
            result = { ok: false, reason: `模型回复未含核对码（${outcome.content.slice(0, 80)}）` }
          } else {
            result = { ok: true, reason: `mode=inject / ${target.chars} 字符，模型答出核对码` }
          }
          if (result.ok) {
            report('J 小附件全文注入且模型正确引用', result)
            done = true
            break
          }
          lastReason = result.reason
          console.log(`  · 第 ${attempt}/${MAX_ATTEMPT} 次未通过：${lastReason}`)
          if (attempt < MAX_ATTEMPT) await sleep(RETRY_DELAY_MS)
        }
        if (!done) report('J 小附件全文注入且模型正确引用', { ok: false, reason: lastReason })
      } catch (error) {
        report('J 小附件全文注入且模型正确引用', {
          ok: false,
          reason: `夹具准备失败：${(error as Error).message}`,
        })
      }
    }

    // 用例 K：附件 listed（P10 T99 验收 2）——大文件走清单，模型须**主动**调 read_cloud_file 分段读到末尾
    console.log('K. 附件 listed（大文件清单自读）')
    {
      const fixture = listedFixtureContent()
      try {
        const fileId = await ensureFixture(token, LISTED_FIXTURE, fixture)
        console.log(`  · 夹具附件 #${fileId}（${fixture.length} 字符，核对码在文件末尾）`)
        let lastReason = '未执行'
        let done = false
        for (let attempt = 1; attempt <= MAX_ATTEMPT && !done; attempt += 1) {
          const since = new Date()
          const outcome = await chat(
            token,
            modelId,
            '我附带了一个较大的文本文件，其末尾有一个核对码。请用工具按路径分段读取该文件'
              + '（本会话附带文件清单里有它的路径），然后只回答核对码本身。',
            [{ fileId }],
          )
          const target = metaAttachments(outcome).find((item) => item.fileId === fileId)
          let result: CheckResult
          if (!target) {
            result = { ok: false, reason: withStreamHint('meta.attachments 未包含本次附件', outcome) }
          } else if (target.mode !== 'listed') {
            result = { ok: false, reason: `附件被分流为 ${target.mode}（>3 万字符应为 listed）` }
          } else {
            const call = await assertToolCall(prisma, userId, 'read_cloud_file', since, (params, res) => {
              if (params.offsetChars === undefined && params.maxChars === undefined) {
                return '未带分页参数（offsetChars / maxChars）'
              }
              if (!res.includes('"totalChars"')) return 'result 未含 totalChars'
              if (!res.includes('"truncated"')) return 'result 未含 truncated'
              return null
            })
            if (!call.ok) {
              result = { ok: false, reason: withStreamHint(call.reason, outcome) }
            } else if (!outcome.content.includes(LISTED_MARKER)) {
              result = { ok: false, reason: `模型回复未含末尾核对码（${outcome.content.slice(0, 80)}）` }
            } else {
              result = { ok: true, reason: `mode=listed / ${call.reason} / 模型答出末尾核对码` }
            }
          }
          if (result.ok) {
            report('K 大文件清单自读（read_cloud_file 分页）', result)
            done = true
            break
          }
          lastReason = result.reason
          console.log(`  · 第 ${attempt}/${MAX_ATTEMPT} 次未通过：${lastReason}`)
          if (attempt < MAX_ATTEMPT) await sleep(RETRY_DELAY_MS)
        }
        if (!done) report('K 大文件清单自读（read_cloud_file 分页）', { ok: false, reason: lastReason })
      } catch (error) {
        report('K 大文件清单自读（read_cloud_file 分页）', {
          ok: false,
          reason: `夹具准备失败：${(error as Error).message}`,
        })
      }
    }

    // 用例 L：数据应用创建链（P11 T105 / R98）——create_data_app → add_table → gen_admin_page → confirm_data_app
    console.log('L. 数据应用（create_data_app / add_table / gen_admin_page / confirm_data_app）')
    {
      const prompt =
        '帮我建一个读书笔记数据应用：书（书名/作者/评分）和笔记（内容/关联书），再生成管理页面，最后确认入册。'
      // 前置清理：释放历次 run 占用的草稿额度（否则第 2/3 次重试被 50002 挡）
      const cleaned = await cleanupSmokeApps(token)
      if (cleaned > 0) console.log(`  · 已清理历史「${SMOKE_APP_NAME}」应用/草稿 ${cleaned} 个`)
      let lastReason = '未执行'
      let done = false
      for (let attempt = 1; attempt <= MAX_ATTEMPT && !done; attempt += 1) {
        const since = new Date()
        const flow = await runAppToolFlow(token, modelId, prompt)
        const app = await prisma.appDef.findFirst({
          where: { ownerId: userId, createdAt: { gte: since } },
          orderBy: { id: 'desc' },
        })
        const calls = await prisma.aiToolCall.findMany({
          where: {
            userId,
            createdAt: { gte: since },
            toolName: { in: [...APP_WRITE_TOOLS] },
            status: 'executed',
          },
          select: { toolName: true },
        })
        const executed = new Set(calls.map((call) => call.toolName))
        if (!app) {
          lastReason = `app_def 未落库（已确认工具：${flow.calledTools.join('、') || '无'}${flow.errorEvent ? `；${flow.errorEvent}` : ''}）`
        } else if (app.status !== 'active') {
          lastReason = `app_def 状态=${app.status}（应 active；已执行：${[...executed].join('、') || '无'}）`
        } else if (
          !executed.has('create_data_app') ||
          !executed.has('add_table') ||
          !executed.has('gen_admin_page')
        ) {
          lastReason = `app 组工具执行不全：${[...executed].join('、') || '无'}`
        } else {
          const tables = await prisma.appTable.count({
            where: { appId: app.id, deletedAt: null, isSystem: 0 },
          })
          if (tables === 0) {
            lastReason = 'app_table 未落库'
          } else {
            report('L 数据应用创建链（草稿→入册）', {
              ok: true,
              reason: `app=${app.code} status=active / ${tables} 张表 / 工具=${[...executed].join('、')}`,
            })
            done = true
            break
          }
        }
        console.log(`  · 第 ${attempt}/${MAX_ATTEMPT} 次未通过：${lastReason}`)
        if (attempt < MAX_ATTEMPT) await sleep(RETRY_DELAY_MS)
      }
      if (!done) report('L 数据应用创建链（草稿→入册）', { ok: false, reason: lastReason })
      // 收尾清理：不把冒烟产生的应用/草稿留在库里（占用正式额度与草稿额度）
      const finalCleaned = await cleanupSmokeApps(token)
      if (finalCleaned > 0) console.log(`  · 已清理本轮「${SMOKE_APP_NAME}」应用 ${finalCleaned} 个`)
    }

    console.log(`\n冒烟结果：通过 ${passed} 项，失败 ${failures.length} 项`)
    if (failures.length > 0) {
      console.error('失败明细：')
      for (const detail of failures) console.error(`  - ${detail}`)
      process.exitCode = 1
    }
  } catch (error) {
    console.error(`冒烟异常终止：${(error as Error).message}`)
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

void main()
