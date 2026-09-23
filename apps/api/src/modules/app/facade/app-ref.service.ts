import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../../infra/prisma/prisma.service'

/** 附件引用信息（供 cloud 域删除预检回喂 30021 文案） */
export interface AppAttachmentRefInfo {
  fileId: string
  appId: string
  appName: string
  count: number
}

/**
 * app 域「反向引用」最小门面（P11 T100，D96）：
 * 只回答「这批云盘文件是否被本用户的数据应用引用」，不触碰 app_record.data。
 *
 * 独立成模块（照 SiteRootModule / CloudFacadeModule 先例）：

 * cloud 域（FileService / RecycleService）需要在删除链路里做 30021 预检，
 * 但 cloud 域若 import 完整 AppFacadeModule（依赖 app 的 Admin/Schema/Data 子模块，
 * 后者又依赖 CloudFacadeModule）会成环；本模块零跨域 import（仅全局 PrismaService），
 * 故 cloud → AppRefModule 安全，无循环依赖。
 */
@Injectable()
export class AppRefService {
  constructor(private readonly prisma: PrismaService) {}

  /** 用户 active/草稿应用 id 集合（软删过滤） */
  private async ownerAppIds(userId: bigint): Promise<Array<{ id: bigint; name: string }>> {
    return this.prisma.appDef.findMany({
      where: { ownerId: userId, deletedAt: null },
      select: { id: true, name: true },
    })
  }

  /**
   * 查「该用户的某个应用」对给定云盘文件的引用（按 (appId,fileId) 聚合计数）。
   * 只查 app_attachment_ref（deleted_at 过滤）+ app_def（限定属主），不读 app_record.data。
   */
  async getAttachmentRefs(
    userId: bigint,
    fileIds: readonly bigint[],
  ): Promise<AppAttachmentRefInfo[]> {
    if (fileIds.length === 0) return []
    const apps = await this.ownerAppIds(userId)
    if (apps.length === 0) return []
    const nameOf = new Map(apps.map((app) => [app.id.toString(), app.name]))
    const rows = await this.prisma.appAttachmentRef.groupBy({
      by: ['appId', 'fileId'],
      where: {
        appId: { in: apps.map((app) => app.id) },
        fileId: { in: [...fileIds] },
        deletedAt: null,
      },
      _count: { _all: true },
    })
    return rows.map((row) => ({
      fileId: row.fileId.toString(),
      appId: row.appId.toString(),
      appName: nameOf.get(row.appId.toString()) ?? '未知应用',
      count: row._count._all,
    }))
  }

  /** 是否有引用（cloud 预检快速判定） */
  async hasAttachmentRefs(userId: bigint, fileIds: readonly bigint[]): Promise<boolean> {
    return (await this.getAttachmentRefs(userId, fileIds)).length > 0
  }

  /** 是否存在任何附件引用（删用户预检预留；P11 本期不接线） */
  async hasAnyAttachmentRef(userId: bigint): Promise<boolean> {
    const apps = await this.ownerAppIds(userId)
    if (apps.length === 0) return false
    const count = await this.prisma.appAttachmentRef.count({
      where: { appId: { in: apps.map((app) => app.id) }, deletedAt: null },
    })
    return count > 0
  }
}
