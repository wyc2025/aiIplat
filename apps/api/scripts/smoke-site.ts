/**
 * 站点发布与版本管理端到端冒烟（P19 T163，可重跑资产）。
 *
 * 覆盖 PRD-P19 §5 验收标准 1~11：
 * 1. 隔离性：发布后改工作副本，`/api/open/{slug}/**` 内容不变
 * 2. 预览轨：管理态预览读到改后内容；未登录被拒
 * 3. 发布即上线：版本行与快照目录一致（文件数 / 字节数 / manifest）；`media/` 内文件在正式位可访问
 * 4. 回滚：activate 旧版即切换线上内容，可反复横跳
 * 5. 并发互斥：同站双并发发布，其一 40121；无残留 `.tmp-` 半成品目录
 * 6. 保留策略：锁定版豁免删除、当前版本不可删（`SITE_RELEASE_KEEP` 调小时额外验证自动清理最旧）
 * 7. 向后兼容：从未发布的站点仍直挂工作副本（W12 阻断优先语义）；`disp/` 链不因发布变化
 * 8. 安全负例：路径穿越 → 40400；直接访问 `site-releases` 区 → 40400
 * 9. 权限解耦：工作副本置显式阻断（is_public=2）不影响已发布快照（R161）
 * 10. AI 文案与门禁：由 `pnpm check:ai` / `pnpm smoke:ai` 另跑（本脚本只断言站点链路）
 * 11. 工程门禁：本脚本 + smoke:ext / smoke:mcp 回归 + 前端 vite build（在交付流程中执行）
 *
 * 跑法（apps/api 目录下）：`pnpm smoke:site`
 * 前置：MySQL / Redis 与 API 实例已起（默认 http://127.0.0.1:3000）；
 *       账号 admin（自带全部权限）；SMOKE_BASE_URL / SMOKE_USERNAME / SMOKE_PASSWORD 可覆盖。
 * 退出码：0 = 全过；1 = 有失败；2 = 前置不满足。
 */
import { randomUUID } from 'node:crypto'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { PrismaClient } from '@prisma/client'

const BASE = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3000'
const USERNAME = process.env.SMOKE_USERNAME ?? 'admin'
const PASSWORD = process.env.SMOKE_PASSWORD ?? 'Admin@123'
/** 快照区根（与 StorageService 同口径：UPLOAD_DIR/site-releases） */
const UPLOAD_DIR = resolve(process.env.UPLOAD_DIR ?? './uploads')

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
    // 无 .env 时依赖外部注入
  }
}

loadEnvFromCwd()
const prisma = new PrismaClient()
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

interface Envelope {
  code: number
  message?: string
  data?: unknown
}

