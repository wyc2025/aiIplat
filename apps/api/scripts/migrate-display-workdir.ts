/**
 * P20 B1 数据迁移（可重跑资产）：把展示应用目录从「站点树内」搬到「独立工作区」。
 *
 * 背景：P20 起展示应用目录**恒定位**于 `{display.stagingPath}/{ownerId}/{displayId}/`
 * （与站点树解耦，挂靠只改关系字段、不动文件）。存量数据分布在三处，本脚本统一归位：
 *   ① 正常挂靠态：`{slug}/disp/{id}/`
 *   ② **历史缺陷遗留**：`{slug}/disp/disp/{id}/`（旧 affiliate 移动 `disp` 父目录所致）
 *   ③ 未挂靠态：`{stagingPath}/{uid}/{id}/` —— **已是目标位置，跳过**
 *
 * 幂等：目标位置已有内容 → 跳过该展示应用（可反复执行）。
 * 安全：只做「复制 + 软删旧目录」，旧内容进回收站可还原；不删物理文件。
 *
 * 跑法（apps/api 目录下，**务必在升级后执行一次**）：
 *   pnpm migrate:display-workdir            # 预演（只报告，不改动）
 *   pnpm migrate:display-workdir --apply    # 实际执行
 */
import { randomUUID } from 'node:crypto'
import { readFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { PrismaClient } from '@prisma/client'

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
const APPLY = process.argv.includes('--apply')
const UPLOAD_DIR = resolve(process.env.UPLOAD_DIR ?? './uploads')
const WORK_ROOT = process.env.DISPLAY_WORK_ROOT ?? 'disp-staging'
const DISP_DIR = 'disp'

interface FileRow {
  id: bigint
  parentId: bigint
  name: string
  isDir: number
  storageName: string | null
  size: bigint
  ext: string | null
  mime: string | null
}

/** 读某个目录下的直接子项（未软删） */
async function listChildren(userId: bigint, parentId: bigint): Promise<FileRow[]> {
  return prisma.cloudFile.findMany({
    where: { userId, parentId, deletedAt: null },
    select: {
      id: true,
      parentId: true,
      name: true,
      isDir: true,
      storageName: true,
      size: true,
      ext: true,
      mime: true,
    },
  })
}

/** 按名字逐段下行找目录 id（不存在返回 null） */
async function findDirBySegments(
  userId: bigint,
  segments: string[],
): Promise<bigint | null> {
  let parentId = 0n
  for (const name of segments) {
    const row = await prisma.cloudFile.findFirst({
      where: { userId, parentId, name, isDir: 1, deletedAt: null },
      select: { id: true },
    })
    if (!row) return null
    parentId = row.id
  }
  return parentId
}

/** 递归复制目录树（cloud_file 行 + 物理文件），返回复制出的文件数 */
async function copyTree(
  userId: bigint,
  sourceDirId: bigint,
  targetDirId: bigint,
): Promise<number> {
  let copied = 0
  for (const child of await listChildren(userId, sourceDirId)) {
    if (child.isDir === 1) {
      const created = await prisma.cloudFile.create({
        data: {
          userId,
          parentId: targetDirId,
          name: child.name,
          isDir: 1,
          size: 0n,
          isPublic: 0,
          auditStatus: 1,
        },
        select: { id: true },
      })
      copied += await copyTree(userId, child.id, created.id)
      continue
    }
    // 物理文件：复制到新 storageName（沿用 yyyyMM/uuid.ext 形态）
    let newStorageName: string | null = null
    if (child.storageName) {
      const ext = child.ext ?? ''
      const month = new Date().toISOString().slice(0, 7).replace('-', '')
      const dir = join(UPLOAD_DIR, month)
      const target = join(dir, `${randomUUID()}${ext ? `.${ext}` : ''}`)
      mkdirSync(dirname(target), { recursive: true })
      copyFileSync(join(UPLOAD_DIR, child.storageName), target)
      newStorageName = `${month}/${target.split(/[\\/]/).pop() ?? ''}`
    }
    await prisma.cloudFile.create({
      data: {
        userId,
        parentId: targetDirId,
        name: child.name,
        isDir: 0,
        size: child.size,
        ext: child.ext,
        mime: child.mime,
        storageName: newStorageName,
        isPublic: 0,
        auditStatus: 1,
      },
    })
    copied += 1
  }
  return copied
}

async function main(): Promise<void> {
  console.log(`展示应用目录迁移（P20 B1）｜模式：${APPLY ? '实际执行' : '预演（加 --apply 生效）'}\n`)
  const displays = await prisma.dispDisplay.findMany({
    where: { status: 1, deletedAt: null },
    select: { id: true, ownerId: true, name: true, siteId: true, folderPath: true },
  })
  console.log(`待检查展示应用：${displays.length} 个\n`)

  let migrated = 0
  let skipped = 0
  let missing = 0

  for (const display of displays) {
    const userId = display.ownerId
    const targetRel = `${WORK_ROOT}/${userId.toString()}/${display.id.toString()}`
    const targetSegments = targetRel.split('/')

    // 目标工作区是否已有内容（幂等判据）
    const workDirId = await findDirBySegments(userId, targetSegments)
    if (workDirId !== null) {
      const children = await listChildren(userId, workDirId)
      if (children.length > 0) {
        skipped += 1
        console.log(`  · D${display.id}（${display.name}）已在工作区，跳过`)
        if (APPLY && display.folderPath !== targetRel) {
          await prisma.dispDisplay.update({
            where: { id: display.id },
            data: { folderPath: targetRel },
          })
        }
        continue
      }
    }

    // 旧位置候选（含历史缺陷遗留的双层 disp）
    const candidates: string[][] = []
    if (display.siteId !== null) {
      const site = await prisma.siteSite.findFirst({
        where: { id: display.siteId },
        select: { slug: true },
      })
      if (site) {
        candidates.push([site.slug, DISP_DIR, display.id.toString()])
        // 历史缺陷：旧 affiliate 把整个 disp 移进目标 disp 内 ⇒ {slug}/disp/disp/{id}
        candidates.push([site.slug, DISP_DIR, DISP_DIR, display.id.toString()])
      }
    }

    let sourceDirId: bigint | null = null
    let sourceLabel = ''
    for (const segments of candidates) {
      const found = await findDirBySegments(userId, segments)
      if (found !== null) {
        sourceDirId = found
        sourceLabel = segments.join('/')
        break
      }
    }

    if (sourceDirId === null) {
      missing += 1
      console.log(`  ! D${display.id}（${display.name}）旧位置未找到内容（可能从未写过文件）`)
      if (APPLY && display.folderPath !== targetRel) {
        await prisma.dispDisplay.update({
          where: { id: display.id },
          data: { folderPath: targetRel },
        })
      }
      continue
    }

    const sourceChildren = await listChildren(userId, sourceDirId)
    if (sourceChildren.length === 0) {
      skipped += 1
      console.log(`  · D${display.id}（${display.name}）旧位置为空，跳过`)
      continue
    }

    console.log(
      `  → D${display.id}（${display.name}）：${sourceLabel}  →  ${targetRel}（${sourceChildren.length} 项）`,
    )
    if (!APPLY) {
      migrated += 1
      continue
    }

    // 建目标工作区目录（逐级）
    let parentId = 0n
    for (const name of targetSegments) {
      const existing = await prisma.cloudFile.findFirst({
        where: { userId, parentId, name, isDir: 1, deletedAt: null },
        select: { id: true },
      })
      if (existing) {
        parentId = existing.id
        continue
      }
      const created = await prisma.cloudFile.create({
        data: { userId, parentId, name, isDir: 1, size: 0n, isPublic: 0, auditStatus: 1 },
        select: { id: true },
      })
      parentId = created.id
    }

    const count = await copyTree(userId, sourceDirId, parentId)
    // 旧目录软删（进回收站，用户可还原）——不删物理文件
    await prisma.cloudFile.update({
      where: { id: sourceDirId },
      data: { deletedAt: new Date(), isPublic: 0, publicToken: null },
    })
    await prisma.dispDisplay.update({
      where: { id: display.id },
      data: { folderPath: targetRel },
    })
    console.log(`    ✓ 已迁移 ${count} 个文件，旧目录已移入回收站`)
    migrated += 1
  }

  console.log(`\n汇总：迁移 ${migrated}｜跳过 ${skipped}｜旧位置无内容 ${missing}`)
  if (!APPLY) console.log('\n（预演模式：加 --apply 实际执行）')
  await prisma.$disconnect()
}

main().catch((error: unknown) => {
  console.error(`\n迁移失败：${(error as Error).message}`)
  process.exit(2)
})
