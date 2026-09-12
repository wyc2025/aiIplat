import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../../infra/prisma/prisma.service'

/**
 * 站点根锚点查询（site 域对外暴露的最小能力，P4d T52）。
 *
 * 背景：cloud 域的 file.list（inSite 标记 R46）与 move（站点根保护 R37）需要知道
 * 「当前用户的站点根目录」；按域边界铁律（禁跨域 JOIN / 禁直读对方表）cloud 不得直查 site_site，
 * 故由 site 域暴露本服务。
 *
 * 模块形态：本服务零跨域依赖（仅注入全局 PrismaService），独立成 SiteRootModule 供 cloud 域
 * imports 而不成环——SiteFacadeModule 因注入 CloudFacade 而依赖 CloudModule，cloud 域若 import
 * 它会形成 CloudModule ↔ SiteModule 循环，故不复用（P4d 落地说明，T58 并入架构文档）。
 */
@Injectable()
export class SiteRootService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 用户站点根目录 id；未开通站点返回 null。
   * 只返回 id 本身：后续上溯/子树判定由调用方在自己域内完成（cloud 侧遍历 cloud_file），
   * 避免本服务反向读 cloud 域的表。
   */
  async getRootFolderId(userId: bigint): Promise<bigint | null> {
    const site = await this.prisma.siteSite.findFirst({
      where: { userId },
      select: { rootFolderId: true },
    })
    return site?.rootFolderId ?? null
  }

  /** id 是否为当前用户的站点根目录（未开通站点恒 false） */
  async isSiteRoot(userId: bigint, id: bigint): Promise<boolean> {
    const rootId = await this.getRootFolderId(userId)
    return rootId !== null && rootId === id
  }
}
