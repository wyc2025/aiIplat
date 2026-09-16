import { Injectable } from '@nestjs/common'
import { ErrorCode } from '../../../common/constants/error-code'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { RedisService } from '../../../infra/redis/redis.service'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import type { ColumnSitesDto, CreateColumnDto, UpdateColumnDto } from './dto/column.dto'

/** 栏目树最大层级（R6） */
const MAX_LEVEL = 3

/** 栏目可见站点（列表 item 出口径） */
export interface ColumnSiteItem {
  id: string
  name: string
  slug: string
  sort: number
}

/**
 * 栏目管理（PRD F2 / API.md §6.2；P7 D73 内容池化）：树形 ≤3 级（R6）、
 * 删除保护（有子栏目或文章含草稿 → 40107）、换父级防环（禁止指向自身或后代）；
 * 写操作后 scanDel site:data:{siteId}:* 失效开放层热缓存（D12）。
 * 属主口径（P7 R76）：栏目归用户（user_id 直等），站点侧显隐由 site_column_display 控制（无行 = 该站不展示）。
 */
@Injectable()
export class SiteColumnService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** 平铺裸数组（前端组树，平台惯例），含 articleCount（含草稿）与可见站点 sites */
  async list(userId: bigint) {
    const [columns, counts, displays, sites] = await Promise.all([
      this.prisma.siteColumn.findMany({
        where: { userId },
        orderBy: [{ sort: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.siteArticle.groupBy({
        by: ['columnId'],
        where: { userId },
        _count: { _all: true },
      }),
      this.prisma.siteColumnDisplay.findMany({ where: { column: { userId } } }),
      this.prisma.siteSite.findMany({
        where: { userId },
        select: { id: true, title: true, slug: true },
      }),
    ])
    const countMap = new Map(counts.map((c) => [c.columnId.toString(), c._count._all]))
    const siteMap = new Map(sites.map((s) => [s.id.toString(), s]))
    const displayMap = new Map<string, ColumnSiteItem[]>()
    for (const d of displays) {
      const key = d.columnId.toString()
      const site = siteMap.get(d.siteId.toString())
      const arr = displayMap.get(key) ?? []
      arr.push({
        id: d.siteId.toString(),
        name: site?.title ?? d.siteId.toString(),
        slug: site?.slug ?? '',
        sort: d.sort,
      })
      displayMap.set(key, arr)
    }
    return columns.map((col) => ({
      id: col.id.toString(),
      parentId: col.parentId.toString(),
      name: col.name,
      sort: col.sort,
      articleCount: countMap.get(col.id.toString()) ?? 0,
      /** 可见站点（P7 API §14.1）：无行 = 该站不展示 */
      sites: displayMap.get(col.id.toString()) ?? [],
      createdAt: col.createdAt,
    }))
  }

  /** 新增栏目：≤3 级（R6）；siteIds 缺省 = 用户全部站点可见 */
  async create(userId: bigint, dto: CreateColumnDto) {
    const siteIds = await this.resolveTargetSites(userId, dto.siteIds)
    const parentId = BigInt(dto.parentId)
    if (parentId !== BigInt(0)) {
      const parent = await this.findOwned(userId, parentId)
      // 父已是最深层（3 级）→ 子将成第 4 级，拒绝
      const parentDepth = await this.depthOf(parent)
      if (parentDepth >= MAX_LEVEL) {
        throw new BusinessException(ErrorCode.SiteColumnInUse, `栏目最多 ${MAX_LEVEL} 级`)
      }
    }
    const created = await this.prisma.$transaction(async (tx) => {
      const column = await tx.siteColumn.create({
        data: { userId, parentId, name: dto.name, sort: dto.sort },
      })
      if (siteIds.length > 0) {
        await tx.siteColumnDisplay.createMany({
          data: siteIds.map((siteId) => ({ columnId: column.id, siteId, sort: dto.sort })),
        })
      }
      return column
    })
    await this.invalidateForSites(siteIds)
    return { id: created.id.toString(), name: created.name }
  }

  /** 编辑栏目：换父级防环（禁止指向自身或后代）+ 结果不得超 3 级（R6） */
  async update(userId: bigint, id: bigint, dto: UpdateColumnDto) {
    const column = await this.findOwnedColumn(userId, id)

    const data: { name?: string; sort?: number; parentId?: bigint } = {}
    if (dto.name !== undefined) data.name = dto.name
    if (dto.sort !== undefined) data.sort = dto.sort
    if (dto.parentId !== undefined) {
      const newParentId = BigInt(dto.parentId)
      if (newParentId !== column.parentId) {
        if (newParentId === column.id) {
          throw new BusinessException(ErrorCode.ParamInvalid, '父级不能指向自身')
        }
        if (newParentId !== BigInt(0)) {
          const newParent = await this.findOwned(userId, newParentId)
          // 防环：新父的祖先链上出现自身 → 新父在自身子树内
          if (await this.isDescendantOrSelf(newParent, column.id)) {
            throw new BusinessException(ErrorCode.ParamInvalid, '父级不能指向自身或其后代栏目')
          }
          // 层级校验：新父深度 + 自身子树高度 ≤ 3
          const newParentDepth = await this.depthOf(newParent)
          const selfHeight = await this.subtreeHeight(column)
          if (newParentDepth + selfHeight > MAX_LEVEL) {
            throw new BusinessException(ErrorCode.SiteColumnInUse, `栏目最多 ${MAX_LEVEL} 级`)
          }
        } else {
          // 移到根：自身子树高度 ≤ 3（自身作为第 1 级）
          const selfHeight = await this.subtreeHeight(column)
          if (selfHeight > MAX_LEVEL) {
            throw new BusinessException(ErrorCode.SiteColumnInUse, `栏目最多 ${MAX_LEVEL} 级`)
          }
        }
        data.parentId = newParentId
      }
    }

    const updated = await this.prisma.siteColumn.update({ where: { id: column.id }, data })
    const siteIds = await this.currentSiteIds(column.id)
    await this.invalidateForSites(siteIds)
    return { id: updated.id.toString(), name: updated.name, parentId: updated.parentId.toString() }
  }

  /** 删除栏目：有子栏目或文章（含草稿）→ 40107（R6）；连带显隐关联 */
  async remove(userId: bigint, id: bigint) {
    const column = await this.findOwnedColumn(userId, id)
    const [childCount, articleCount] = await Promise.all([
      this.prisma.siteColumn.count({ where: { userId, parentId: column.id } }),
      this.prisma.siteArticle.count({ where: { userId, columnId: column.id } }),
    ])
    if (childCount > 0) {
      throw new BusinessException(ErrorCode.SiteColumnInUse, '栏目下存在子栏目，不可删除')
    }
    if (articleCount > 0) {
      throw new BusinessException(ErrorCode.SiteColumnInUse, '栏目下存在文章，不可删除')
    }
    const siteIds = await this.currentSiteIds(column.id)
    await this.prisma.$transaction([
      this.prisma.siteColumnDisplay.deleteMany({ where: { columnId: column.id } }),
      this.prisma.siteColumn.delete({ where: { id: column.id } }),
    ])
    await this.invalidateForSites(siteIds)
    return { success: true }
  }

  /**
   * 替换式管理「栏目 → 站点显隐」（P7 API §14.2）：提交集合 = 最终集合；
   * 空数组 = 全部站点不展示（栏目本体保留在内容池）。返回最终态 `[{ id, name, slug, sort }]`。
   */
  async setSites(userId: bigint, id: bigint, dto: ColumnSitesDto) {
    const column = await this.findOwnedColumn(userId, id)
    const before = await this.currentSiteIds(column.id)
    const siteIds = await this.assertSites(
      userId,
      dto.sites.map((s) => s.siteId),
    )
    const sortMap = new Map(dto.sites.map((s) => [BigInt(s.siteId).toString(), s.sort]))
    await this.prisma.$transaction(async (tx) => {
      await tx.siteColumnDisplay.deleteMany({ where: { columnId: column.id } })
      if (siteIds.length === 0) return
      await tx.siteColumnDisplay.createMany({
        data: siteIds.map((siteId) => ({
          columnId: column.id,
          siteId,
          sort: sortMap.get(siteId.toString()) ?? column.sort,
        })),
      })
    })
    const affected = [...new Set([...before, ...siteIds])]
    await this.invalidateForSites(affected)
    return { ok: true, sites: await this.siteItemsOf(column.id) }
  }

  // ================= 私有辅助 =================

  /**
   * 按实体反查属主（P7 R76：user_id 直等）：
   * 栏目不存在 → 40106；栏目存在但非本人 → 40119。
   */
  private async findOwnedColumn(userId: bigint, id: bigint) {
    const column = await this.prisma.siteColumn.findFirst({ where: { id } })
    if (!column) {
      throw new BusinessException(ErrorCode.SiteColumnNotFound, '栏目不存在')
    }
    if (column.userId !== userId) {
      throw new BusinessException(ErrorCode.SiteForbidden, '栏目不存在或非属主')
    }
    return column
  }

  /** 本人栏目存在性（R1：他人/不存在一律 40106；用于父级校验） */
  private async findOwned(userId: bigint, id: bigint) {
    const column = await this.prisma.siteColumn.findFirst({ where: { id, userId } })
    if (!column) {
      throw new BusinessException(ErrorCode.SiteColumnNotFound, '栏目不存在')
    }
    return column
  }

  /** 站点归属校验（含他人/不存在 → 40119）；返回 bigint 集合（去重） */
  private async assertSites(userId: bigint, siteIds: number[]): Promise<bigint[]> {
    if (siteIds.length === 0) return []
    const unique = [...new Set(siteIds)]
    const sites = await this.prisma.siteSite.findMany({
      where: { id: { in: unique.map((v) => BigInt(v)) }, userId },
      select: { id: true },
    })
    if (sites.length !== unique.length) {
      throw new BusinessException(ErrorCode.SiteForbidden, '站点不存在或非属主')
    }
    return sites.map((s) => s.id)
  }

  /** 目标站点：不传 = 用户全部站点（P7：新栏目默认全站可见）；传则校验归属 */
  private async resolveTargetSites(userId: bigint, siteIds?: number[]): Promise<bigint[]> {
    if (siteIds === undefined) {
      const all = await this.prisma.siteSite.findMany({ where: { userId }, select: { id: true } })
      return all.map((s) => s.id)
    }
    return this.assertSites(userId, siteIds)
  }

  /** 栏目当前可见站点 id 集合（缓存失效用） */
  private async currentSiteIds(columnId: bigint): Promise<bigint[]> {
    const rows = await this.prisma.siteColumnDisplay.findMany({
      where: { columnId },
      select: { siteId: true },
    })
    return rows.map((r) => r.siteId)
  }

  /** 栏目可见站点明细（最终态，按站点 id 升序） */
  private async siteItemsOf(columnId: bigint): Promise<ColumnSiteItem[]> {
    const [rows, sites] = await Promise.all([
      this.prisma.siteColumnDisplay.findMany({ where: { columnId }, orderBy: { siteId: 'asc' } }),
      this.prisma.siteSite.findMany({ select: { id: true, title: true, slug: true } }),
    ])
    const siteMap = new Map(sites.map((s) => [s.id.toString(), s]))
    return rows.map((r) => {
      const site = siteMap.get(r.siteId.toString())
      return {
        id: r.siteId.toString(),
        name: site?.title ?? r.siteId.toString(),
        slug: site?.slug ?? '',
        sort: r.sort,
      }
    })
  }

  /** 栏目深度（1 级 = 1）：沿父链向上走至根 */
  private async depthOf(column: { id: bigint; parentId: bigint }): Promise<number> {
    let depth = 1
    let parentId = column.parentId
    // 上界 MAX_LEVEL + 1 防脏数据死循环
    while (parentId !== BigInt(0) && depth <= MAX_LEVEL + 1) {
      const parent = await this.prisma.siteColumn.findFirst({ where: { id: parentId } })
      if (!parent) break
      depth++
      parentId = parent.parentId
    }
    return depth
  }

  /** 子树高度（含自身，自身为 1 级时的相对高度） */
  private async subtreeHeight(column: { id: bigint }): Promise<number> {
    const children = await this.prisma.siteColumn.findMany({
      where: { parentId: column.id },
      select: { id: true },
    })
    if (children.length === 0) return 1
    let max = 0
    for (const child of children) {
      max = Math.max(max, await this.subtreeHeight({ id: child.id }))
    }
    return max + 1
  }

  /** target 是否在 column 的子树内（或就是 column 自身） */
  private async isDescendantOrSelf(
    target: { id: bigint; parentId: bigint },
    ancestorId: bigint,
  ): Promise<boolean> {
    let parentId = target.parentId
    let guard = 0
    while (parentId !== BigInt(0) && guard <= MAX_LEVEL + 1) {
      if (parentId === ancestorId) return true
      const parent = await this.prisma.siteColumn.findFirst({ where: { id: parentId } })
      if (!parent) break
      parentId = parent.parentId
      guard++
    }
    return false
  }

  /** 失效开放层热数据缓存（D12 / §22.6：栏目变更 → 相关站点 site:data 缓存族） */
  private async invalidateForSites(siteIds: bigint[]): Promise<void> {
    const unique = [...new Set(siteIds.map((id) => id.toString()))]
    for (const siteId of unique) {
      await this.redis.scanDel(`site:data:${siteId}:*`).catch(() => undefined)
    }
  }
}