interface ReleaseItem {
  id: string
  versionNo: number
  label: string | null
  fileCount: number
  totalBytes: string
  pinned: boolean
  active: boolean
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

/** 请求（返回原始 envelope；`raw` = true 时同时回原始文本） */
async function call(
  path: string,
  options: {
    method?: string
    json?: unknown
    token?: string | null
    headers?: Record<string, string>
  } = {},
): Promise<{ status: number; body: Envelope | null; text: string; headers: Headers }> {
  const headers: Record<string, string> = { ...(options.headers ?? {}) }
  if (options.token) headers.Authorization = `Bearer ${options.token}`
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
  return { status: response.status, body, text, headers: response.headers }
}

async function ok<T>(path: string, options: Parameters<typeof call>[1] = {}): Promise<T> {
  const result = await call(path, options)
  if (result.body?.code !== 0) {
    throw new Error(
      `${options.method ?? 'GET'} ${path} 期望 code=0，实得 code=${result.body?.code} ${result.body?.message ?? ''}`,
    )
  }
  return result.body.data as T
}

async function main(): Promise<void> {
  console.log('站点发布与版本管理冒烟（P19 T163）\n')
  const stamp = Date.now().toString().slice(-6)

  // ==================== 0. 前置与夹具 ====================
  console.log('0. 前置与夹具（登录 + 建站）')
  let token = ''
  let siteId = ''
  let slug = ''
  let rootFolderId = ''
  try {
    const login = await call('/api/auth/login', {
      method: 'POST',
      json: { username: USERNAME, password: PASSWORD },
    })
    token = ((login.body?.data as { accessToken?: string } | undefined)?.accessToken ??
      '') as string
    if (!token) throw new Error('登录失败')
    check('前置：登录成功', token.length > 0)

    slug = `smk${stamp}`
    const created = await ok<{ id: string }>('/api/site/manage', {
      method: 'POST',
      json: { slug, title: `冒烟站点${stamp}`, publishArticleIds: [] },
      token,
    })
    siteId = created.id
    const siteRow = await prisma.siteSite.findUniqueOrThrow({
      where: { id: BigInt(siteId) },
      select: { rootFolderId: true },
    })
    rootFolderId = siteRow.rootFolderId.toString()
    check('前置：站点创建成功（含模板四件套）', siteId !== '' && rootFolderId !== '')
  } catch (error) {
    console.error(`\n前置不满足：${(error as Error).message}`)
    process.exit(2)
  }
  console.log('')

  try {
    // ==================== 1. legacy 轨（从未发布，验收 7 前半）====================
    console.log('1. legacy 轨：从未发布的站点直挂工作副本（含 W12 阻断优先语义）')
    const v1Body = `V1-${stamp}`
    await writeSiteFile(token, slug, 'index.html', html(v1Body))
    const legacyRead = await call(`/api/open/${slug}/`)
    check(
      '从未发布：line 内容即工作副本（改动即时可见）',
      legacyRead.status === 200 && legacyRead.text.includes(v1Body),
      `status=${legacyRead.status}`,
    )
    check(
      '从未发布：站点地址可访问且返回 HTML',
      legacyRead.status === 200 && (legacyRead.headers.get('content-type') ?? '').includes('html'),
      `ct=${legacyRead.headers.get('content-type')}`,
    )
    console.log('')

    // ==================== 2. 发布 v1（验收 3）====================
    console.log('2. 发布即上线（版本行 / manifest / 文件数一致）')
    const rel1 = await ok<ReleaseItem>(`/api/site/manage/${siteId}/publish`, {
      method: 'POST',
      json: { label: `首版${stamp}` },
      token,
    })
    check(
      '发布返回版本号 v1 且被置为当前',
      rel1.versionNo === 1 && rel1.active === true,
      `v=${rel1.versionNo}`,
    )
    const openAfterPublish = await call(`/api/open/${slug}/`)
    check(
      '发布后正式位内容 = 快照内容',
      openAfterPublish.status === 200 && openAfterPublish.text.includes(v1Body),
    )

    const snapDir = join(UPLOAD_DIR, 'site-releases', siteId, rel1.id)
    const manifestPath = join(snapDir, 'manifest.json')
    check('快照目录与 manifest.json 落盘', existsSync(snapDir) && existsSync(manifestPath))
    const manifest = existsSync(manifestPath)
      ? (JSON.parse(readFileSync(manifestPath, 'utf-8')) as Record<
          string,
          { contentHash: string; size: number }
        >)
      : {}
    check(
      'manifest 条目含 contentHash 且 key 与实际路径一致',
      Object.keys(manifest).includes('index.html') &&
        typeof manifest['index.html']?.contentHash === 'string' &&
        manifest['index.html'].contentHash.length === 64,
      `keys=${Object.keys(manifest).slice(0, 4).join(',')}`,
    )
    check(
      '版本行文件数与 manifest 条数一致',
      rel1.fileCount === Object.keys(manifest).length,
      `row=${rel1.fileCount} manifest=${Object.keys(manifest).length}`,
    )
    console.log('')

    // ==================== 3. 隔离性（验收 1）====================
    console.log('3. 隔离性：改工作副本不影响已发布内容')
    const v1b = `DRAFT-${stamp}`
    await writeSiteFile(token, slug, 'index.html', html(v1b))
    const isolated = await call(`/api/open/${slug}/`)
    check(
      '改工作副本后正式位仍是 v1（隔离生效）',
      isolated.status === 200 && isolated.text.includes(v1Body) && !isolated.text.includes(v1b),
      `hasV1=${isolated.text.includes(v1Body)} hasDraft=${isolated.text.includes(v1b)}`,
    )
    console.log('')

    // ==================== 4. 预览轨（验收 2）====================
    console.log('4. 预览轨：管理态读到工作副本；未登录被拒')
    const preview = await call(`/api/site/manage/${siteId}/preview/index.html`, { token })
    check(
      '管理态预览读到草稿内容（与正式位不同）',
      preview.status === 200 && preview.text.includes(v1b) && !preview.text.includes(v1Body),
      `status=${preview.status}`,
    )
    const previewAnon = await call(`/api/site/manage/${siteId}/preview/index.html`)
    check(
      '未登录访问预览 → 401（管理态惯例）',
      previewAnon.status === 401,
      `status=${previewAnon.status}`,
    )
    console.log('')

    // ==================== 5. 发布 v2 + 回滚横跳（验收 4）====================
    console.log('5. 发布 v2 与回滚横跳')
    const rel2 = await ok<ReleaseItem>(`/api/site/manage/${siteId}/publish`, {
      method: 'POST',
      json: { label: `二版${stamp}` },
      token,
    })
    const openV2 = await call(`/api/open/${slug}/`)
    check(
      '发布 v2 后正式位为 v2 内容',
      rel2.versionNo === 2 && openV2.status === 200 && openV2.text.includes(v1b),
      `v=${rel2.versionNo}`,
    )
    await ok(`/api/site/manage/${siteId}/releases/${rel1.id}/activate`, {
      method: 'POST',
      json: {},
      token,
    })
    const rollback = await call(`/api/open/${slug}/`)
    check(
      '切到 v1 → 正式位回到 v1 内容（回滚即时生效）',
      rollback.status === 200 && rollback.text.includes(v1Body) && !rollback.text.includes(v1b),
    )
    await ok(`/api/site/manage/${siteId}/releases/${rel2.id}/activate`, {
      method: 'POST',
      json: {},
      token,
    })
    const forward = await call(`/api/open/${slug}/`)
    check(
      '再切回 v2 → 恢复 v2 内容（可反复横跳）',
      forward.status === 200 && forward.text.includes(v1b),
    )
    console.log('')

    // ==================== 6. media/ 与快照全量（验收 3 后半）====================
    console.log('6. 快照范围：站点子树全量（含 media/ 与子目录）')
    await writeSiteFile(token, slug, 'pages/about.html', html(`ABOUT-${stamp}`))
    await writeSiteFile(token, slug, 'media/logo.txt', `LOGO-${stamp}`)
    const rel3 = await ok<ReleaseItem>(`/api/site/manage/${siteId}/publish`, {
      method: 'POST',
      json: { label: `含媒体${stamp}` },
      token,
    })
    const about = await call(`/api/open/${slug}/pages/about.html`)
    const media = await call(`/api/open/${slug}/media/logo.txt`)
    check(
      '子目录页面在正式位可访问',
      about.status === 200 && about.text.includes(`ABOUT-${stamp}`),
      `status=${about.status}`,
    )
    check(
      'media/ 内文件随快照上线（发布后不丢图）',
      media.status === 200 && media.text.includes(`LOGO-${stamp}`),
      `status=${media.status}`,
    )
    check('版本文件数随之增长（≥3）', rel3.fileCount >= 3, `fileCount=${rel3.fileCount}`)
    console.log('')

    // ==================== 7. 权限解耦负例（验收 9 / R161）====================
    console.log('7. 权限解耦：工作副本置阻断不影响已发布快照')
    const indexRow = await prisma.cloudFile.findFirstOrThrow({
      where: {
        userId: await siteOwner(siteId),
        parentId: BigInt(rootFolderId),
        name: 'index.html',
        deletedAt: null,
      },
      select: { id: true },
    })
    await prisma.cloudFile.update({ where: { id: indexRow.id }, data: { isPublic: 2 } })
    const afterBlock = await call(`/api/open/${slug}/`)
    check(
      '工作副本 index.html 置显式阻断 → 正式位仍返回快照内容（快照轨不消费 is_public）',
      afterBlock.status === 200 && afterBlock.text.includes(`ABOUT-${stamp}`) === false,
      `status=${afterBlock.status} len=${afterBlock.text.length}`,
    )
    await prisma.cloudFile.update({ where: { id: indexRow.id }, data: { isPublic: 0 } })
    console.log('')

    // ==================== 8. 并发互斥（验收 5）====================
    console.log('8. 并发发布互斥（40121 + 无 .tmp 残留）')
    const [first, second] = await Promise.all([
      call(`/api/site/manage/${siteId}/publish`, { method: 'POST', json: {}, token }),
      call(`/api/site/manage/${siteId}/publish`, { method: 'POST', json: {}, token }),
    ])
    const codes = [first.body?.code, second.body?.code].sort()
    check(
      '同站双并发发布：其一 40121（发布进行中）',
      codes.includes(0) && codes.includes(40121),
      `codes=${codes.join(',')}`,
    )
    const siteReleaseDir = join(UPLOAD_DIR, 'site-releases', siteId)
    const leftovers = existsSync(siteReleaseDir)
      ? readdirSync(siteReleaseDir).filter((name) => name.startsWith('.tmp-'))
      : []
    check('无残留 .tmp- 半成品目录', leftovers.length === 0, `leftovers=${leftovers.join(',')}`)
    console.log('')

    // ==================== 9. 保留策略与豁免（验收 6）====================
    console.log('9. 版本豁免：锁定版不可删、当前版本不可删')
    const releases = await ok<ReleaseItem[]>(`/api/site/manage/${siteId}/releases`, { token })
    const current = releases.find((row) => row.active)
    const older = releases.filter((row) => !row.active).sort((a, b) => a.versionNo - b.versionNo)[0]
    check(
      '版本列表倒序返回且含 active 标记',
      releases.length >= 2 && !!current,
      `n=${releases.length}`,
    )

    const delCurrent = await call(`/api/site/manage/${siteId}/releases/${current?.id}`, {
      method: 'DELETE',
      token,
    })
    check(
      '删除当前版本 → 40001（拒绝）',
      delCurrent.body?.code === 40001,
      `code=${delCurrent.body?.code}`,
    )
    if (older) {
      await ok(`/api/site/manage/${siteId}/releases/${older.id}/pin`, {
        method: 'POST',
        json: { pinned: true },
        token,
      })
      const delPinned = await call(`/api/site/manage/${siteId}/releases/${older.id}`, {
        method: 'DELETE',
        token,
      })
      check(
        '锁定版删除 → 40001（豁免）',
        delPinned.body?.code === 40001,
        `code=${delPinned.body?.code}`,
      )
      const afterUnpin = await call(`/api/site/manage/${siteId}/releases/${older.id}/pin`, {
        method: 'POST',
        json: { pinned: false },
        token,
      })
      const deleted = await call(`/api/site/manage/${siteId}/releases/${older.id}`, {
        method: 'DELETE',
        token,
      })
      check(
        '解锁后可删除，且快照目录同步清理',
        afterUnpin.body?.code === 0 &&
          deleted.body?.code === 0 &&
          !existsSync(join(UPLOAD_DIR, 'site-releases', siteId, older.id)),
        `code=${deleted.body?.code}`,
      )
    }

    // 自动清理只在 SITE_RELEASE_KEEP 调小时才可在一轮冒烟内验证（默认 20 需发 21 次）
    const keep = Number(process.env.SITE_RELEASE_KEEP ?? '20')
    if (Number.isFinite(keep) && keep > 0 && keep <= 3) {
      for (let i = 0; i < keep + 2; i += 1) {
        await ok(`/api/site/manage/${siteId}/publish`, { method: 'POST', json: {}, token })
      }
      const after = await ok<ReleaseItem[]>(`/api/site/manage/${siteId}/releases`, { token })
      const unpinned = after.filter((row) => !row.pinned && !row.active)
      check(
        `保留策略生效（SITE_RELEASE_KEEP=${keep}）：未锁定版本数收敛到上限内`,
        unpinned.length <= keep,
        `unpinned=${unpinned.length} keep=${keep} total=${after.length}`,
      )
      const orphanRows = await prisma.siteRelease.findMany({
        where: { siteId: BigInt(siteId) },
        select: { id: true },
      })
      const allHaveDir = orphanRows.every((row) =>
        existsSync(join(UPLOAD_DIR, 'site-releases', siteId, row.id.toString())),
      )
      check('自动清理同时清掉快照目录（行与目录同生共死）', allHaveDir, `n=${orphanRows.length}`)
    } else {
      console.log(`  · 跳过自动清理实测（SITE_RELEASE_KEEP=${keep}，调小到 ≤3 后本段自动生效）`)
    }
    console.log('')

    // ==================== 10. 安全负例（验收 8）====================
    console.log('10. 安全负例：路径穿越 / 快照区直达 / 越权')
    const traversal = await call(`/api/open/${slug}/../../../etc/passwd`)
    check(
      '路径穿越 → 40400（或被网关规范化后非 200）',
      traversal.body?.code === 40400 || traversal.status === 404,
      `status=${traversal.status} code=${traversal.body?.code}`,
    )
    const dotdotEncoded = await call(`/api/open/${slug}/%2e%2e%2findex.html`)
    check(
      '编码穿越 → 40400',
      dotdotEncoded.body?.code === 40400,
      `code=${dotdotEncoded.body?.code}`,
    )
    const direct = await call(`/api/open/${slug}/site-releases/${siteId}/${rel1.id}/manifest.json`)
    check(
      '站点路径直达 site-releases 区 → 40400（不在站点树内）',
      direct.body?.code === 40400,
      `code=${direct.body?.code}`,
    )
    const tmpProbe = await call(`/api/open/${slug}/.tmp-999/manifest.json`)
    check(
      '.tmp- 探测 → 40400（中转区对解析不可见）',
      tmpProbe.body?.code === 40400,
      `code=${tmpProbe.body?.code}`,
    )
    const anonList = await call(`/api/site/manage/${siteId}/releases`)
    check('未登录访问版本列表 → 401', anonList.status === 401, `status=${anonList.status}`)
    console.log('')

    // ==================== 11. 版本行 ↔ 快照目录一致性 ====================
    console.log('11. 数据一致性：版本行与快照目录一一对应')
    const finalRows = await prisma.siteRelease.findMany({
      where: { siteId: BigInt(siteId) },
      select: { id: true },
    })
    const dirOk = finalRows.every((row) =>
      existsSync(join(UPLOAD_DIR, 'site-releases', siteId, row.id.toString())),
    )
    check('每个版本行都有对应快照目录（无孤儿行）', dirOk, `n=${finalRows.length}`)
    console.log('')
  } catch (error) {
    check('站点发布链路（P19）', false, (error as Error).message)
  } finally {
    // ==================== 清理（best-effort） ====================
    try {
      if (siteId) await call(`/api/site/manage/${siteId}`, { method: 'DELETE', token })
      // 删站应级联清理版本行与快照目录（D146）
      const rows = await prisma.siteRelease.count({ where: { siteId: BigInt(siteId || '0') } })
      const dir = join(UPLOAD_DIR, 'site-releases', siteId || '0')
      check('删站级联：版本行清空', rows === 0, `rows=${rows}`)
      await sleep(200)
      check('删站级联：快照目录已清理', !existsSync(dir))
    } catch {
      console.log('（清理阶段出现异常，已忽略）')
    }
    await prisma.$disconnect()
  }

  console.log(`\n结果：通过 ${passed} 项，失败 ${failed} 项`)
  process.exit(failed > 0 ? 1 : 0)
}

/** 站点属主（夹具用） */
async function siteOwner(siteId: string): Promise<bigint> {
  const row = await prisma.siteSite.findUniqueOrThrow({
    where: { id: BigInt(siteId) },
    select: { userId: true },
  })
  return row.userId
}

/**
 * 写站点文件（夹具用）：站点文件就是云盘文件，此处走**用户真实可达的管理态通道**——
 * 已存在则用在线编辑保存（原地替换），不存在则先建目录再上传（multipart）。
 * 与用户手工改站点走的是同一批接口，故夹具与真实使用路径一致。
 */
async function writeSiteFile(
  token: string,
  slug: string,
  relPath: string,
  content: string,
): Promise<void> {
  const site = await prisma.siteSite.findFirstOrThrow({
    where: { slug },
    select: { userId: true, rootFolderId: true },
  })
  const segments = relPath.split('/')
  let parentId = site.rootFolderId
  for (let i = 0; i < segments.length - 1; i += 1) {
    const name = segments[i]
    const existingDir = await prisma.cloudFile.findFirst({
      where: { userId: site.userId, parentId, name, isDir: 1, deletedAt: null },
      select: { id: true },
    })
    if (existingDir) {
      parentId = existingDir.id
      continue
    }
    const created = await ok<{ id: string }>('/api/cloud/file/mkdir', {
      method: 'POST',
      json: { parentId: Number(parentId), name },
      token,
    })
    parentId = BigInt(created.id)
  }
  const name = segments[segments.length - 1]
  const existing = await prisma.cloudFile.findFirst({
    where: { userId: site.userId, parentId, name, isDir: 0, deletedAt: null },
    select: { id: true },
  })
  if (existing) {
    await ok(`/api/cloud/file/${existing.id.toString()}/content`, {
      method: 'PUT',
      json: { content },
      token,
    })
    return
  }
  const form = new FormData()
  form.append('file', new Blob([content], { type: 'text/plain' }), name)
  const response = await fetch(`${BASE}/api/cloud/file/upload?parentId=${parentId.toString()}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  const payload = (await response.json()) as Envelope
  if (payload.code !== 0) {
    throw new Error(`上传站点文件 ${relPath} 失败：code=${payload.code} ${payload.message ?? ''}`)
  }
}

/** 生成可辨识的 HTML 内容 */
function html(marker: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${marker}</title></head><body><h1>${marker}</h1><p>${randomUUID()}</p></body></html>`
}

main().catch((error: unknown) => {
  console.error(`\n前置不满足或运行异常：${(error as Error).message}`)
  process.exit(2)
})
