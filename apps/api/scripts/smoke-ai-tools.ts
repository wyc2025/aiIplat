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
  /** 是否收到 event: done */
  finished: boolean
  /** event: error 的内容（上游/预检失败时给诊断线索） */
  errorEvent: string | null
  /** 收到的字节数（0 = 流几乎没内容） */
  bytes: number
}

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
 * 判定结论一律以 ai_tool_call 落库为准；本函数只负责「等模型跑完」并收集失败诊断信息。
 */
async function chat(token: string, modelId: number, content: string): Promise<StreamOutcome> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS)
  const outcome: StreamOutcome = { finished: false, errorEvent: null, bytes: 0 }
  try {
    const res = await fetch(`${BASE}/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ modelId, content }),
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
        const eventName = /^event:\s*(.+)$/m.exec(rawEvent)?.[1]?.trim()
        if (eventName === 'done') outcome.finished = true
        if (eventName === 'error') {
          const data = /^data:\s*(.+)$/m.exec(rawEvent)?.[1]?.trim() ?? ''
          outcome.errorEvent = data.slice(0, 200)
        }
        index = buffer.indexOf('\n\n')
      }
    }
    return outcome
  } finally {
    clearTimeout(timer)
  }
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
    const candidate = await prisma.cloudFile.findFirst({
      where: { userId, deletedAt: null, isDir: 0, ext: { in: ['md', 'markdown', 'txt'] } },
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
