/**
 * 应用清理手动触发脚本（P11 T101 验收 8：7 天清理任务可手动触发验证）。
 *
 * 与 AppCleanTask 的每日 cron **同源**：两者都调用 `app-clean.core.ts` 的纯函数核心
 * （softDeleteApp / cleanExpiredDraftsCore / purgeDeletedAppsCore），无第二份业务逻辑。
 *
 * 为什么不 bootstrap Nest：本项目脚本用 tsx 直跑，而 tsx/esbuild 不支持
 * emitDecoratorMetadata，Nest 的构造器注入会拿到 undefined；故脚本直接持 PrismaClient
 * 调核心函数（与 prisma/seed.ts 同风格）。TTL 取 APP_DRAFT_TTL_DAYS（默认 7 天）。
 *
 * 运行：pnpm --filter @iplat/api clean:app
 */
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import {
  cleanExpiredDraftsCore,
  purgeDeletedAppsCore,
} from '../src/modules/app/admin/app-clean.core'

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

async function main(): Promise<void> {
  loadEnvFromCwd()
  const prisma = new PrismaClient()
  try {
    const ttlDays = Number(process.env.APP_DRAFT_TTL_DAYS) > 0
      ? Number(process.env.APP_DRAFT_TTL_DAYS)
      : 7
    const drafts = await cleanExpiredDraftsCore(prisma, ttlDays)
    console.log(`草稿清理：扫描 ${drafts.scanned} 个 / 软删 ${drafts.cleaned} 个（TTL ${ttlDays} 天）`)
    const purged = await purgeDeletedAppsCore(prisma)
    console.log(`物理清理：${purged.purged} 个软删超期应用（保留期外）`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error('应用清理脚本执行失败：', error)
  process.exit(1)
})
