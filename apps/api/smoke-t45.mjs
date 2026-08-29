/**
 * T45 联调冒烟脚本（临时，验证后删除）：补验 PRD-P4B §6 中 T41~T44 未覆盖的条目。
 * - 验收 3  覆盖回滚：AI 覆盖 index.html → 回收站见旧版 → 删新版 + 还原旧版 → 站点恢复
 * - 验收 5  部分成功（配额不足）：构造剩余空间小于批量总大小 → 逐文件明细、失败无残留行
 * - 验收 11 三态行为陷阱可视：公开目录下文件"取消公开"→ 开放层 404 + 列表「已阻断」
 * - 验收 12 权限：无权限用户工具过滤看不到三件套；直调 apply-template / PUT content → 40300
 * - 验收 2  AI 建站全链路（真实模型，先读后写 + 一张确认卡 + 确认后立即生效）
 */
import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import { AppModule } from './dist/app.module.js'

const results = []
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail })
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  | ' + detail : ''}`)
}

const API = 'http://127.0.0.1:3001/api'

async function main() {
  // 与 main.ts 同构
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'], bodyParser: false })
  app.setGlobalPrefix('api')
  app.useBodyParser('json', { limit: '2mb' })
  app.useBodyParser('urlencoded', { limit: '2mb', extended: true })
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
  await app.listen(3001)

  const { ToolRegistry } = await import('./dist/modules/ai/tool/tool.registry.js')
  const { ChatService } = await import('./dist/modules/ai/chat/chat.service.js')
  const { SiteManageService } = await import('./dist/modules/site/manage/manage.service.js')
  const { PrismaService } = await import('./dist/infra/prisma/prisma.service.js')
  const { RedisService } = await import('./dist/infra/redis/redis.service.js')
  const { StorageService } = await import('./dist/infra/storage/storage.service.js')
  const { JwtService } = await import('@nestjs/jwt')

  const registry = app.get(ToolRegistry)
  const chatService = app.get(ChatService)
  const manage = app.get(SiteManageService)
  const prisma = app.get(PrismaService)
  const redis = app.get(RedisService)
  const storage = app.get(StorageService)
  const jwt = app.get(JwtService)
  const jwtSecret = app.get((await import('@nestjs/config')).ConfigService).getOrThrow('jwt.accessSecret')

  async function cleanupUser(id) {
    const files = await prisma.cloudFile.findMany({ where: { userId: id } })
    for (const f of files) {
      if (f.storageName) await storage.remove(f.storageName).catch(() => undefined)
    }
    await prisma.cloudFile.deleteMany({ where: { userId: id } })
    await prisma.cloudUsage.deleteMany({ where: { userId: id } })
    const sites = await prisma.siteSite.findMany({ where: { userId: id } })
    for (const s of sites) {
      await redis.scanDel(`site:path:${s.id.toString()}:*`).catch(() => undefined)
      await redis.client.del(`site:resolve:${s.slug}`).catch(() => undefined)
    }
    await prisma.siteSite.deleteMany({ where: { userId: id } })
    await prisma.sysUserRole.deleteMany({ where: { userId: id } })
    await prisma.sysUser.deleteMany({ where: { id } })
  }

  const adminRole = await prisma.sysRole.findFirst({ where: { code: 'admin' } })
  for (const name of ['t45smoke', 't45noperm']) {
    const legacy = await prisma.sysUser.findFirst({ where: { username: name } })
    if (legacy) await cleanupUser(legacy.id)
  }
  const user = await prisma.sysUser.create({ data: { username: 't45smoke', password: 'x', nickname: 'T45Smoke' } })
  const noPermUser = await prisma.sysUser.create({ data: { username: 't45noperm', password: 'x', nickname: 'T45NoPerm' } })
  if (adminRole) await prisma.sysUserRole.create({ data: { userId: user.id, roleId: adminRole.id } })
  await redis.client.set(`user:perms:${user.id.toString()}`, JSON.stringify(['*']), 'EX', 7200)
  const userId = user.id.toString()

  const token = jwt.sign({ sub: userId, username: 't45smoke', jti: 't45-smoke-jti' }, { secret: jwtSecret, expiresIn: '2h' })
  const noPermToken = jwt.sign({ sub: noPermUser.id.toString(), username: 't45noperm', jti: 't45-noperm-jti' }, { secret: jwtSecret, expiresIn: '2h' })
  const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }

  const writeTool = registry.get('write_site_files')
  const listTool = registry.get('list_site_files')
  const chatConvs = []

  /** 读 SSE 流（同 T42 冒烟） */
  async function readSse(url, body, tk, onEvent) {
    const controller = new AbortController()
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` }, body: JSON.stringify(body), signal: controller.signal })
    const decoder = new TextDecoder()
    let buf = ''
    const events = []
    const done = (async () => {
      try {
        for await (const chunk of res.body) {
          buf += decoder.decode(chunk, { stream: true })
          let idx
          while ((idx = buf.indexOf('\n\n')) >= 0) {
            const raw = buf.slice(0, idx)
            buf = buf.slice(idx + 2)
            for (const line of raw.split('\n')) {
              if (!line.startsWith('data:')) continue
              try {
                const ev = JSON.parse(line.slice(5).trim())
                events.push(ev)
                await onEvent?.(ev)
              } catch { /* 忽略 */ }
            }
          }
        }
      } catch { /* abort */ }
    })()
    return { events, abort: () => controller.abort(), done }
  }

  try {
    const site = await manage.create(BigInt(userId), { slug: 't45smoke', title: 'T45冒烟站' })
    const listBefore = await listTool.handler({ user: { userId } }, {})
    const index = (listBefore.files ?? []).find((f) => f.path === 'index.html')
    const v1 = await registry.get('read_site_file').handler({ user: { userId } }, { path: 'index.html' })

    // ============ 验收 3：覆盖回滚（回收站还原） ============
    const v2 = '<!doctype html><html><head><meta charset="utf-8"><title>v2</title></head><body><h1>T45 v2</h1></body></html>'
    await writeTool.handler({ user: { userId } }, { files: [{ path: 'index.html', content: v2 }] })
    const recycleRes = await fetch(`${API}/cloud/recycle/list`, { headers: { Authorization: `Bearer ${token}` } })
    const recycleBody = await recycleRes.json()
    const oldRow = (recycleBody.data ?? []).find((r) => r.name === 'index.html')
    check('3a 覆盖后回收站可见旧版 index.html', !!oldRow, JSON.stringify((recycleBody.data ?? []).map((r) => r.name)))

    const newRowIndex = await prisma.cloudFile.findFirst({ where: { userId: BigInt(userId), deletedAt: null, name: 'index.html' } })
    await fetch(`${API}/cloud/file/${newRowIndex.id.toString()}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
    const restoreRes = await fetch(`${API}/cloud/recycle/restore`, { method: 'POST', headers: H, body: JSON.stringify({ id: Number(oldRow.id) }) })
    const restoreBody = await restoreRes.json()
    const restored = await registry.get('read_site_file').handler({ user: { userId } }, { path: 'index.html' })
    check(
      '3b 删新版 + 还原旧版 → 站点恢复 v1 内容（路径语义无需其他操作）',
      restoreBody.code === 0 && restored.content === v1.content,
      JSON.stringify(restoreBody).slice(0, 120),
    )

    // ============ 验收 11：阻断后开放层 404（行为陷阱可视） ============
    // 设计口径（§14.4/PLATFORM-GUIDE）：cloud 侧公开性变更靠 site:path 60s TTL 被动生效；
    // 冒烟以 DEL 缓存模拟 TTL 过期，验证"过期后阻断文件 404 + 列表已阻断"
    const restoredRowId = restoreBody.data.id
    const siteIdStr = site.id.toString()
    await fetch(`${API}/cloud/file/set-public`, { method: 'POST', headers: H, body: JSON.stringify({ id: Number(restoredRowId), isPublic: 0 }) })
    await redis.client.del(`site:path:${siteIdStr}:index.html`).catch(() => undefined)
    // 开放层资源失败 = HTTP 200 + 统一体 code=40400（§14.4，防探测口径）
    const blockedBody = await (await fetch(`${API}/open/t45smoke/`)).json()
    const listRes = await fetch(`${API}/cloud/file/list?parentId=${Number(site.rootFolderId)}`, { headers: { Authorization: `Bearer ${token}` } })
    const listBody = await listRes.json()
    const blockedItem = (listBody.data?.list ?? []).find((f) => f.name === 'index.html')
    check(
      '11 公开目录下"取消公开"→（TTL 过期后）开放层 40400 + 列表 isPublic=2（W2 行为陷阱可视）',
      blockedBody.code === 40400 && blockedItem?.isPublic === 2,
      `code=${blockedBody.code} isPublic=${blockedItem?.isPublic}`,
    )
    await fetch(`${API}/cloud/file/set-public`, { method: 'POST', headers: H, body: JSON.stringify({ id: Number(restoredRowId), isPublic: 1 }) })
    await redis.client.del(`site:path:${siteIdStr}:index.html`).catch(() => undefined)
    const listAfter = await (await fetch(`${API}/cloud/file/list?parentId=${Number(site.rootFolderId)}`, { headers: { Authorization: `Bearer ${token}` } })).json()
    const publicItem = (listAfter.data?.list ?? []).find((f) => f.name === 'index.html')
    check('11b 恢复公开 → 开放层 200 + 列表 isPublic=1', (await fetch(`${API}/open/t45smoke/`)).status === 200 && publicItem?.isPublic === 1)

    // ============ 验收 5：配额不足部分成功 ============
    const usage = await prisma.cloudUsage.findUnique({ where: { userId: BigInt(userId) } })
    const tightQuota = usage.used + BigInt(60)
    await prisma.cloudUsage.update({ where: { userId: BigInt(userId) }, data: { quota: tightQuota } })
    const partial = await writeTool.handler({ user: { userId } }, {
      files: [
        { path: 'small-t45.txt', content: 'a'.repeat(30) },
        { path: 'big-t45.txt', content: 'b'.repeat(200) },
      ],
    })
    const smallResult = (partial ?? []).find((r) => r.path === 'small-t45.txt')
    const bigResult = (partial ?? []).find((r) => r.path === 'big-t45.txt')
    const bigRow = await prisma.cloudFile.findFirst({ where: { userId: BigInt(userId), deletedAt: null, name: 'big-t45.txt' } })
    check(
      '5 配额不足：ok 文件落盘 / 超额文件 30003 明细 / 失败无残留行',
      smallResult?.ok === true && bigResult?.ok === false && /配额/.test(bigResult?.error ?? '') && !bigRow,
      JSON.stringify(partial),
    )
    await prisma.cloudUsage.update({ where: { userId: BigInt(userId) }, data: { quota: BigInt(1024 * 1024 * 1024) } })

    // ============ 验收 12：权限 ============
    const modelStub = { supportTool: 1 }
    const { tools } = await chatService.getAvailableTools({ userId: noPermUser.id.toString(), username: 't45noperm', jti: 'x', iat: 0, exp: 0 }, modelStub)
    const toolNames = tools.map((t) => t.name)
    check(
      '12a 无 site:site:manage 用户：工具过滤后模型看不到三件套',
      !toolNames.includes('list_site_files') && !toolNames.includes('read_site_file') && !toolNames.includes('write_site_files') && toolNames.length > 0,
      JSON.stringify(toolNames),
    )
    const res403a = await fetch(`${API}/site/mine/apply-template`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${noPermToken}` }, body: JSON.stringify({ templateId: 'card' }) })
    const res403b = await fetch(`${API}/cloud/file/${newRowIndex.id}/content`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${noPermToken}` }, body: JSON.stringify({ content: 'x' }) })
    check('12b 无权限直调：apply-template / PUT content 均 40300', (await res403a.json()).code === 40300 && (await res403b.json()).code === 40300)

    // ============ 验收 2：真实模型全链路（先读后写 + 一张确认卡 + 立即生效） ============
    // 给测试用户配套餐（复制 admin 套餐行结构）
    const adminPlanRow = await prisma.aiUserPlan.findFirst({ where: { userId: BigInt(1) } })
    if (adminPlanRow) {
      await prisma.aiUserPlan.create({
        data: {
          userId: BigInt(userId),
          planId: adminPlanRow.planId,
          totalCredits: adminPlanRow.totalCredits,
          usedCredits: BigInt(0),
          cycleStart: adminPlanRow.cycleStart,
          cycleEnd: adminPlanRow.cycleEnd,
        },
      })
    }
    const model = await prisma.aiModel.findFirst({ where: { status: 1, supportTool: 1 } })
    // 被改路径在确认后才知道（模型可能改 index.html 或 style.css），先记录两份基准
    const beforeIndex = await (await fetch(`${API}/open/t45smoke/index.html`)).text()
    const beforeStyle = await (await fetch(`${API}/open/t45smoke/style.css`)).text()

    let confirmEv = null
    let readResults = 0
    let convId = null
    const evTypes = []
    for (let attempt = 1; attempt <= 3 && !confirmEv; attempt++) {
      confirmEv = null
      readResults = 0
      const s = await readSse(
        `${API}/ai/chat`,
        {
          modelId: Number(model.id.toString()),
          content: '我想把首页换成深色主题。请先用工具查看我的站点文件列表，并读取 README.txt 和 index.html 了解现状，然后调用写入工具把 index.html 改成深色主题版本（黑底浅字）。读完再写，写完停下等确认。',
        },
        token,
        (ev) => {
          evTypes.push(ev.type)
          if (ev.type === 'meta') convId = ev.conversationId
          if (ev.type === 'tool_result') readResults++
          if (ev.type === 'tool_confirm') confirmEv = ev
        },
      )
      await Promise.race([s.done, new Promise((r) => setTimeout(r, 120000))])
      s.abort()
      if (convId) chatConvs.push(convId)
      if (!confirmEv) console.log(`  (attempt ${attempt} 未取到确认卡：${evTypes.filter((t) => t !== 'delta').join(',')})`)
    }
    const sumList = confirmEv?.summary
    check(
      '2a 先读后写：读取类工具结果先于确认卡（≥2 次），确认卡结构化清单',
      readResults >= 2 && Array.isArray(sumList) && sumList.length >= 1 && sumList.every((i) => i.path && i.action && typeof i.size === 'number'),
      `reads=${readResults} summary=${JSON.stringify(sumList)} events=${evTypes.filter((t) => t !== 'delta').join(',')}`,
    )

    if (confirmEv) {
      let confirmDone = false
      const c = await readSse(`${API}/ai/tool/confirm`, { toolCallId: Number(confirmEv.toolCallId), approved: true }, token, (ev) => {
        if (ev.type === 'done') confirmDone = true
      })
      await Promise.race([c.done, new Promise((r) => setTimeout(r, 120000))])
      // 按 confirm 卡实际写入路径对比开放层内容（模型可能改 index.html 或 style.css）
      const targetPath = confirmEv.summary?.[0]?.path ?? 'index.html'
      const beforeText = targetPath === 'style.css' ? beforeStyle : beforeIndex
      const afterText = await (await fetch(`${API}/open/t45smoke/${targetPath}`)).text()
      check(
        '2b 确认后访客立即可见新内容（D28 no-cache + site:path 精确失效）',
        confirmDone && afterText !== beforeText,
        `${targetPath} len ${beforeText.length} → ${afterText.length}`,
      )
    }

    void site
  } finally {
    try {
      const usage = await prisma.aiUsageLog.findMany({ where: { conversationId: { in: chatConvs.map((c) => BigInt(c)) } } })
      void usage
      for (const cid of chatConvs) {
        await prisma.aiToolCall.deleteMany({ where: { conversationId: BigInt(cid) } })
        await prisma.aiMessage.deleteMany({ where: { conversationId: BigInt(cid) } })
        await prisma.aiUsageLog.deleteMany({ where: { conversationId: BigInt(cid) } })
      }
      await prisma.aiConversation.deleteMany({ where: { userId: BigInt(userId), id: { in: chatConvs.map((c) => BigInt(c)) } } })
      await cleanupUser(BigInt(userId))
      await cleanupUser(noPermUser.id)
      console.log('CLEANUP done')
    } catch (e) {
      console.error('CLEANUP error', e)
    }
    await app.close()
  }

  const failed = results.filter((r) => !r.ok)
  console.log(`\n==== ${results.length - failed.length}/${results.length} passed ====`)
  process.exit(failed.length > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
