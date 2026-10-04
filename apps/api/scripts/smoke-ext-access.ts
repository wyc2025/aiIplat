/**
 * 对外开放接入层端到端冒烟（P15 T138，可重跑资产）。
 *
 * 覆盖（对应 PRD-P15 §6 验收标准）：
 * 1. 凭证生命周期：创建（apiKey 仅一次）/ 列表（只回显前缀）/ 详情 / 编辑 / 轮换（旧 secret 立即失效）/ 吊销
 * 2. 对外四端点：schema（scope ∩ 暴露投影）/ 列表（**游标分页，边拉边写不重不漏**）/ 详情 / 越权表 40400
 * 3. 错误语义：无凭证 401 + `WWW-Authenticate` + `code=50019`；appCode 与凭证不匹配 40400；`is_public=0` 40400
 * 4. 开放层路径收窄（D123）：被授权展示应用 200；**同站点另一未授权展示应用 40400**；旧站点级路径 404
 * 5. 审计：`acc_audit` 落表（含 401 / 40400 负例）且属主检索可用
 *
 * 跑法（apps/api 目录下）：
 *   pnpm smoke:ext
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
/** 夹具行数（游标翻页用；第一页后再追加 5 行以验证「边拉边写不重不漏」） */
const ROWS = 55
const EXTRA_ROWS = 5
/** 每页行数 */
const PAGE_SIZE = 20

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
  /** 原始响应文本（静态页 HTML 等非 JSON 响应断言用） */
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

