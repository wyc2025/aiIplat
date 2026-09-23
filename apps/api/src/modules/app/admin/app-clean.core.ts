import type { PrismaClient } from '@prisma/client'

/**
 * 应用生命周期清理核心（P11 T101/R91）：**纯数据库逻辑**，不依赖 Nest DI。
 *
 * 为什么单独抽出：`scripts/clean-app-drafts.ts` 需以 tsx 直跑（tsx/esbuild 不支持
 * emitDecoratorMetadata，无法 bootstrap Nest），若把逻辑写在 Service 里脚本只能复写一遍；
 * 抽出后 AdminService（cron 链）与手动脚本共用同一实现，杜绝第二份逻辑。
 */

/** 软删应用的数据保留期（天）：软删后立即 404，数据保留 30 天后物理清理（照回收站口径） */
export const APP_DELETED_RETENTION_DAYS = 30

const DAY_MS = 24 * 60 * 60 * 1000

/** 级联软删（应用 + 表/字段/页/关系）；记录与附件引用保留至物理清理（30 天） */
export async function softDeleteApp(db: PrismaClient, appId: bigint): Promise<void> {
  const now = new Date()
  const tables = await db.appTable.findMany({
    where: { appId, deletedAt: null },
    select: { id: true },
  })
  const tableIds = tables.map((table) => table.id)
  await db.$transaction([
    db.appDef.update({ where: { id: appId }, data: { deletedAt: now } }),
    db.appTable.updateMany({ where: { appId, deletedAt: null }, data: { deletedAt: now } }),
    db.appField.updateMany({
      where: { tableId: { in: tableIds }, isDeleted: 0 },
      data: { isDeleted: 1, deletedAt: now },
    }),
    db.appPage.updateMany({ where: { appId, deletedAt: null }, data: { deletedAt: now } }),
    db.appRel.updateMany({ where: { appId, deletedAt: null }, data: { deletedAt: now } }),
  ])
}

/** 软删过期草稿（R91：ttlDays 天未确认自动清理）；ids 供调用方失效 schema 缓存 */
export async function cleanExpiredDraftsCore(
  db: PrismaClient,
  ttlDays: number,
): Promise<{ scanned: number; cleaned: number; ids: bigint[] }> {
  const deadline = new Date(Date.now() - ttlDays * DAY_MS)
  const drafts = await db.appDef.findMany({
    where: { status: 'draft', deletedAt: null, createdAt: { lt: deadline } },
    select: { id: true },
  })
  for (const draft of drafts) {
    await softDeleteApp(db, draft.id)
  }
  return { scanned: drafts.length, cleaned: drafts.length, ids: drafts.map((draft) => draft.id) }
}

/** 物理清理软删超期应用（数据保留 30 天）；ids 供调用方失效 schema 缓存 */
export async function purgeDeletedAppsCore(
  db: PrismaClient,
): Promise<{ purged: number; ids: bigint[] }> {
  const deadline = new Date(Date.now() - APP_DELETED_RETENTION_DAYS * DAY_MS)
  const apps = await db.appDef.findMany({
    where: { deletedAt: { not: null, lt: deadline } },
    select: { id: true },
  })
  for (const app of apps) {
    const tables = await db.appTable.findMany({ where: { appId: app.id }, select: { id: true } })
    const tableIds = tables.map((table) => table.id)
    await db.$transaction([
      db.appRecord.deleteMany({ where: { appId: app.id } }),
      db.appAttachmentRef.deleteMany({ where: { appId: app.id } }),
      db.appField.deleteMany({ where: { tableId: { in: tableIds } } }),
      db.appRel.deleteMany({ where: { appId: app.id } }),
      db.appPage.deleteMany({ where: { appId: app.id } }),
      db.appTable.deleteMany({ where: { appId: app.id } }),
      db.appDef.delete({ where: { id: app.id } }),
    ])
  }
  return { purged: apps.length, ids: apps.map((app) => app.id) }
}
