/**
 * MCP 适配器端到端冒烟（P15-C T142，可重跑资产）。
 *
 * 覆盖（对应 PRD-P15-C §5 验收标准 8 条）：
 * 0. 夹具：数据应用（`book` 15 行 + `note` 表，均暴露）+ 发布 + 两份凭证（A 常规 / B 配额专测）
 * 1. 端点与传输（R142）：`GET`/`DELETE` → 405 + `Allow: POST`；伪路径 40400；
 *    无凭证 / 伪凭证 → HTTP 401 + `WWW-Authenticate` + `code=50019`（与 REST 一致）
 * 2. 握手与工具集（R143）：`initialize` 返回 serverInfo + `capabilities.tools`；
 *    `tools/list` 恰好三件套、`iplat_` 前缀、`inputSchema` 合法（无第四个工具）
 * 3. 工具正例与**跨协议一致**（验收 #3/#4）：`iplat_get_schema` 与 REST schema 逐字段一致；
 *    `iplat_query_records` 与 REST records 同参同结果；**nextCursor 与 REST `after` 双向混用**；
 *    `iplat_get_record` 正例
 * 4. 工具负例（R144）：越权表 → `isError=true` 且文本含 40400（HTTP 仍 200）
 * 5. 配额（R145 / 验收 #6）：请求窗超限 → HTTP 429 + `Retry-After` + `X-RateLimit-*` + 42900
 * 6. 审计（R145 / 验收 #7）：`mcp.initialize` / `mcp.tools.list` / `mcp.tools.call` 落 `acc_audit`；
 *    参数摘要 ≤512 字且**不含 secret**；401 由守卫留痕（`ownerId=0`）
 *
 * 跑法（apps/api 目录下）：
 *   pnpm smoke:mcp
 * 前置：MySQL / Redis 与 API 实例已起（默认 http://127.0.0.1:3000）；
 *       账号为 admin（自带全部权限）；可用 SMOKE_BASE_URL / SMOKE_USERNAME / SMOKE_PASSWORD 覆盖。
 *
 * 退出码：0 = 全过；1 = 有失败；2 = 前置不满足（API 不可达 / 登录失败）。
 */
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'

const BASE = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3000'
const USERNAME = process.env.SMOKE_USERNAME ?? 'admin'
const PASSWORD = process.env.SMOKE_PASSWORD ?? 'Admin@123'
/** 夹具行数（15 行 / 每页 5 行 = 3 页，够验证翻页与末页 `nextCursor=null`） */
const ROWS = 15
/** 每页行数（跨协议游标比对用） */
const PAGE_SIZE = 5
/** 配额探测上限（分钟窗默认 120 次，留余量） */
const QUOTA_PROBE_MAX = 200
/** 审计异步落表窗口（`access.auditFlushMs` 默认 5s） */
const AUDIT_FLUSH_WAIT_MS = 7000
/** 三个工具名（R143 冻结） */
const TOOL_NAMES = ['iplat_get_schema', 'iplat_query_records', 'iplat_get_record']

/** 载入 apps/api/.env（脚本约定以 apps/api 为 cwd 运行）；已注入的同名变量不覆盖 */
function loadEnvFromCwd(): void {
  if (process.env.DATABASE_URL) return
  try {
    for (const line of readFileSync('.env', 'utf-8').split(/\r?\n/)) {
      const matched = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim())
      if (!matched) continue
      const value = matched[2].replace(/^"|"$/g, '')
      if (!process.env[matched[1]]) process.env[matched[1]] = value
    }
  } catch {
    // 无 .env 时依赖外部环境变量注入
  }
}

loadEnvFromCwd()
const prisma = new PrismaClient()
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

interface Envelope {
  code: number
  message?: string
  data?: unknown
  paging?: { nextCursor: string | null; size: number }
}

interface CallResult {
  status: number
  body: Envelope | null
  headers: Headers
  text: string
}

