import { Injectable } from '@nestjs/common'
import { ErrorCode } from '../../../common/constants/error-code'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { RedisService } from '../../../infra/redis/redis.service'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import type { CreateColumnDto, UpdateColumnDto } from './dto/column.dto'

/** 栏目树最大层级（R6） */
const MAX_LEVEL = 3

/**
 * 栏目管理（PRD F2 / API.md §6.2）：树形 ≤3 级（R6）、删除保护（有子栏目或文章含草稿 → 40107）、
 * 换父级防环（禁止指向自身或后代）；写操作后 scanDel site:data:{siteId}:* 失效开放层热缓存（D12）。
 */
@Injectable()
export class SiteColumnService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** 平铺裸数组（前端组树，平台惯例），含 articleCount（含草稿） */
  async list(userId: bigint) {
    const site = await this.assertSite(userId)
    const [columns, counts] = await Promise.all([
      this.prisma.siteColumn.findMany({
        where: { siteId: site.id },
        orderBy: [{ sort: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.siteArticle.groupBy({
        by: ['columnId'],
        where: { siteId: site.id },
        _count: { _all: true },
      }),
    ])
    const countMap = new Map(counts.map((c) => [c.columnId.toString(), c._count._all]))
    return columns.map((col) => ({
      id: col.id.toString(),
      parentId: col.parentId.toString(),
      name: col.name,
      sort: col.sort,
      articleCount: countMap.get(col.id.toString()) ?? 0,
      createdAt: col.createdAt,
    }))
  }

  /** 新增栏目：≤3 级（R6） */
  async create(userId: bigint, dto: CreateColumnDto) {
    const site = await this.assertSite(userId)
    const parentId = BigInt(dto.parentId)
    if (parentId !== BigInt(0)) {
      const parent = await this.findOwned(site.id, parentId)
      // 父已是最深层（3 级）→ 子将成第 4 级，拒绝
      const parentDepth = await this.depthOf(parent)
      if (parentDepth >= MAX_LEVEL) {
        throw new BusinessException(ErrorCode.SiteColumnInUse, `栏目最多 ${MAX_LEVEL} 级`)
      }
    }
    const created = await this.prisma.siteColumn.create({
      data: { siteId: site.id, parentId, name: dto.name, sort: dto.sort },
    })
    await this.invalidateDataCache(site.id)
    return { id: created.id.toString(), name: created.name }
  }

  /** 编辑栏目：换父级防环（禁止指向自身或后代）+ 结果不得超 3 级（R6） */
  async update(userId: bigint, id: bigint, dto: UpdateColumnDto) {
    const site = await this.assertSite(userId)
    const column = await this.findOwned(site.id, id)

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
          const newParent = await this.findOwned(site.id, newParentId)
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
    await this.invalidateDataCache(site.id)
    return { id: updated.id.toString(), name: updated.name, parentId: updated.parentId.toString() }
  }

  /** 删除栏目：有子栏目或文章（含草稿）→ 40107（R6） */
  async remove(userId: bigint, id: bigint) {
    const site = await this.assertSite(userId)
    const column = await this.findOwned(site.id, id)
    const [childCount, articleCount] = await Promise.all([
      this.prisma.siteColumn.count({ where: { siteId: site.id, parentId: column.id } }),
      this.prisma.siteArticle.count({ where: { siteId: site.id, columnId: column.id } }),
    ])
    if (childCount > 0) {
      throw new BusinessException(ErrorCode.SiteColumnInUse, '栏目下存在子栏目，不可删除')
    }
    if (articleCount > 0) {
      throw new BusinessException(ErrorCode.SiteColumnInUse, '栏目下存在文章，不可删除')
    }
    await this.prisma.siteColumn.delete({ where: { id: column.id } })
    await this.invalidateDataCache(site.id)
    return { success: true }
  }

  // ================= 私有辅助 =================

  /** 当前用户站点（R1 数据隔离前提）；未开通 → 40101 */
  private async assertSite(userId: bigint) {
    const site = await this.prisma.siteSite.findFirst({ where: { userId } })
    if (!site) {
      throw new BusinessException(ErrorCode.SiteNotFound, '站点不存在或未开通')
    }
    return site
  }

  /** 本站栏目存在性（R1：他人/不存在一律 40106） */
  private async findOwned(siteId: bigint, id: bigint) {
    const column = await this.prisma.siteColumn.findFirst({
      where: { id, siteId },
    })
    if (!column) {
      throw new BusinessException(ErrorCode.SiteColumnNotFound, '栏目不存在')
    }
    return column
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

  /** 失效开放层热数据缓存（D12：栏目/文章/标签/评论变更 → scanDel site:data:{siteId}:*） */
  private async invalidateDataCache(siteId: bigint): Promise<void> {
    await this.redis.scanDel(`site:data:${siteId.toString()}:*`).catch(() => undefined)
  }
}
