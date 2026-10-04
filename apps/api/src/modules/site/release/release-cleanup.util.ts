import type { PrismaClient } from '@prisma/client'
import type { StorageService } from '../../../infra/storage/storage.service'

/**
 * 清理站点全部发布版本（版本行 + 快照目录树）——**纯函数**（P20）。
 *
 * 为什么不做成服务方法：模块依赖方向。`SiteReleaseService` 需要 `DisplayFacadeModule`
 * （发布时聚合展示应用工作区，B2），而 `DisplayFacadeModule` 经
 * `display.manage → SiteFacadeModule → SiteManageModule` 回指 site 域；
 * 若 `SiteManageModule` 仍 import `SiteReleaseModule`（原为拿 `purgeForSite`）就构成模块环。
 *
 * 删站级联只是「删行 + 删目录」，无业务逻辑，降到纯函数后依赖环自然断开；
 * `SiteReleaseService.purgeForSite` 内部同样委托本函数，避免两处实现漂移。
 *
 * 调用方负责吞异常（best-effort：清理失败不应阻断删站主流程）。
 */
export async function purgeSiteReleaseData(
  prisma: PrismaClient,
  storage: StorageService,
  siteId: bigint,
): Promise<void> {
  const rows = await prisma.siteRelease.findMany({ where: { siteId }, select: { id: true } })
  await prisma.siteRelease.deleteMany({ where: { siteId } })
  for (const row of rows) {
    await storage.removeDir(storage.releaseDirOf(siteId, row.id)).catch(() => undefined)
  }
  // 整站目录一并清理（含异常残留的 `.tmp-` 中转区）
  await storage.removeDir(`site-releases/${siteId.toString()}`).catch(() => undefined)
}
