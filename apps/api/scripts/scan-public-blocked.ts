/**
 * W12 存量扫描（T165 §3-#4）：找出「祖先链含显式阻断（`is_public=2`）、但自身为显式公开（`is_public=1`）」的文件。
 *
 * 这类文件在**现行** `/api/open/**` 判定链（`1` 可穿透父级 `2`）下**可被站点访问**；W12 收窄为
 * 「阻断优先」后将被阻断（40400）。收紧类变更按纪律先出报告、**经用户确认再合入**（W12 §3-#4），
 * 故本脚本是合入前的门禁资产（可重跑，长期保留）。
 *
 * 运行：`pnpm scan:pubblock`（或 `pnpm exec tsx scripts/scan-public-blocked.ts`）
 * 退出码：0 = 无受影响文件（可直接合入）；1 = 有受影响文件（需用户确认）；2 = 运行异常。
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

/** 上溯深度上限（与 resolvePublicPath 的 RESOLVE_MAX_DEPTH 同量级，防环） */
const MAX_DEPTH = 60

interface Row {
  id: bigint
  parentId: bigint
  name: string | null
  isPublic: number | null
  isDir: number
  userId: bigint
}

async function main(): Promise<void> {
  const rows = (await prisma.cloudFile.findMany({
    where: { deletedAt: null },
    select: { id: true, parentId: true, name: true, isPublic: true, isDir: true, userId: true },
  })) as Row[]
  const byId = new Map<string, Row>(rows.map((row) => [row.id.toString(), row]))
  console.log(`未删除 cloud_file 行数：${rows.length}`)

  let explicitPublic = 0
  let explicitBlocked = 0
  const affected: Array<{ path: string; id: string; blocker: string }> = []

  for (const row of rows) {
    if (row.isPublic === 2) explicitBlocked += 1
    if (row.isPublic !== 1) continue
    explicitPublic += 1

    // 上溯祖先链：任一祖先为显式阻断（2）→ 该行在 W12 后将被阻断
    let cursor = byId.get(row.parentId.toString())
    let depth = 0
    const chain: string[] = []
    while (cursor && depth <= MAX_DEPTH) {
      chain.push(cursor.name ?? '?')
      if (cursor.isPublic === 2) {
        affected.push({
          path: [...chain].reverse().join('/'),
          id: row.id.toString(),
          blocker: cursor.name ?? '?',
        })
        break
      }
      if (cursor.parentId === BigInt(0)) break
      cursor = byId.get(cursor.parentId.toString())
      depth += 1
    }
  }

  console.log(`显式公开（is_public=1）行数：${explicitPublic}`)
  console.log(`显式阻断（is_public=2）行数：${explicitBlocked}`)
  console.log(`⚠ 受 W12 收紧影响的文件数（祖先链含阻断 + 自身显式公开）：${affected.length}`)
  for (const item of affected.slice(0, 50)) {
    console.log(`  - ${item.path}  （id=${item.id}，阻断祖先=「${item.blocker}」）`)
  }
  if (affected.length > 50) console.log(`  …其余 ${affected.length - 50} 条略`)

  await prisma.$disconnect()
  if (affected.length > 0) {
    console.log('\n结论：**存在受影响文件，需用户确认后再合入 W12**（收紧类变更纪律）。')
    process.exit(1)
  }
  console.log('\n结论：无受影响文件，W12 可直接合入（无站点内容被收紧）。')
  process.exit(0)
}

main().catch((error: unknown) => {
  console.error(`扫描异常：${(error as Error).message}`)
  process.exit(2)
})