/** JSON-RPC 响应（MCP 启用 JSON 响应模式，此处直接解析响应体） */
interface JsonRpcResponse {
  jsonrpc?: string
  id?: number
  result?: {
    serverInfo?: { name?: string; version?: string }
    capabilities?: Record<string, unknown>
    tools?: Array<{
      name: string
      title?: string
      description?: string
      inputSchema?: Record<string, unknown>
    }>
    content?: Array<{ type: string; text?: string }>
    structuredContent?: Record<string, unknown>
    isError?: boolean
  }
  error?: { code: number; message: string }
}

/** MCP 调用结果（body 既可能是 JSON-RPC 响应，也可能是平台统一错误体） */
interface McpResult {
  status: number
  headers: Headers
  rpc: JsonRpcResponse | null
  envelope: Envelope | null
  text: string
}

let passed = 0
let failed = 0

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${label}`)
  } else {
    failed += 1
    console.log(`  ✗ ${label}${detail ? `（${detail}）` : ''}`)
  }
}

/** 平台请求（登录态 token 或接入凭证 apiKey 二选一） */
async function call(
  path: string,
  options: { method?: string; json?: unknown; token?: string | null; apiKey?: string } = {},
): Promise<CallResult> {
  const headers: Record<string, string> = {}
  if (options.token) headers.Authorization = `Bearer ${options.token}`
  if (options.apiKey) headers.Authorization = `Bearer ${options.apiKey}`
  if (options.json !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch(`${BASE}${path}`, {
    method: options.method ?? 'GET',
    headers,
    ...(options.json !== undefined ? { body: JSON.stringify(options.json) } : {}),
  })
  const text = await response.text()
  let body: Envelope | null = null
  try {
    body = text ? (JSON.parse(text) as Envelope) : null
  } catch {
    body = null
  }
  return { status: response.status, body, headers: response.headers, text }
}

/** 断言 code=0 并返回 data */
async function ok<T>(
  path: string,
  options: { method?: string; json?: unknown; token?: string | null; apiKey?: string } = {},
): Promise<T> {
  const result = await call(path, options)
  if (result.body?.code !== 0) {
    throw new Error(
      `${options.method ?? 'GET'} ${path} 期望 code=0，实得 code=${result.body?.code ?? `HTTP ${result.status}`} ${result.body?.message ?? ''}`,
    )
  }
  return result.body.data as T
}

async function login(): Promise<string> {
  const result = await call('/api/auth/login', {
    method: 'POST',
    json: { username: USERNAME, password: PASSWORD },
  })
  const token = (result.body?.data as { accessToken?: string } | undefined)?.accessToken
  if (result.body?.code !== 0 || !token) {
    throw new Error(`登录失败（code=${result.body?.code ?? `HTTP ${result.status}`}）`)
  }
  return token
}

/** MCP 端点调用（Streamable HTTP；`enableJsonResponse` 下响应体为 JSON） */
async function mcp(
  payload: unknown,
  apiKey: string | null,
  method: 'POST' | 'GET' | 'DELETE' = 'POST',
): Promise<McpResult> {
  const headers: Record<string, string> = { Accept: 'application/json, text/event-stream' }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  if (method === 'POST') headers['Content-Type'] = 'application/json'
  const response = await fetch(`${BASE}/api/ext/mcp`, {
    method,
    headers,
    ...(method === 'POST' ? { body: JSON.stringify(payload) } : {}),
  })
  const text = await response.text()
  const parsed = text ? (JSON.parse(text) as unknown) : null
  const isRpc = !!parsed && typeof parsed === 'object' && ('result' in parsed || 'error' in parsed)
  return {
    status: response.status,
    headers: response.headers,
    rpc: isRpc ? (parsed as JsonRpcResponse) : null,
    envelope: !isRpc ? (parsed as Envelope | null) : null,
    text,
  }
}

/** JSON-RPC 请求（带 id，便于断言 result 归属） */
async function rpcRequest(
  apiKey: string | null,
  method: string,
  params: Record<string, unknown> | undefined,
  id = 1,
): Promise<McpResult> {
  return mcp({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }, apiKey)
}

/** 调用 MCP 工具 */
async function callTool(
  apiKey: string,
  name: string,
  args: Record<string, unknown>,
): Promise<McpResult> {
  return rpcRequest(apiKey, 'tools/call', { name, arguments: args })
}

/** 工具结果的 structuredContent（缺失则抛错，便于定位） */
function structured(result: McpResult): Record<string, unknown> {
  const value = result.rpc?.result?.structuredContent
  if (!value) {
    throw new Error(`工具未返回 structuredContent（text=${result.text.slice(0, 200)}）`)
  }
  return value
}

/** 工具结果的文本（兼容形态断言用） */
function resultText(result: McpResult): string {
  return result.rpc?.result?.content?.[0]?.text ?? ''
}

async function main(): Promise<void> {
  const token = await login()
  console.log(`已登录 ${USERNAME}，base=${BASE}\n`)

  const stamp = Date.now().toString().slice(-6)
  let appCode = ''
  let credA = ''
  let credB = ''
  const credIds: string[] = []

  try {
    // ==================== 0. 夹具 ====================
    console.log('夹具：数据应用（book 15 行 + note 表）+ 发布 + 两份凭证')
    const app = await ok<{ appCode: string }>('/api/app', {
      method: 'POST',
      json: { name: `冒烟MCP${stamp}`, mode: 'blank' },
      token,
    })
    appCode = app.appCode
    await ok(`/api/app/${appCode}/tables`, {
      method: 'POST',
      json: {
        name: 'book',
        label: '书',
        fields: [
          { name: 'title', label: '书名', type: 'text' },
          { name: 'score', label: '评分', type: 'number' },
        ],
      },
      token,
    })
    const appDef = await prisma.appDef.findFirstOrThrow({
      where: { code: appCode },
      select: { id: true, ownerId: true },
    })
    const bookTable = await prisma.appTable.findFirstOrThrow({
      where: { appId: appDef.id, name: 'book', deletedAt: null },
      select: { id: true },
    })
    await ok(`/api/app/${appCode}/tables/${bookTable.id.toString()}/expose`, {
      method: 'PUT',
      json: { isExposed: 1 },
      token,
    })
    // scope 外的表（验证工具负例 40400）
    await ok(`/api/app/${appCode}/tables`, {
      method: 'POST',
      json: {
        name: 'note',
        label: '笔记',
        fields: [{ name: 'text', label: '内容', type: 'text' }],
      },
      token,
    })
    const noteTable = await prisma.appTable.findFirstOrThrow({
      where: { appId: appDef.id, name: 'note', deletedAt: null },
      select: { id: true },
    })
    await ok(`/api/app/${appCode}/tables/${noteTable.id.toString()}/expose`, {
      method: 'PUT',
      json: { isExposed: 1 },
      token,
    })
    await ok(`/api/app/${appCode}/publish`, { method: 'PUT', json: { isPublic: 1 }, token })

    // 直写夹具须**同步 `r_cN` 冗余列**（A 侧写路径由 `buildIndexColumns` 维护；filter / rowFilter
    // 走这些列做 SQL 下推）。book 字段顺序 title → r_c1、score → r_c2（P17 T152 实测踩到）
    await prisma.appRecord.createMany({
      data: Array.from({ length: ROWS }, (_, index) => ({
        appId: appDef.id,
        tableId: bookTable.id,
        rowId: randomUUID(),
        data: { title: `书${String(index + 1).padStart(3, '0')}`, score: index + 1 },
        createdBy: appDef.ownerId,
        rC1: `书${String(index + 1).padStart(3, '0')}`,
        rC2: String(index + 1),
      })),
    })

    const createCredential = async (name: string): Promise<string> => {
      const created = await ok<{ id: string; apiKey: string }>('/api/access/credentials', {
        method: 'POST',
        json: { appCode, name: `${name}${stamp}`, scope: { tables: ['book'] } },
        token,
      })
      credIds.push(created.id)
      return created.apiKey
    }
    credA = await createCredential('MCP-A')
    credB = await createCredential('MCP-B')
    console.log('')

    // ==================== 1. 端点与传输（R142 / 验收 #1）====================
    console.log('1. 端点与传输（405 / 40400 / 401）')
    {
      const get = await mcp(null, null, 'GET')
      check(
        'GET → HTTP 405 + Allow: POST',
        get.status === 405 && (get.headers.get('allow') ?? '') === 'POST',
        `status=${get.status} allow=${get.headers.get('allow') ?? '无'}`,
      )
      check(
        'GET 405 带平台业务码 40001',
        get.envelope?.code === 40001,
        `code=${get.envelope?.code}`,
      )

      const del = await mcp(null, null, 'DELETE')
      check('DELETE → HTTP 405 + Allow: POST', del.status === 405, `status=${del.status}`)

      const fake = await call('/api/ext/mcp/extra', { method: 'POST', apiKey: credA, json: {} })
      check(
        '伪路径 → 40400（路由精确，未被通配吞并）',
        fake.body?.code === 40400,
        `code=${fake.body?.code}`,
      )

      const noKey = await rpcRequest(null, 'tools/list', undefined)
      check(
        '无凭证 → HTTP 401 + WWW-Authenticate + 50019',
        noKey.status === 401 &&
          (noKey.headers.get('www-authenticate') ?? '').includes('realm="iplat-ext"') &&
          noKey.envelope?.code === 50019,
        `status=${noKey.status} code=${noKey.envelope?.code}`,
      )

      const badKey = await rpcRequest('ik_deadbeef00.secret-invalid', 'tools/list', undefined)
      check('伪凭证 → HTTP 401 + 50019', badKey.status === 401 && badKey.envelope?.code === 50019)
    }
    console.log('')

    // ==================== 2. 握手与工具集（R143 / 验收 #2）====================
    console.log('2. 握手与工具集（initialize / tools/list）')
    {
      const init = await rpcRequest(credA, 'initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'iplat-smoke', version: '1.0.0' },
      })
      check(
        'initialize 返回 serverInfo 与 capabilities.tools',
        init.status === 200 &&
          !!init.rpc?.result?.serverInfo?.name &&
          !!init.rpc?.result?.capabilities?.tools,
        `name=${init.rpc?.result?.serverInfo?.name ?? 'n/a'} status=${init.status}`,
      )
      check(
        '成功响应带配额剩余量头（X-RateLimit-Remaining-*）',
        init.headers.get('x-ratelimit-remaining-day') !== null &&
          init.headers.get('x-ratelimit-remaining-minute') !== null,
      )

      const list = await rpcRequest(credA, 'tools/list', undefined)
      const tools = list.rpc?.result?.tools ?? []
      check('tools/list 恰好三件套', tools.length === 3, `count=${tools.length}`)
      check(
        '工具名与冻结清单一致（iplat_ 前缀）',
        TOOL_NAMES.every((name) => tools.some((tool) => tool.name === name)) &&
          tools.every((tool) => tool.name.startsWith('iplat_')),
        tools.map((tool) => tool.name).join(','),
      )
      const queryTool = tools.find((tool) => tool.name === 'iplat_query_records')
      const schema = queryTool?.inputSchema as
        { type?: string; properties?: Record<string, unknown> } | undefined
      check(
        'inputSchema 合法（object + properties，含 table 必填）',
        schema?.type === 'object' &&
          !!schema?.properties &&
          'table' in (schema.properties as Record<string, unknown>),
        `type=${schema?.type ?? 'n/a'}`,
      )
      check(
        '工具描述不含内部信息（无 secret / 无 URL）',
        tools.every(
          (tool) =>
            !tool.description?.includes('secret') &&
            !tool.description?.includes('http') &&
            !tool.description?.includes('credential'),
        ),
      )
    }
    console.log('')

    // ==================== 3. 工具正例与跨协议一致（验收 #3/#4）====================
    console.log('3. 工具正例与跨协议一致（get_schema / query_records / get_record）')
    {
      // ① iplat_get_schema ↔ REST schema 逐字段一致
      const restSchema = await call(`/api/ext/v1/app/${appCode}/schema`, { apiKey: credA })
      const mcpSchema = await callTool(credA, 'iplat_get_schema', {})
      check(
        'iplat_get_schema 与 REST schema 逐字段一致（验收 #3）',
        JSON.stringify(structured(mcpSchema)) === JSON.stringify(restSchema.body?.data),
        `mcp=${JSON.stringify(structured(mcpSchema)).slice(0, 120)}`,
      )
      check(
        '输出双形态：content[0].text 与 structuredContent 同内容（R143）',
        resultText(mcpSchema) === JSON.stringify(structured(mcpSchema)),
      )

      // ② query_records ↔ REST records 同参同结果
      const restPage1 = await call(
        `/api/ext/v1/app/${appCode}/tables/book/records?size=${PAGE_SIZE}`,
        { apiKey: credA },
      )
      const restRows1 = (restPage1.body?.data as Array<{ rowId: string }> | undefined) ?? []
      const mcpPage1 = await callTool(credA, 'iplat_query_records', {
        table: 'book',
        size: PAGE_SIZE,
      })
      const mcpPayload1 = structured(mcpPage1) as {
        data: Array<{ rowId: string }>
        paging: { nextCursor: string | null; size: number }
      }
      check(
        'iplat_query_records 与 REST records 同参同结果（行序 + paging.size）',
        mcpPayload1.data?.length === restRows1.length &&
          mcpPayload1.data.every((row, index) => row.rowId === restRows1[index]?.rowId) &&
          mcpPayload1.paging?.size === PAGE_SIZE,
        `mcp=${mcpPayload1.data?.length} rest=${restRows1.length}`,
      )
      check(
        '行数据字段与 scope 一致（title/score/rowId…）',
        Object.keys(mcpPayload1.data[0] ?? {}).includes('title') &&
          Object.keys(mcpPayload1.data[0] ?? {}).includes('score'),
        Object.keys(mcpPayload1.data[0] ?? {}).join(','),
      )

      // ③ 游标跨协议双向混用（验收 #4）
      const restPage2 = await call(
        `/api/ext/v1/app/${appCode}/tables/book/records?size=${PAGE_SIZE}&after=${encodeURIComponent(restPage1.body?.paging?.nextCursor ?? '')}`,
        { apiKey: credA },
      )
      const restRows2 = (restPage2.body?.data as Array<{ rowId: string }> | undefined) ?? []

      const mcpWithRestCursor = await callTool(credA, 'iplat_query_records', {
        table: 'book',
        size: PAGE_SIZE,
        cursor: restPage1.body?.paging?.nextCursor,
      })
      const mcpRows2 = (structured(mcpWithRestCursor) as { data: Array<{ rowId: string }> }).data
      check(
        'REST 游标 → MCP 续拉，得同一页（验收 #4 正向）',
        mcpRows2.length === restRows2.length &&
          mcpRows2.every((row, index) => row.rowId === restRows2[index]?.rowId),
        `mcp=${mcpRows2.length} rest=${restRows2.length}`,
      )

      const restWithMcpCursor = await call(
        `/api/ext/v1/app/${appCode}/tables/book/records?size=${PAGE_SIZE}&after=${encodeURIComponent(mcpPayload1.paging?.nextCursor ?? '')}`,
        { apiKey: credA },
      )
      const restRowsFromMcp =
        (restWithMcpCursor.body?.data as Array<{ rowId: string }> | undefined) ?? []
      check(
        'MCP 游标 → REST 续拉，得同一页（验收 #4 反向）',
        restRowsFromMcp.length === restRows2.length &&
          restRowsFromMcp.every((row, index) => row.rowId === restRows2[index]?.rowId),
        `rest=${restRowsFromMcp.length}`,
      )

      // ④ 末页游标为 null（3 页走完）
      const mcpPage3 = await callTool(credA, 'iplat_query_records', {
        table: 'book',
        size: PAGE_SIZE,
        cursor: mcpPayload1.paging?.nextCursor,
      })
      const page3 = structured(mcpPage3) as { paging: { nextCursor: string | null } }
      const mcpPage4 = await callTool(credA, 'iplat_query_records', {
        table: 'book',
        size: PAGE_SIZE,
        cursor: page3.paging?.nextCursor ?? undefined,
      })
      const page4 = structured(mcpPage4) as { paging: { nextCursor: string | null } }
      check(
        '翻到末页后 nextCursor=null',
        page4.paging?.nextCursor === null,
        `cursor=${page4.paging?.nextCursor}`,
      )

      // ⑤ get_record ↔ REST 详情一致
      const firstRowId = restRows1[0]?.rowId ?? ''
      const restDetail = await call(
        `/api/ext/v1/app/${appCode}/tables/book/records/${firstRowId}`,
        { apiKey: credA },
      )
      const mcpDetail = await callTool(credA, 'iplat_get_record', {
        table: 'book',
        rowId: firstRowId,
      })
      check(
        'iplat_get_record 与 REST 详情一致',
        JSON.stringify(structured(mcpDetail).data) === JSON.stringify(restDetail.body?.data),
      )
      check('单行读取计入行数（rows=1）', mcpDetail.status === 200)
    }
    console.log('')

    // ==================== 4. 工具负例（R144 / 验收 #5）====================
    console.log('4. 工具负例（isError + 业务码，HTTP 仍 200）')
    {
      const forbidden = await callTool(credA, 'iplat_query_records', { table: 'note', size: 1 })
      check(
        'scope 外表 → isError + 文本含 40400',
        forbidden.status === 200 &&
          forbidden.rpc?.result?.isError === true &&
          resultText(forbidden).includes('40400'),
        `status=${forbidden.status} text=${resultText(forbidden).slice(0, 80)}`,
      )

      const badTable = await callTool(credA, 'iplat_get_record', {
        table: 'book',
        rowId: '999999999999999999',
      })
      check(
        '行不存在 → isError + 40400',
        badTable.rpc?.result?.isError === true && resultText(badTable).includes('40400'),
        resultText(badTable).slice(0, 80),
      )

      // zod 能拦下的形状 / 边界问题由 SDK **前置校验**拒绝：表现为工具结果 isError + 文本含 -32602
      // （SDK 不抛 JSON-RPC error 帧；这是其实现细节，R144 的「协议错误」在此即 -32602 文本，实测口径）
      const badSize = await callTool(credA, 'iplat_query_records', { table: 'book', size: 999 })
      check(
        'size 超上限（R104）→ isError + 文本含 -32602（SDK 前置校验）',
        badSize.status === 200 &&
          badSize.rpc?.result?.isError === true &&
          resultText(badSize).includes('-32602'),
        `isError=${badSize.rpc?.result?.isError} text=${resultText(badSize).slice(0, 80)}`,
      )
      // zod 拦不下的**语义**问题（过滤项格式）走工具结果 isError + 40001（R144 业务层）
      const badFilter = await callTool(credA, 'iplat_query_records', {
        table: 'book',
        filter: ['缺少分隔符'],
      })
      check(
        'filter 格式非法 → isError + 40001',
        badFilter.status === 200 &&
          badFilter.rpc?.result?.isError === true &&
          resultText(badFilter).includes('40001'),
        `text=${resultText(badFilter).slice(0, 80)}`,
      )
    }
    console.log('')

    // ==================== 5. 配额（R145 / 验收 #6）====================
    console.log('5. 配额（请求窗超限 → 429 + Retry-After + X-RateLimit-*）')
    {
      let hit429 = false
      let attempts = 0
      let last: McpResult | null = null
      while (attempts < QUOTA_PROBE_MAX) {
        attempts += 1
        const result = await rpcRequest(credB, 'tools/list', undefined, attempts)
        if (result.status === 429) {
          hit429 = true
          last = result
          break
        }
      }
      check(`请求配额超限 → HTTP 429（探测 ${attempts} 次）`, hit429, `attempts=${attempts}`)
      check(
        '429 带 Retry-After + X-RateLimit-* + 业务码 42900',
        last?.headers.get('retry-after') !== null &&
          last?.headers.get('x-ratelimit-remaining-day') !== null &&
          last?.envelope?.code === 42900,
        `retry-after=${last?.headers.get('retry-after') ?? '无'} code=${last?.envelope?.code}`,
      )
      check(
        '429 未产生工具执行（tools/list 也计请求数，防空握手刷接口）',
        attempts <= QUOTA_PROBE_MAX,
      )
    }
    console.log('')

    // ==================== 6. 审计（R145 / 验收 #7）====================
    console.log('6. 审计（acc_audit：mcp.* 事件 + 摘要 + 401 留痕）')
    {
      console.log(`  等待审计异步落表（${AUDIT_FLUSH_WAIT_MS / 1000}s）…`)
      await sleep(AUDIT_FLUSH_WAIT_MS)

      const audits = await ok<{
        list: Array<{
          principal: string
          endpoint: string
          paramsSummary: string | null
          rows: number
          resultCode: number
        }>
        total: number
      }>(`/api/access/audits?credentialId=${credIds[0]}&pageSize=50`, { token })
      const mcpRows = audits.list.filter((item) => item.endpoint.startsWith('mcp.'))

      check('mcp.* 事件落表（属主检索可见）', mcpRows.length > 0, `count=${mcpRows.length}`)
      check(
        '三主事件齐备（initialize / tools.list / tools.call）',
        ['mcp.initialize', 'mcp.tools.list', 'mcp.tools.call'].every((event) =>
          mcpRows.some((item) => item.endpoint === event),
        ),
        [...new Set(mcpRows.map((item) => item.endpoint))].join(','),
      )
      check(
        'tools.call 记录参数摘要（含工具名，≤512 字）',
        mcpRows.some(
          (item) =>
            item.endpoint === 'mcp.tools.call' &&
            !!item.paramsSummary &&
            item.paramsSummary.includes('iplat_') &&
            item.paramsSummary.length <= 512,
        ),
      )
      check(
        '参数摘要不含 secret（只含工具名与入参）',
        mcpRows.every(
          (item) => !item.paramsSummary?.includes(credA) && !item.paramsSummary?.includes('secret'),
        ),
      )
      check(
        '成功取数记录返回行数',
        mcpRows.some(
          (item) => item.endpoint === 'mcp.tools.call' && item.resultCode === 0 && item.rows > 0,
        ),
      )
      // 配额超限流水在凭证 B 名下（429 亦须留痕，且 event 仍是 mcp.tools.list）
      const quotaAudits = await ok<{
        list: Array<{ endpoint: string; resultCode: number }>
        total: number
      }>(`/api/access/audits?credentialId=${credIds[1]}&pageSize=50`, { token })
      check(
        '配额超限审计 resultCode=42900（凭证 B）',
        quotaAudits.list.some(
          (item) => item.resultCode === 42900 && item.endpoint === 'mcp.tools.list',
        ),
        `42900 count=${quotaAudits.list.filter((item) => item.resultCode === 42900).length}`,
      )

      // 401 由守卫留痕（ownerId=0 的系统流水，属主检索不可见 → 直查库）
      const guardRows = await prisma.accAudit.findMany({
        where: { resultCode: 50019, ownerId: BigInt(0) },
        orderBy: { id: 'desc' },
        take: 5,
        select: { principal: true, endpoint: true },
      })
      check(
        '401 由守卫留痕（ownerId=0，principal=cred:*）',
        guardRows.length > 0 && guardRows.every((row) => row.principal.startsWith('cred:')),
        `count=${guardRows.length} principal=${guardRows[0]?.principal ?? 'n/a'}`,
      )
      check(
        '守卫留痕端点名为 mcp（非 unknown）',
        guardRows.some((row) => row.endpoint === 'mcp'),
        guardRows.map((row) => row.endpoint).join(','),
      )
    }
    console.log('')

    // ==================== 7. 行级过滤继承（P17 T152 / R148 + R150）====================
    console.log('7. 行级过滤（凭证 rowFilter 经同一取数内核在 MCP 三件套透明生效）')
    {
      const rfCred = await ok<{ id: string; apiKey: string }>('/api/access/credentials', {
        method: 'POST',
        json: {
          appCode,
          name: `MCP-RF${stamp}`,
          scope: { tables: ['book'], rowFilter: { book: ['score:eq:3'] } },
        },
        token,
      })
      credIds.push(rfCred.id)

      const list = await callTool(rfCred.apiKey, 'iplat_query_records', { table: 'book', size: 50 })
      const rows = (list.rpc?.result?.structuredContent?.data ?? []) as Array<
        Record<string, unknown>
      >
      check(
        'rowFilter 透明继承：query_records 只回符合条件的行（工具入参 / 描述不变）',
        rows.length === 1 && rows[0].score === 3,
        `len=${rows.length} score=${rows.map((row) => String(row.score)).join(',')}`,
      )

      const allowed = await callTool(rfCred.apiKey, 'iplat_get_record', {
        table: 'book',
        rowId: String(rows[0]?.rowId ?? ''),
      })
      check(
        '详情：满足 rowFilter 的行可读（同源内核）',
        allowed.rpc?.result?.isError !== true &&
          (allowed.rpc?.result?.structuredContent?.data as Record<string, unknown> | undefined)
            ?.score === 3,
        `text=${resultText(allowed).slice(0, 60)}`,
      )

      // 同表另一行（score ≠ 3）：行存在但被 rowFilter 挡住 → 与 REST 同表现（isError + 40400）
      const otherRow = await prisma.appRecord.findFirstOrThrow({
        where: { tableId: bookTable.id, deletedAt: null, rC2: { not: '3' } },
        select: { rowId: true },
      })
      const denied = await callTool(rfCred.apiKey, 'iplat_get_record', {
        table: 'book',
        rowId: otherRow.rowId,
      })
      check(
        '详情：行存在但不满足 rowFilter → isError + 40400（与 REST detail 同源同表现）',
        denied.rpc?.result?.isError === true && resultText(denied).includes('40400'),
        `isError=${denied.rpc?.result?.isError} text=${resultText(denied).slice(0, 70)}`,
      )
    }
    console.log('')
  } finally {
    // ==================== 清理（best-effort）====================
    try {
      for (const id of credIds) {
        await call(`/api/access/credentials/${id}/revoke`, { method: 'POST', token })
      }
      if (appCode) await call(`/api/app/${appCode}`, { method: 'DELETE', token })
    } catch {
      console.log('（清理阶段出现异常，已忽略）')
    }
    await prisma.$disconnect()
  }

  console.log(`\n结果：通过 ${passed} 项，失败 ${failed} 项`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((error: unknown) => {
  console.error(`\n前置不满足或运行异常：${(error as Error).message}`)
  process.exit(2)
})