/** 请求（返回原始 envelope，便于断言 paging / WWW-Authenticate 等） */
async function call(
  path: string,
  options: {
    method?: string
    json?: unknown
    /** form-urlencoded 体（OAuth token 端点的 RFC 形态，P18 T158） */
    form?: Record<string, string>
    token?: string | null
    apiKey?: string
  } = {},
): Promise<CallResult> {
  const headers: Record<string, string> = {}
  if (options.token) headers.Authorization = `Bearer ${options.token}`
  if (options.apiKey) headers.Authorization = `Bearer ${options.apiKey}`
  let payload: string | undefined
  if (options.form !== undefined) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
    payload = new URLSearchParams(options.form).toString()
  } else if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(options.json)
  }
  const response = await fetch(`${BASE}${path}`, {
    method: options.method ?? 'GET',
    headers,
    ...(payload !== undefined ? { body: payload } : {}),
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

/** 目录按需创建（同名已存在则复用；避免 mkdir 的「同名自动 (1)」语义） */
async function ensureFolder(token: string, parentId: string, name: string): Promise<string> {
  const listed = (await ok<{ list?: Array<{ id: string; name: string; isDir?: unknown }> }>(
    `/api/cloud/file/list?parentId=${parentId}`,
    { token },
  )) as { list?: Array<{ id: string; name: string; isDir?: unknown }> }
  const found = (listed.list ?? []).find((item) => item.name === name)
  if (found) return found.id
  const created = await ok<{ id: string }>('/api/cloud/file/mkdir', {
    method: 'POST',
    json: { parentId: Number(parentId), name },
    token,
  })
  return created.id
}

/** 上传文本文件到云盘目录（multipart；Node 内置 FormData / Blob，零新依赖） */
async function uploadFile(
  token: string,
  parentId: string,
  name: string,
  content: string,
): Promise<{ id: string }> {
  const form = new FormData()
  form.append('file', new Blob([content], { type: 'text/html' }), name)
  const response = await fetch(`${BASE}/api/cloud/file/upload?parentId=${parentId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  const payload = (await response.json()) as Envelope
  if (payload.code !== 0) {
    throw new Error(`上传 ${name} 失败：code=${payload.code} ${payload.message ?? ''}`)
  }
  return payload.data as { id: string }
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

async function main(): Promise<void> {
  const token = await login()
  console.log(`已登录 ${USERNAME}，base=${BASE}\n`)

  const stamp = Date.now().toString().slice(-6)
  const appName = `冒烟接入${stamp}`
  const slug = `smoke-ext-${stamp}`
  let appCode = ''
  const displayIds: bigint[] = []
  /** 本脚本创建的凭证（清理时吊销；否则多次跑会累积到 `access.maxCredentialsPerUser` 上限） */
  const credIds: string[] = []
  let siteId: bigint | null = null

  try {
    // ==================== 夹具 ====================
    console.log('夹具：数据应用（含暴露表 + 55 行数据）+ 站点 + 两个展示应用')
    const app = await ok<{ appCode: string }>('/api/app', {
      method: 'POST',
      json: { name: appName, mode: 'blank' },
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
    const table = await prisma.appTable.findFirstOrThrow({
      where: { appId: appDef.id, name: 'book', deletedAt: null },
      select: { id: true },
    })
    await ok(`/api/app/${appCode}/tables/${table.id.toString()}/expose`, {
      method: 'PUT',
      json: { isExposed: 1 },
      token,
    })
    // scope 外的一张表（验证越权 40400）
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

    const seedRows = (count: number, offset: number) =>
      Array.from({ length: count }, (_, index) => ({
        appId: appDef.id,
        tableId: table.id,
        rowId: randomUUID(),
        data: {
          title: `书${String(offset + index + 1).padStart(3, '0')}`,
          score: offset + index + 1,
        },
        createdBy: appDef.ownerId,
      }))
    await prisma.appRecord.createMany({ data: seedRows(ROWS, 0) })

    await ok('/api/site/manage', { method: 'POST', json: { slug, title: `冒烟站${stamp}` }, token })
    const site = await prisma.siteSite.findFirstOrThrow({ where: { slug }, select: { id: true } })
    siteId = site.id

    // 展示应用 A（授权数据应用）+ 展示应用 B（同站点，未授权 → 验证 D123 粒度收窄）
    const displayA = await ok<{ id: string }>('/api/display', {
      method: 'POST',
      json: { name: `展示A${stamp}`, siteSlug: slug },
      token,
    })
    displayIds.push(BigInt(displayA.id))
    const displayB = await ok<{ id: string }>('/api/display', {
      method: 'POST',
      json: { name: `展示B${stamp}`, siteSlug: slug },
      token,
    })
    displayIds.push(BigInt(displayB.id))
    await ok(`/api/display/${displayA.id}/grants`, {
      method: 'POST',
      json: { appCode },
      token,
    })
    console.log('')

    // ==================== 1. 凭证生命周期 ====================
    console.log('1. 凭证生命周期（R130/R131）')
    const created = await ok<{
      id: string
      keyId: string
      apiKey: string
      secretOnce: boolean
      secretPrefix: string
      scope: { tables: string[]; fields: Record<string, string[]> }
    }>('/api/access/credentials', {
      method: 'POST',
      json: {
        appCode,
        name: `ERP${stamp}`,
        scope: { tables: ['book'], fields: { book: ['title'] } },
      },
      token,
    })
    credIds.push(created.id)
    check(
      '创建返回完整 Key 且 secretOnce=true',
      created.apiKey.startsWith(`${created.keyId}.`) && created.secretOnce === true,
    )
    check(
      'scope 落库为「表 + 字段」收窄',
      created.scope.tables.join() === 'book' && created.scope.fields.book?.join() === 'title',
    )

    const listed = await ok<
      Array<{ id: string; secretPrefix: string; usageToday: { requests: number } }>
    >('/api/access/credentials', { token })
    const listItem = listed.find((item) => item.id === created.id)
    check(
      '列表只回显前缀（不含 apiKey）',
      !!listItem && listItem.secretPrefix.length > 0 && !('apiKey' in (listItem as object)),
    )

    const credDetail = await ok<{ keyId: string }>(`/api/access/credentials/${created.id}`, {
      token,
    })
    check(
      '详情含 keyId、不含 apiKey',
      credDetail.keyId === created.keyId && !('apiKey' in (credDetail as object)),
    )

    await ok(`/api/access/credentials/${created.id}`, {
      method: 'PUT',
      json: { name: `ERP改名${stamp}` },
      token,
    })
    const renamed = await ok<{ name: string }>(`/api/access/credentials/${created.id}`, { token })
    check('编辑生效（改备注名）', renamed.name === `ERP改名${stamp}`)

    // scope 越界 → 50021
    const overflow = await call('/api/access/credentials', {
      method: 'POST',
      token,
      json: { appCode, name: `越界${stamp}`, scope: { tables: ['no_such_table'] } },
    })
    check('scope 引用未暴露表 → 50021', overflow.body?.code === 50021)

    // P15 走查 C2：scope 字段通配 `*` 亦须被拒（R133 只允许暴露字段的字面名）
    const wildcard = await call('/api/access/credentials', {
      method: 'POST',
      token,
      json: {
        appCode,
        name: `通配${stamp}`,
        scope: { tables: ['book'], fields: { book: ['*'] } },
      },
    })
    check(
      'scope 字段通配「*」→ 50021',
      wildcard.body?.code === 50021,
      `code=${wildcard.body?.code} msg=${wildcard.body?.message ?? ''}`,
    )

    // P15 走查 C1：keyId 唯一约束。
    // keyId 是服务端签发的 16 字节 base62（无法由调用方指定），故「重复 keyId」只能从 DB 侧取证：
    // 直接插入一条占用同一 keyId 的记录，断言 `uk_cred_keyid` 拒绝（P2002）；
    // 应用侧行为由 `CredentialService.insertCredential` 保证——冲突时换新 keyId 自动重试一次，
    // 不会把「唯一冲突」暴露成 50000 内部错误。
    let dupRejected = false
    try {
      await prisma.accCredential.create({
        data: {
          ownerId: appDef.ownerId,
          appId: appDef.id,
          name: `dup-${stamp}`,
          keyId: created.keyId,
          secretHash: 'x'.repeat(64),
          secretPrefix: 'xx',
          scope: { tables: ['book'] },
        },
      })
    } catch (error) {
      const text = String(error)
      dupRejected = text.includes('P2002') || text.includes('Unique constraint')
    }
    check('uk_cred_keyid 唯一约束生效（同 keyId 插入被拒）', dupRejected)
    console.log('')

    // ==================== 2. 对外取数四端点 ====================
    console.log('2. 对外取数（/api/ext/v1，契约 v1 + 游标分页）')
    const schema = await call(`/api/ext/v1/app/${appCode}/schema`, { apiKey: created.apiKey })
    const schemaData = schema.body?.data as
      | { app: { name: string }; tables: Array<{ name: string; fields: Array<{ name: string }> }> }
      | undefined
    check('schema 200 且 HTTP 语义正常', schema.status === 200 && schema.body?.code === 0)
    check(
      'schema 只含 scope 内表（book，无 note）',
      schemaData?.tables.length === 1 && schemaData.tables[0].name === 'book',
    )
    check(
      'schema 字段按 scope 收窄（仅 title）',
      schemaData?.tables[0].fields.every((field) => field.name === 'title') === true,
    )

    // ① 默认排序（rowId ASC；rowId 是随机 UUID，**非单调**）→ keyset 保证「不重」；
    //    「不漏」在非单调排序键 + 边拉边写场景下任何分页方案都无法保证（见 P15 回执说明）
    const seenRows = new Set<string>()
    let cursor: string | null = null
    let pages = 0
    let readCount = 0
    let leakedField = false
    for (;;) {
      const query = new URLSearchParams({ size: String(PAGE_SIZE) })
      if (cursor) query.set('after', cursor)
      const page = await call(
        `/api/ext/v1/app/${appCode}/tables/book/records?${query.toString()}`,
        {
          apiKey: created.apiKey,
        },
      )
      if (page.body?.code !== 0) {
        check('列表请求成功', false, `code=${page.body?.code}`)
        break
      }
      const rows = page.body.data as Array<Record<string, unknown>>
      readCount += rows.length
      for (const row of rows) {
        seenRows.add(String(row.rowId))
        if ('score' in row) leakedField = true
      }
      pages += 1
      cursor = page.body.paging?.nextCursor ?? null
      if (pages === 1) {
        // 边拉边写（追加 5 行），验证游标不错位产生重复
        await prisma.appRecord.createMany({ data: seedRows(EXTRA_ROWS, ROWS) })
      }
      if (!cursor) break
      if (pages > 10) break
    }
    check(
      `游标翻页不重复（读 ${readCount} 行 → ${seenRows.size} 唯一 rowId）`,
      seenRows.size === readCount,
    )
    check('行数据字段按 scope 收窄（无 score）', !leakedField)

    // ② 单调排序键（createdAt ASC）+ 边拉边写 → 完整的「不重不漏」
    const monotonic = new Set<string>()
    let monotonicCursor: string | null = null
    let monotonicPages = 0
    for (;;) {
      const query = new URLSearchParams({ size: String(PAGE_SIZE), sort: 'createdAt:asc' })
      if (monotonicCursor) query.set('after', monotonicCursor)
      const page = await call(
        `/api/ext/v1/app/${appCode}/tables/book/records?${query.toString()}`,
        {
          apiKey: created.apiKey,
        },
      )
      if (page.body?.code !== 0) {
        check('单调排序翻页请求成功', false, `code=${page.body?.code}`)
        break
      }
      for (const row of page.body.data as Array<{ rowId: string }>) monotonic.add(row.rowId)
      monotonicPages += 1
      monotonicCursor = page.body.paging?.nextCursor ?? null
      if (monotonicPages === 1) {
        await prisma.appRecord.createMany({ data: seedRows(EXTRA_ROWS, ROWS + EXTRA_ROWS) })
      }
      if (!monotonicCursor) break
      if (monotonicPages > 10) break
    }
    const expectedTotal = ROWS + EXTRA_ROWS * 2
    check(
      `单调排序键下边拉边写不重不漏（期望 ${expectedTotal} 行，实得 ${monotonic.size}）`,
      monotonic.size === expectedTotal,
    )

    const firstRowId = [...seenRows][0]
    const detail = await call(`/api/ext/v1/app/${appCode}/tables/book/records/${firstRowId}`, {
      apiKey: created.apiKey,
    })
    check(
      '详情 200 且 rowId 一致',
      detail.body?.code === 0 && (detail.body.data as { rowId?: string })?.rowId === firstRowId,
    )

    const forbidden = await call(`/api/ext/v1/app/${appCode}/tables/note/records`, {
      apiKey: created.apiKey,
    })
    check('scope 外表 → 40400', forbidden.body?.code === 40400)

    // 游标与 sort 不一致 → 40001
    const badCursor = await call(
      `/api/ext/v1/app/${appCode}/tables/book/records?sort=title:desc&after=${Buffer.from(JSON.stringify({ v: 1, sort: ['rowId:asc'], last: ['x'] })).toString('base64url')}`,
      { apiKey: created.apiKey },
    )
    check('游标与 sort 不一致 → 40001', badCursor.body?.code === 40001)
    console.log('')

    // ==================== 3. 错误语义 ====================
    console.log('3. 错误语义（401 / 40400）')
    const noKey = await call(`/api/ext/v1/app/${appCode}/schema`)
    check(
      '无凭证 → HTTP 401 + WWW-Authenticate + code 50019',
      noKey.status === 401 &&
        (noKey.headers.get('www-authenticate') ?? '').includes('Bearer') &&
        noKey.body?.code === 50019,
      `status=${noKey.status} code=${noKey.body?.code}`,
    )

    const wrongApp = await call('/api/ext/v1/app/no-such-app-code/schema', {
      apiKey: created.apiKey,
    })
    check('appCode 与凭证绑定应用不一致 → 40400', wrongApp.body?.code === 40400)

    await ok(`/api/app/${appCode}/publish`, { method: 'PUT', json: { isPublic: 0 }, token })
    const unpublished = await call(`/api/ext/v1/app/${appCode}/schema`, { apiKey: created.apiKey })
    check('is_public=0 → 40400（授权亦不可读）', unpublished.body?.code === 40400)
    await ok(`/api/app/${appCode}/publish`, { method: 'PUT', json: { isPublic: 1 }, token })

    const rotated = await ok<{ apiKey: string; keyId: string }>(
      `/api/access/credentials/${created.id}/rotate`,
      { method: 'POST', token },
    )
    check('轮换保持 keyId 不变', rotated.keyId === created.keyId)
    const oldKeyCall = await call(`/api/ext/v1/app/${appCode}/schema`, { apiKey: created.apiKey })
    const newKeyCall = await call(`/api/ext/v1/app/${appCode}/schema`, { apiKey: rotated.apiKey })
    check('轮换后旧 secret 立即 401', oldKeyCall.status === 401)
    check('轮换后新 secret 可用', newKeyCall.body?.code === 0)

    await ok(`/api/access/credentials/${created.id}/revoke`, { method: 'POST', token })
    const afterRevoke = await call(`/api/ext/v1/app/${appCode}/schema`, { apiKey: rotated.apiKey })
    check('吊销后立即 401（校验不缓存）', afterRevoke.status === 401)

    const revokedRotate = await call(`/api/access/credentials/${created.id}/rotate`, {
      method: 'POST',
      token,
    })
    check('已吊销凭证不可轮换（40001）', revokedRotate.body?.code === 40001)
    console.log('')

    // ==================== 4. 开放层路径收窄（D123）====================
    console.log('4. 开放层取数粒度（展示应用级）')
    const openGranted = await call(
      `/api/open/${slug}/disp/${displayA.id}/api/app/${appCode}/schema`,
    )
    check(
      '被授权的展示应用 → code 0',
      openGranted.body?.code === 0,
      `code=${openGranted.body?.code}`,
    )

    const openDenied = await call(`/api/open/${slug}/disp/${displayB.id}/api/app/${appCode}/schema`)
    check(
      '同站点另一未授权展示应用 → 40400（P14 边界①闭合）',
      openDenied.body?.code === 40400,
      `code=${openDenied.body?.code}`,
    )

    const legacy = await call(`/api/open/${slug}/api/app/${appCode}/schema`)
    // 旧路径已无对应控制器，请求落到站点静态通配 → 首段 api 双保险统一 40400
    // （平台业务错误仍是 HTTP 200，故断言业务码而非状态码）
    check(
      '旧站点级路径已退役（code=40400）',
      legacy.body?.code === 40400,
      `status=${legacy.status} code=${legacy.body?.code}`,
    )
    console.log('')

    // ==================== 5. 审计 ====================
    console.log('5. 审计（acc_audit：正例 + 负例 + 属主检索）')
    await sleep(6000) // 等异步缓冲 flush（access.auditFlushMs = 5s）
    const audits = await ok<{
      list: Array<{ principal: string; endpoint: string; resultCode: number; rows: number }>
      total: number
    }>('/api/access/audits?pageSize=50', { token })
    const credRows = audits.list.filter((item) => item.principal.startsWith('cred:'))
    check('审计落表（cred 主体）', credRows.length > 0, `total=${audits.total}`)
    check(
      '审计含负例（401 / 40400）',
      credRows.some((item) => item.resultCode === 401 || item.resultCode === 40400),
    )
    check(
      '审计含成功取数且记录返回行数',
      credRows.some((item) => item.resultCode === 0 && item.rows > 0),
    )

    const negCases = await prisma.accAudit.count({ where: { resultCode: 50019 } })
    check('401 负例亦落表（含无归属系统流水）', negCases > 0, `count=${negCases}`)

    const anonymousRows = await prisma.accAudit.count({
      where: { principal: { startsWith: 'display:' }, ownerId: appDef.ownerId },
    })
    check('匿名层取数（display 主体）亦落表', anonymousRows > 0, `count=${anonymousRows}`)
    console.log('')

    // ==================== 6. 展示应用静态文件（P14 遗留③ 销项）====================
    console.log('6. 展示应用静态文件（上传 index.html → 开放层静态入口 → 同源取数）')
    {
      let uploadedId: string | null = null
      try {
        // P20 B1 起：展示应用目录**恒存在**于独立工作区（建应用时即建目录），
        // 挂靠只改关系字段、不移动文件；此处取站点属主以定位工作区路径
        const siteRow = await prisma.siteSite.findFirstOrThrow({
          where: { slug },
          select: { rootFolderId: true, userId: true },
        })
        // P20 B1：展示应用内容位于**独立工作区**（`disp-staging/{ownerId}/{displayId}/`），
        // 已不在站点树内 —— 用例改为往工作区写（与产品口径一致；站点发布时才聚合进快照）
        const stagingRootList = (await ok<{ list?: Array<{ id: string; name: string }> }>(
          '/api/cloud/file/list?parentId=0',
          { token },
        )) as { list?: Array<{ id: string; name: string }> }
        const stagingItem = (stagingRootList.list ?? []).find((item) => item.name === 'disp-staging')
        const stagingRootId = stagingItem
          ? stagingItem.id
          : (
              await ok<{ id: string }>('/api/cloud/file/mkdir', {
                method: 'POST',
                json: { parentId: 0, name: 'disp-staging' },
                token,
              })
            ).id
        const dispUserDirId = await ensureFolder(token, stagingRootId, siteRow.userId.toString())
        const appDirId = await ensureFolder(token, dispUserDirId, displayA.id)
        check('展示应用工作区目录可由写文件按需创建（disp-staging/{属主}/{id}）', !!appDirId)

        const html = [
          '<!doctype html><html><head><meta charset="utf-8"><title>冒烟展示页</title></head><body>',
          '<h1 id="marker">IPLAT-STATIC-OK</h1>',
          '<script>',
          `fetch('./api/app/${appCode}/tables/book/records?size=1')`,
          '  .then(function (r) { return r.json() })',
          "  .then(function (p) { document.body.insertAdjacentHTML('beforeend', '<p id=\"rows\">rows=' + (p.data ? p.data.length : -1) + '</p>') })",
          '</script></body></html>',
        ].join('\n')
        const uploaded = await uploadFile(token, appDirId, 'index.html', html)
        uploadedId = uploaded.id

        const page = await call(`/api/open/${slug}/disp/${displayA.id}/`)
        check(
          '静态入口 200 且返回上传的页面',
          page.status === 200 && page.text.includes('IPLAT-STATIC-OK'),
          `status=${page.status}`,
        )

        const sameOrigin = await call(
          `/api/open/${slug}/disp/${displayA.id}/api/app/${appCode}/tables/book/records?size=1`,
        )
        // 开放层（同源页面取数）沿用 P14 内部形状 `{list,total,pageNo,pageSize}`；
        // 对外 `/api/ext/v1` 才走契约层 envelope（`data[] + paging`）——形状差异是 D124 的刻意设计
        const payload = sameOrigin.body?.data as { list?: unknown[] } | undefined
        check(
          '页面内同源相对路径取数可用（./api/app/<appCode>/…）',
          sameOrigin.body?.code === 0 && (payload?.list?.length ?? 0) === 1,
          `code=${sameOrigin.body?.code} list=${payload?.list?.length ?? 'n/a'}`,
        )

        const empty = await call(`/api/open/${slug}/disp/${displayB.id}/index.html`)
        check(
          '同站点另一展示应用（无文件）不可达',
          empty.body?.code === 40400,
          `code=${empty.body?.code}`,
        )
      } catch (error) {
        check('展示应用静态文件正例', false, (error as Error).message)
      }
      // 清理：软删上传文件（进回收站，物理清除由既有 cron 负责）
      if (uploadedId) {
        await prisma.cloudFile
          .update({ where: { id: BigInt(uploadedId) }, data: { deletedAt: new Date() } })
          .catch(() => undefined)
      }
    }

    // ==================== 7. 附件流（P15 走查 C3）====================
    console.log('7. 附件流端到端（引用索引 + 表·字段暴露 三道闸）')
    {
      let fileId: string | null = null
      let orphanId: string | null = null
      try {
        // 夹具：云盘根目录传两个文本文件；album 表（attachment 字段）+ 一行仅引用第一个
        // （云盘根以 parentId = 0 表示，字段非空）
        const rootDir = await prisma.cloudFile.findFirst({
          where: { userId: appDef.ownerId, parentId: BigInt(0), isDir: 1, deletedAt: null },
          select: { id: true },
        })
        const rootId = (rootDir?.id ?? BigInt(0)).toString()
        fileId = (await uploadFile(token, rootId, `smoke-attach-${stamp}.txt`, 'IPLAT-ATTACH-OK'))
          .id
        orphanId = (await uploadFile(token, rootId, `smoke-orphan-${stamp}.txt`, 'NOT-REFERENCED'))
          .id

        await ok(`/api/app/${appCode}/tables`, {
          method: 'POST',
          json: {
            name: 'album',
            label: '相册',
            fields: [
              { name: 'title', label: '标题', type: 'text' },
              { name: 'cover', label: '封面', type: 'attachment' },
            ],
          },
          token,
        })
        const albumTable = await prisma.appTable.findFirstOrThrow({
          where: { appId: appDef.id, name: 'album', deletedAt: null },
          select: { id: true },
        })
        await ok(`/api/app/${appCode}/tables/${albumTable.id.toString()}/expose`, {
          method: 'PUT',
          json: { isExposed: 1 },
          token,
        })
        const albumFields = await prisma.appField.findMany({
          where: { tableId: albumTable.id, isDeleted: 0 },
          select: { id: true },
        })
        for (const field of albumFields) {
          await ok(`/api/app/${appCode}/fields/${field.id.toString()}/expose`, {
            method: 'PUT',
            json: { isExposed: 1 },
            token,
          })
        }
        // 凭证 C：scope 仅 album（与附件流取数面语义一致）
        const credC = await ok<{ id: string; apiKey: string }>('/api/access/credentials', {
          method: 'POST',
          json: { appCode, name: `附件${stamp}`, scope: { tables: ['album'] } },
          token,
        })
        credIds.push(credC.id)

        // 引用关系直接落库：写路径属 P11 A 侧执行器 / 导入（非本期对象），
        // 附件流的准入只看 `app_attachment_ref` + 表·字段暴露，故此处造等价夹具
        const row = await prisma.appRecord.create({
          data: {
            appId: appDef.id,
            tableId: albumTable.id,
            rowId: randomUUID(),
            data: { title: `封面${stamp}`, cover: fileId },
            createdBy: appDef.ownerId,
          },
          select: { id: true },
        })
        await prisma.appAttachmentRef.create({
          data: {
            appId: appDef.id,
            tableId: albumTable.id,
            recordId: row.id,
            fieldName: 'cover',
            fileId: BigInt(fileId),
          },
        })

        const stream = await call(`/api/ext/v1/app/${appCode}/files/${fileId}/stream`, {
          apiKey: credC.apiKey,
        })
        check(
          '附件流 200 且内容可达（引用索引 + 表·字段暴露）',
          stream.status === 200 && stream.text.includes('IPLAT-ATTACH-OK'),
          `status=${stream.status} len=${stream.text.length}`,
        )
        check(
          '附件流带 ETag / Accept-Ranges（HTTP 语义齐全）',
          stream.headers.get('etag') !== null &&
            (stream.headers.get('accept-ranges') ?? '') === 'bytes',
        )

        const orphan = await call(`/api/ext/v1/app/${appCode}/files/${orphanId}/stream`, {
          apiKey: credC.apiKey,
        })
        check(
          '未被应用数据引用的文件 → 40400（越权不可读）',
          orphan.body?.code === 40400,
          `code=${orphan.body?.code}`,
        )

        const missing = await call(`/api/ext/v1/app/${appCode}/files/999999999999999999/stream`, {
          apiKey: credC.apiKey,
        })
        check('不存在的文件 → 40400', missing.body?.code === 40400, `code=${missing.body?.code}`)

        // ---- P17 T151（走查 W11 收窄）：附件流须过凭证 scope 交集（表 · 字段）----
        // 与 records/detail 同口径（scope 即授权边界）；越界引用视同「未引用」→ 40400（防探测不裂缝）
        const credNoScope = await ok<{ id: string; apiKey: string }>('/api/access/credentials', {
          method: 'POST',
          json: { appCode, name: `无附件表${stamp}`, scope: { tables: ['book'] } },
          token,
        })
        credIds.push(credNoScope.id)
        const outOfScope = await call(`/api/ext/v1/app/${appCode}/files/${fileId}/stream`, {
          apiKey: credNoScope.apiKey,
        })
        check(
          'W11：凭证 scope 不含该表 → 附件流 40400（表级交集生效）',
          outOfScope.body?.code === 40400,
          `code=${outOfScope.body?.code}`,
        )

        const credFieldScope = await ok<{ id: string; apiKey: string }>('/api/access/credentials', {
          method: 'POST',
          json: {
            appCode,
            name: `附件字段收窄${stamp}`,
            scope: { tables: ['album'], fields: { album: ['title'] } },
          },
          token,
        })
        credIds.push(credFieldScope.id)
        const fieldOut = await call(`/api/ext/v1/app/${appCode}/files/${fileId}/stream`, {
          apiKey: credFieldScope.apiKey,
        })
        check(
          'W11：scope 字段不含该附件字段 → 40400（字段级交集生效）',
          fieldOut.body?.code === 40400,
          `code=${fieldOut.body?.code}`,
        )
        await ok(`/api/access/credentials/${credFieldScope.id}`, {
          method: 'PUT',
          json: { scope: { tables: ['album'], fields: { album: ['title', 'cover'] } } },
          token,
        })
        const fieldIn = await call(`/api/ext/v1/app/${appCode}/files/${fileId}/stream`, {
          apiKey: credFieldScope.apiKey,
        })
        check(
          'W11：字段口径补回该附件字段 → 200（放行，无需换凭证）',
          fieldIn.status === 200 && fieldIn.text.includes('IPLAT-ATTACH-OK'),
          `status=${fieldIn.status} len=${fieldIn.text.length}`,
        )
      } catch (error) {
        check('附件流端到端（C3）', false, (error as Error).message)
      }
      // 清理：软删上传文件（进回收站，物理清除由既有 cron 负责）
      for (const id of [fileId, orphanId]) {
        if (id) {
          await prisma.cloudFile
            .update({ where: { id: BigInt(id) }, data: { deletedAt: new Date() } })
            .catch(() => undefined)
        }
      }
    }

    // ==================== 8. 行级过滤 rowFilter（P17 T152 / R147~R149）====================
    console.log('8. 行级过滤（管理侧 50021 / 取数收窄与交集 / 详情判拒 / 失效判拒与自愈）')
    {
      try {
        // 夹具：post 表（title / status / qty）+ 3 行（两 published、一 draft），字段全暴露
        await ok(`/api/app/${appCode}/tables`, {
          method: 'POST',
          json: {
            name: 'post',
            label: '文章',
            fields: [
              { name: 'title', label: '标题', type: 'text' },
              { name: 'status', label: '状态', type: 'text' },
              { name: 'qty', label: '数量', type: 'number' },
            ],
          },
          token,
        })
        const postTable = await prisma.appTable.findFirstOrThrow({
          where: { appId: appDef.id, name: 'post', deletedAt: null },
          select: { id: true },
        })
        await ok(`/api/app/${appCode}/tables/${postTable.id.toString()}/expose`, {
          method: 'PUT',
          json: { isExposed: 1 },
          token,
        })
        // 字段顺序（sort asc, id asc）＝ A 侧 `indexSlots` 的槽位口径（前 5 个非系统字段 → r_c1..c5）
        const postFields = await prisma.appField.findMany({
          where: { tableId: postTable.id, isDeleted: 0 },
          orderBy: [{ sort: 'asc' }, { id: 'asc' }],
          select: { id: true, name: true },
        })
        for (const field of postFields) {
          await ok(`/api/app/${appCode}/fields/${field.id.toString()}/expose`, {
            method: 'PUT',
            json: { isExposed: 1 },
            token,
          })
        }
        // 直写夹具须**同步 `r_cN` 冗余列**：A 侧写路径由 `buildIndexColumns` 维护，filter（含 rowFilter）
        // 走这些列做 SQL 下推；只写 `data` 会让 WHERE 匹配不到行（本脚本 2026-10-02 实测踩到）
        const slotOf = new Map(postFields.map((field, index) => [field.name, index + 1] as const))
        for (const item of [
          { title: `甲${stamp}`, status: 'published', qty: 10 },
          { title: `乙${stamp}`, status: 'draft', qty: 20 },
          { title: `丙${stamp}`, status: 'published', qty: 30 },
        ]) {
          const indexColumns: Record<string, string> = {}
          for (const [name, slot] of slotOf) {
            indexColumns[`rC${slot}`] = String((item as Record<string, unknown>)[name])
          }
          await prisma.appRecord.create({
            data: {
              appId: appDef.id,
              tableId: postTable.id,
              rowId: randomUUID(),
              data: item,
              createdBy: appDef.ownerId,
              ...indexColumns,
            },
          })
        }

        // ---- 8.1 管理侧校验（R147）：非法 rowFilter → 50021，errmsg 指明条目 ----
        const badCases: Array<[string, Record<string, unknown>]> = [
          ['表不在 scope', { tables: ['post'], rowFilter: { book: ['status:eq:published'] } }],
          ['字段不存在', { tables: ['post'], rowFilter: { post: ['ghost:eq:1'] } }],
          ['算子非法', { tables: ['post'], rowFilter: { post: ['status:like:x'] } }],
          ['值类型不可解析', { tables: ['post'], rowFilter: { post: ['qty:eq:abc'] } }],
          [
            '条目超上限',
            {
              tables: ['post'],
              rowFilter: { post: ['status:eq:a', 'status:eq:b', 'status:eq:c', 'status:eq:d'] },
            },
          ],
        ]
        for (const [label, scope] of badCases) {
          const res = await call('/api/access/credentials', {
            method: 'POST',
            json: { appCode, name: `非法${stamp}`, scope },
            token,
          })
          const message = typeof res.body?.message === 'string' ? (res.body.message as string) : ''
          check(
            `rowFilter 非法（${label}）→ 50021 且指明条目`,
            res.body?.code === 50021 && message.includes('rowFilter'),
            `code=${res.body?.code} msg=${message.slice(0, 60)}`,
          )
        }

        // ---- 8.2 生效收窄 + 请求 filter 交集 + 冲突空页（R148）----
        const credRf = await ok<{ id: string; apiKey: string }>('/api/access/credentials', {
          method: 'POST',
          json: {
            appCode,
            name: `行过滤${stamp}`,
            scope: { tables: ['post'], rowFilter: { post: ['status:eq:published'] } },
          },
          token,
        })
        credIds.push(credRf.id)

        const narrowed = await call(`/api/ext/v1/app/${appCode}/tables/post/records?size=50`, {
          apiKey: credRf.apiKey,
        })
        const narrowedRows = (narrowed.body?.data ?? []) as Array<Record<string, unknown>>
        check(
          'rowFilter 生效：只回 published 行（收窄而非拒绝）',
          narrowed.status === 200 &&
            narrowedRows.length === 2 &&
            narrowedRows.every((row) => row.status === 'published'),
          `len=${narrowedRows.length} status=${narrowedRows.map((row) => String(row.status)).join(',')}`,
        )

        const intersected = await call(
          `/api/ext/v1/app/${appCode}/tables/post/records?size=50&filter=qty:eq:30`,
          { apiKey: credRf.apiKey },
        )
        const interRows = (intersected.body?.data ?? []) as Array<Record<string, unknown>>
        check(
          'rowFilter 与请求 filter 取交集（AND 无优先级）',
          intersected.status === 200 &&
            interRows.length === 1 &&
            interRows[0].qty === 30 &&
            interRows[0].status === 'published',
          `len=${interRows.length}`,
        )

        const conflict = await call(
          `/api/ext/v1/app/${appCode}/tables/post/records?size=50&filter=status:eq:draft`,
          { apiKey: credRf.apiKey },
        )
        check(
          '条件冲突 → code 0 空页（不报错）',
          conflict.status === 200 &&
            conflict.body?.code === 0 &&
            (conflict.body?.data ?? []).length === 0,
          `code=${conflict.body?.code} len=${(conflict.body?.data ?? []).length}`,
        )

        // ---- 8.3 详情判拒（R148）：行存在但不满足 rowFilter → 40400 ----
        const allRows = await prisma.appRecord.findMany({
          where: { tableId: postTable.id, deletedAt: null },
          select: { rowId: true, data: true },
        })
        const publishedRow = allRows.find(
          (row) => (row.data as Record<string, unknown>).status === 'published',
        )
        const draftRow = allRows.find(
          (row) => (row.data as Record<string, unknown>).status === 'draft',
        )
        const detailOk = await call(
          `/api/ext/v1/app/${appCode}/tables/post/records/${publishedRow?.rowId}`,
          { apiKey: credRf.apiKey },
        )
        check(
          '详情：满足 rowFilter 的行可读',
          detailOk.status === 200 &&
            detailOk.body?.code === 0 &&
            detailOk.body?.data?.status === 'published',
          `code=${detailOk.body?.code}`,
        )
        const detailDenied = await call(
          `/api/ext/v1/app/${appCode}/tables/post/records/${draftRow?.rowId}`,
          { apiKey: credRf.apiKey },
        )
        check(
          '详情：行存在但不满足 rowFilter → 40400（与不存在同表现）',
          detailDenied.body?.code === 40400,
          `code=${detailDenied.body?.code}`,
        )

        // ---- 8.4 运行期失效判拒 + 自愈（R149）----
        const statusField = postFields.find((field) => field.name === 'status')
        await ok(`/api/app/${appCode}/fields/${statusField?.id.toString()}/expose`, {
          method: 'PUT',
          json: { isExposed: 0 },
          token,
        })
        const afterOffline = await call(`/api/ext/v1/app/${appCode}/tables/post/records?size=50`, {
          apiKey: credRf.apiKey,
        })
        check(
          'rowFilter 引用字段取消暴露 → 该表 40400（判拒，不静默跳过）',
          afterOffline.body?.code === 40400,
          `code=${afterOffline.body?.code}`,
        )
        await ok(`/api/app/${appCode}/fields/${statusField?.id.toString()}/expose`, {
          method: 'PUT',
          json: { isExposed: 1 },
          token,
        })
        const healed = await call(`/api/ext/v1/app/${appCode}/tables/post/records?size=50`, {
          apiKey: credRf.apiKey,
        })
        check(
          '恢复暴露 → 自愈可读（无需改凭证）',
          healed.status === 200 && (healed.body?.data ?? []).length === 2,
          `status=${healed.status} len=${(healed.body?.data ?? []).length}`,
        )

        // ---- 8.5 有效性自检：合法 rowFilter 可正常创建（防「一律拒绝」的假绿）----
        const credRfOk = await call('/api/access/credentials', {
          method: 'POST',
          json: {
            appCode,
            name: `合法行过滤${stamp}`,
            scope: {
              tables: ['post'],
              fields: { post: ['title', 'status', 'qty'] },
              rowFilter: { post: ['status:eq:published', 'title:contains:甲'] },
            },
          },
          token,
        })
        check(
          '合法 rowFilter（含 contains）→ 创建成功',
          credRfOk.body?.code === 0 && typeof credRfOk.body?.data?.apiKey === 'string',
          `code=${credRfOk.body?.code} msg=${String(credRfOk.body?.message ?? '').slice(0, 60)}`,
        )
        if (credRfOk.body?.data?.id) credIds.push(credRfOk.body.data.id as string)

        // ---- 8.6（销 P17 走查 C1）：rowFilter 生效下的**游标翻页**（单调键不重不漏）----
        // 走查要求单列实测：rowFilter 是常量 WHERE 段，不得干扰 keyset 游标定位
        const page1 = await call(
          `/api/ext/v1/app/${appCode}/tables/post/records?size=1&sort=createdAt:asc`,
          { apiKey: credRf.apiKey },
        )
        const page1Rows = (page1.body?.data ?? []) as Array<Record<string, unknown>>
        const page1Cursor = (page1.body?.paging as { nextCursor?: string } | undefined)?.nextCursor
        const page2 = await call(
          `/api/ext/v1/app/${appCode}/tables/post/records?size=1&sort=createdAt:asc&after=${encodeURIComponent(page1Cursor ?? '')}`,
          { apiKey: credRf.apiKey },
        )
        const page2Rows = (page2.body?.data ?? []) as Array<Record<string, unknown>>
        const pagedIds = [...page1Rows, ...page2Rows].map((row) => String(row.rowId))
        check(
          'C1：rowFilter 生效下游标翻页不重不漏（createdAt:asc，2 行 2 页，第 2 页 nextCursor=null）',
          page1Rows.length === 1 &&
            page2Rows.length === 1 &&
            new Set(pagedIds).size === 2 &&
            ((page2.body?.paging as { nextCursor?: string | null } | undefined)?.nextCursor ??
              null) === null,
          `p1=${page1Rows.length} p2=${page2Rows.length} cursor2=${String((page2.body?.paging as { nextCursor?: string | null } | undefined)?.nextCursor)}`,
        )
      } catch (error) {
        check('行级过滤端到端（P17）', false, (error as Error).message)
      }
    }

    // ==================== 9. OAuth2 client_credentials（P18 T158 / R151~R155）====================
    console.log('9. OAuth2 令牌（换发 / RFC 错误 / 双形态取数 / 失效级联 / 收窄即时 / 配额审计）')
    {
      try {
        // ① 创建 oauth 型凭证（D141：形态创建时确定，不可改）
        const credOauth = await ok<{ id: string; apiKey: string; type: string }>(
          '/api/access/credentials',
          {
            method: 'POST',
            json: {
              appCode,
              name: `OAuth${stamp}`,
              type: 'oauth',
              // 复用第 8 段的 post 表（2 published + 1 draft，且夹具已同步 r_cN 冗余列）
              scope: { tables: ['post'], rowFilter: { post: ['status:eq:published'] } },
            },
            token,
          },
        )
        credIds.push(credOauth.id)
        check(
          '创建 oauth 型凭证：type 落库并回显',
          credOauth.type === 'oauth',
          `type=${credOauth.type}`,
        )

        const dot = credOauth.apiKey.indexOf('.')
        const clientId = credOauth.apiKey.slice(0, dot)
        const clientSecret = credOauth.apiKey.slice(dot + 1)
        const tokenPath = '/api/ext/oauth/token'

        // ② RFC 6749 §5.1 成功响应（**非平台 envelope**）
        const grant = await call(tokenPath, {
          method: 'POST',
          form: {
            grant_type: 'client_credentials',
            client_id: clientId,
            client_secret: clientSecret,
          },
        })
        const grantBody = grant.body as unknown as {
          access_token?: string
          token_type?: string
          expires_in?: number
          code?: number
        } | null
        const accessToken = grantBody?.access_token ?? ''
        check(
          '换发成功：200 + §5.1 三字段（access_token / token_type / expires_in，非平台 envelope）',
          grant.status === 200 &&
            accessToken.startsWith('it_') &&
            grantBody?.token_type === 'Bearer' &&
            typeof grantBody?.expires_in === 'number' &&
            grantBody?.code === undefined,
          `status=${grant.status} body=${grant.text.slice(0, 80)}`,
        )

        // ③ RFC 6749 §5.2 错误面（刻意不用平台码，D140）
        const badSecret = await call(tokenPath, {
          method: 'POST',
          form: {
            grant_type: 'client_credentials',
            client_id: clientId,
            client_secret: 'wrong-secret-value',
          },
        })
        check(
          '错 secret → 401 + invalid_client + WWW-Authenticate（RFC 格式）',
          badSecret.status === 401 &&
            (badSecret.body as unknown as { error?: string })?.error === 'invalid_client' &&
            (badSecret.headers.get('www-authenticate') ?? '').includes('iplat-ext'),
          `status=${badSecret.status} body=${badSecret.text.slice(0, 60)}`,
        )
        const noGrant = await call(tokenPath, {
          method: 'POST',
          form: { client_id: clientId, client_secret: clientSecret },
        })
        check(
          'grant_type 缺失 → 400 + invalid_request',
          noGrant.status === 400 &&
            (noGrant.body as unknown as { error?: string })?.error === 'invalid_request',
          `status=${noGrant.status} body=${noGrant.text.slice(0, 60)}`,
        )
        const badGrant = await call(tokenPath, {
          method: 'POST',
          form: { grant_type: 'password', client_id: clientId, client_secret: clientSecret },
        })
        check(
          'grant_type 不支持 → 400 + unsupported_grant_type',
          badGrant.status === 400 &&
            (badGrant.body as unknown as { error?: string })?.error === 'unsupported_grant_type',
          `status=${badGrant.status} body=${badGrant.text.slice(0, 60)}`,
        )

        // ④ 令牌可用于资源端点（与 API Key 同管线：scope + rowFilter 一并生效）
        const viaToken = await call(`/api/ext/v1/app/${appCode}/tables/post/records?size=50`, {
          apiKey: accessToken,
        })
        const viaTokenRows = (viaToken.body?.data ?? []) as Array<Record<string, unknown>>
        check(
          '令牌取数：rowFilter 一并生效（post 表 status=published 共 2 行）',
          viaToken.status === 200 &&
            viaTokenRows.length === 2 &&
            viaTokenRows.every((row) => row.status === 'published'),
          `status=${viaToken.status} len=${viaTokenRows.length}`,
        )
        const viaKey = await call(`/api/ext/v1/app/${appCode}/tables/post/records?size=50`, {
          apiKey: credOauth.apiKey,
        })
        check(
          'oauth 型 secret 直连资源端点 → 401（D141：必须经换发）',
          viaKey.status === 401 && viaKey.body?.code === 50019,
          `status=${viaKey.status} code=${viaKey.body?.code}`,
        )
        const schemaViaToken = await call(`/api/ext/v1/app/${appCode}/schema`, {
          apiKey: accessToken,
        })
        check(
          '令牌可调 schema 端点（同一守卫 → 对外端点全覆盖）',
          schemaViaToken.status === 200 && schemaViaToken.body?.code === 0,
          `status=${schemaViaToken.status}`,
        )

        // ⑤ api_key 型也可换 token（D141 迁移路径）
        const keyCred = await ok<{ id: string; apiKey: string }>('/api/access/credentials', {
          method: 'POST',
          json: { appCode, name: `换发型${stamp}`, scope: { tables: ['book'] } },
          token,
        })
        credIds.push(keyCred.id)
        const keyDot = keyCred.apiKey.indexOf('.')
        const keyGrant = await call(tokenPath, {
          method: 'POST',
          form: {
            grant_type: 'client_credentials',
            client_id: keyCred.apiKey.slice(0, keyDot),
            client_secret: keyCred.apiKey.slice(keyDot + 1),
          },
        })
        check(
          'api_key 型凭证同样可换令牌（D141：渐进迁移路径）',
          keyGrant.status === 200 &&
            (
              (keyGrant.body as unknown as { access_token?: string })?.access_token ?? ''
            ).startsWith('it_'),
          `status=${keyGrant.status}`,
        )

        // ⑥ 配额（D142）：换发计请求配额，X-RateLimit-* 可见
        check(
          '换发计入请求配额（响应带 X-RateLimit-*）',
          grant.headers.get('x-ratelimit-remaining-day') !== null &&
            grant.headers.get('x-ratelimit-remaining-minute') !== null,
          `remain=${grant.headers.get('x-ratelimit-remaining-day')}`,
        )

        // ⑦ 签发后收窄 scope → 存量令牌立即生效（R153：授权事实以凭证行为准）
        await ok(`/api/access/credentials/${credOauth.id}`, {
          method: 'PUT',
          json: { scope: { tables: ['post'], rowFilter: { post: ['status:eq:draft'] } } },
          token,
        })
        const afterShrink = await call(`/api/ext/v1/app/${appCode}/tables/post/records?size=50`, {
          apiKey: accessToken,
        })
        check(
          '签发后收窄 rowFilter（改为 status=draft 共 1 行）→ 存量令牌立即生效（无需重新换发）',
          afterShrink.status === 200 && (afterShrink.body?.data ?? []).length === 1,
          `len=${(afterShrink.body?.data ?? []).length}`,
        )

        // ⑧ 轮换 secret → 已签发令牌即时失效（R154，不等 TTL）
        const rotatedCred = await ok<{ keyId: string; apiKey: string }>(
          `/api/access/credentials/${credOauth.id}/rotate`,
          { method: 'POST', json: {}, token },
        )
        const afterRotate = await call(`/api/ext/v1/app/${appCode}/tables/book/records?size=50`, {
          apiKey: token,
        })
        check(
          '轮换 secret → 已签发令牌即时 401（不等 TTL）',
          afterRotate.status === 401 && afterRotate.body?.code === 50019,
          `status=${afterRotate.status} code=${afterRotate.body?.code}`,
        )

        // ⑨ 旧 secret 已失效（换发失败）；新 secret 换发成功且可取数
        const staleGrant = await call(tokenPath, {
          method: 'POST',
          form: {
            grant_type: 'client_credentials',
            client_id: clientId,
            client_secret: clientSecret,
          },
        })
        check(
          '轮换后旧 secret 换发失败（401 invalid_client）',
          staleGrant.status === 401,
          `status=${staleGrant.status} body=${staleGrant.text.slice(0, 60)}`,
        )
        const newDot = rotatedCred.apiKey.indexOf('.')
        const freshGrant = await call(tokenPath, {
          method: 'POST',
          form: {
            grant_type: 'client_credentials',
            client_id: rotatedCred.apiKey.slice(0, newDot),
            client_secret: rotatedCred.apiKey.slice(newDot + 1),
          },
        })
        const freshToken =
          (freshGrant.body as unknown as { access_token?: string })?.access_token ?? ''
        check(
          '新 secret 换发成功且新令牌可取数',
          freshGrant.status === 200 && freshToken.startsWith('it_'),
          `status=${freshGrant.status}`,
        )

        // ⑩ 吊销凭证 → 该凭证全部令牌即时失效（R154）
        await ok(`/api/access/credentials/${credOauth.id}/revoke`, {
          method: 'POST',
          json: {},
          token,
        })
        const afterRevoke = await call(`/api/ext/v1/app/${appCode}/tables/book/records?size=50`, {
          apiKey: freshToken,
        })
        check(
          '吊销凭证 → 已签发令牌即时 401（ownerId=0 之外，属主侧亦立即失效）',
          afterRevoke.status === 401 && afterRevoke.body?.code === 50019,
          `status=${afterRevoke.status} code=${afterRevoke.body?.code}`,
        )

        // ⑪ 审计（D142）：正例进属主检索；负例（invalid_client）为 ownerId=0 系统流水
        let tokenAudits: Array<{ endpoint: string; resultCode: number }> = []
        let negativeCount = 0
        for (let attempt = 0; attempt < 12; attempt += 1) {
          const page = await ok<{ list: Array<{ endpoint: string; resultCode: number }> }>(
            `/api/access/audits?credentialId=${credOauth.id}&pageSize=50`,
            { token },
          )
          tokenAudits = (page.list ?? []).filter((item) => item.endpoint === 'ext.oauth.token')
          negativeCount = await prisma.accAudit.count({
            where: {
              endpoint: 'ext.oauth.token',
              resultCode: 50019,
              ownerId: BigInt(0),
              createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) },
            },
          })
          if (tokenAudits.some((item) => item.resultCode === 0) && negativeCount > 0) break
          await new Promise((resolve) => setTimeout(resolve, 500))
        }
        check(
          '审计：ext.oauth.token 正例（resultCode=0）进属主检索',
          tokenAudits.some((item) => item.resultCode === 0),
          `count=${tokenAudits.length}`,
        )
        check(
          '审计：ext.oauth.token 负例（invalid_client）以 ownerId=0 落表',
          negativeCount > 0,
          `count=${negativeCount}`,
        )

        // ⑫ secret 边界：审计摘要不含 secret / 令牌原文
        const summaries = await prisma.accAudit.findMany({
          where: {
            endpoint: 'ext.oauth.token',
            createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) },
          },
          select: { paramsSummary: true },
          take: 50,
        })
        check(
          '审计摘要不含 secret / 令牌原文（只含 grant_type 与 client_id）',
          summaries.every(
            (item) =>
              item.paramsSummary === null ||
              (!item.paramsSummary.includes(clientSecret) &&
                !item.paramsSummary.includes(accessToken)),
          ),
          `n=${summaries.length}`,
        )

        // ⑬ 令牌自然过期（**销 P18 走查 C1**）：TTL 到点即 401 + `invalid_token` + 50019。
        // 常规环境 TTL=3600 等不起，故仅在把 ACCESS_TOKEN_TTL_SECONDS 调小（≤3）时实测——
        // 与保留策略同款「条件断言」：调小环境变量后本段自动生效，无需改脚本。
        const ttl = Number(process.env.ACCESS_TOKEN_TTL_SECONDS ?? '3600')
        if (Number.isFinite(ttl) && ttl > 0 && ttl <= 3) {
          const expCred = await ok<{ id: string; apiKey: string }>('/api/access/credentials', {
            method: 'POST',
            json: { appCode, name: `过期${stamp}`, type: 'oauth', scope: { tables: ['post'] } },
            token,
          })
          credIds.push(expCred.id)
          const expDot = expCred.apiKey.indexOf('.')
          const expGrant = await call(tokenPath, {
            method: 'POST',
            form: {
              grant_type: 'client_credentials',
              client_id: expCred.apiKey.slice(0, expDot),
              client_secret: expCred.apiKey.slice(expDot + 1),
            },
          })
          const expToken =
            (expGrant.body as unknown as { access_token?: string })?.access_token ?? ''
          const beforeExpiry = await call(`/api/ext/v1/app/${appCode}/tables/post/records?size=1`, {
            apiKey: expToken,
          })
          await new Promise((resolve) => setTimeout(resolve, (ttl + 1) * 1000))
          const afterExpiry = await call(`/api/ext/v1/app/${appCode}/tables/post/records?size=1`, {
            apiKey: expToken,
          })
          check(
            `令牌自然过期（TTL=${ttl}s）→ 过期前可用、过期后 401 + invalid_token + 50019`,
            beforeExpiry.status === 200 &&
              afterExpiry.status === 401 &&
              afterExpiry.body?.code === 50019 &&
              (afterExpiry.headers.get('www-authenticate') ?? '').includes('invalid_token'),
            `before=${beforeExpiry.status} after=${afterExpiry.status} code=${afterExpiry.body?.code}`,
          )
        } else {
          console.log(
            `  · 跳过令牌自然过期实测（ACCESS_TOKEN_TTL_SECONDS=${ttl}，调小到 ≤3 后本段自动生效）`,
          )
        }
      } catch (error) {
        check('OAuth2 端到端（P18）', false, (error as Error).message)
      }
    }
  } finally {
    // ==================== 清理（best-effort）====================
    try {
      for (const id of credIds) {
        await call(`/api/access/credentials/${id}/revoke`, { method: 'POST', token })
      }
      for (const id of displayIds) {
        await call(`/api/display/${id.toString()}`, { method: 'DELETE', token })
      }
      if (appCode) await call(`/api/app/${appCode}`, { method: 'DELETE', token })
      if (siteId !== null)
        await call(`/api/site/manage/${siteId.toString()}`, { method: 'DELETE', token })
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
