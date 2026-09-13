import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../../infra/prisma/prisma.service'

/**
 * 站点根锚点查询（site 域对外暴露的最小能力，P4d T52；P4E T59 多站化）。
 *
 * 背景：cloud 域的 file.list（inSite 标记 R46）与 move / delete（站点根保护 R37 / R52）需要知道
 * 「当前用户的站点根目录」；按域边界铁律（禁跨域 JOIN / 禁直读对方表）cloud 不得直查 site_site，
 * 故由 site 域暴露本服务。
 *
 * 多站语义（P4E R51）：一次查出用户全部站点根 id（站点数受配额限制，集合很小，无需分页），
 * cloud 域的 inSite = 行的祖先链命中「任一」根、isSiteRoot = 行本身是「任一」根。
 *
 * 模块形态：本服务零跨域依赖（仅注入全局 PrismaService），独立成 SiteRootModule 供 cloud 域
 * imports 而不成环——SiteFacadeModule 因注入 CloudFacade 而依赖 CloudModule，cloud 域若 import
 * 它会形成 CloudModule ↔ SiteModule 循环，故不复用（P4d 落地说明，T58 并入架构文档）。
 */
@Injectable()
export class SiteRootService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 用户全部站点根目录 id（P4E R51；未开通站点返回空数组）。
   * 返回 bigint 而非字符串：调用方（cloud 域）需与 cloud_file.id（bigint）直接比较，
   * 进程内不做无谓序列化（出域到前端时才转字符串，见 API-P4E §10.2）。
   */
  async getRootFolderIds(userId: bigint): Promise<bigint[]> {
    const sites = await this.prisma.siteSite.findMany({
      where: { userId },
      select: { rootFolderId: true },
    })
    return sites.map((site) => site.rootFolderId)
  }

  /** id 是否为当前用户的任一站点根目录（未开通站点恒 false） */
  async isSiteRoot(userId: bigint, id: bigint): Promise<boolean> {
    const roots = await this.getRootFolderIds(userId)
    return roots.some((rootId) => rootId === id)
  }
}
