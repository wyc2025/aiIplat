import { Injectable } from '@nestjs/common'
import { ErrorCode } from '../../../common/constants/error-code'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { RedisService } from '../../../infra/redis/redis.service'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import type { SaveTagDto } from './dto/tag.dto'

/**
 * 标签管理（PRD F2 系列 / API.md §6.2）：unique(site_id, name)（40108）、
 * 删除连带清理 site_article_tag；写操作后失效开放层热缓存（D12）。
 */
@Injectable()
export class SiteTagService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** 裸数组（含 articleCount） */
  async list(userId: bigint) {
    const site = await this.assertSite(userId)
    const [tags, counts] = await Promise.all([
      this.prisma.siteTag.findMany({
        where: { siteId: site.id },
        orderBy: [{ id: 'asc' }],
      }),
      this.prisma.siteArticleTag.groupBy({
        by: ['tagId'],
        where: { tag: { siteId: site.id } },
        _count: { _all: true },
      }),
    ])
    const countMap = new Map(counts.map((c) => [c.tagId.toString(), c._count._all]))
    return tags.map((tag) => ({
      id: tag.id.toString(),
      name: tag.name,
      articleCount: countMap.get(tag.id.toString()) ?? 0,
      createdAt: tag.createdAt,
    }))
  }

  /** 新增标签：同站重名 → 40108 */
  async create(userId: bigint, dto: SaveTagDto) {
    const site = await this.assertSite(userId)
    const exists = await this.prisma.siteTag.findFirst({
      where: { siteId: site.id, name: dto.name },
    })
    if (exists) {
      throw new BusinessException(ErrorCode.SiteTagExists, '标签已存在')
    }
    const created = await this.prisma.siteTag.create({
      data: { siteId: site.id, name: dto.name },
    })
    await this.invalidateDataCache(site.id)
    return { id: created.id.toString(), name: created.name }
  }

  /** 编辑标签：改名重名 → 40108；不存在 → 40400（文档未定义细分码，用通用资源不存在） */
  async update(userId: bigint, id: bigint, dto: SaveTagDto) {
    const site = await this.assertSite(userId)
    const tag = await this.findOwned(site.id, id)
    if (dto.name !== tag.name) {
      const exists = await this.prisma.siteTag.findFirst({
        where: { siteId: site.id, name: dto.name },
      })
      if (exists) {
        throw new BusinessException(ErrorCode.SiteTagExists, '标签已存在')
      }
    }
    const updated = await this.prisma.siteTag.update({
      where: { id: tag.id },
      data: { name: dto.name },
    })
    await this.invalidateDataCache(site.id)
    return { id: updated.id.toString(), name: updated.name }
  }

  /** 删除标签：连带删 site_article_tag 关联（API.md §6.2） */
  async remove(userId: bigint, id: bigint) {
    const site = await this.assertSite(userId)
    const tag = await this.findOwned(site.id, id)
    await this.prisma.$transaction([
      this.prisma.siteArticleTag.deleteMany({ where: { tagId: tag.id } }),
      this.prisma.siteTag.delete({ where: { id: tag.id } }),
    ])
    await this.invalidateDataCache(site.id)
    return { success: true }
  }

  // ================= 私有辅助 =================

  /** 当前用户站点；未开通 → 40101 */
  private async assertSite(userId: bigint) {
    const site = await this.prisma.siteSite.findFirst({ where: { userId } })
    if (!site) {
      throw new BusinessException(ErrorCode.SiteNotFound, '站点不存在或未开通')
    }
    return site
  }

  /** 本站标签存在性；不存在 → 40400（错误码表未定义"标签不存在"细分码） */
  private async findOwned(siteId: bigint, id: bigint) {
    const tag = await this.prisma.siteTag.findFirst({ where: { id, siteId } })
    if (!tag) {
      throw new BusinessException(ErrorCode.NotFound, '标签不存在')
    }
    return tag
  }

  /** 失效开放层热数据缓存（D12） */
  private async invalidateDataCache(siteId: bigint): Promise<void> {
    await this.redis.scanDel(`site:data:${siteId.toString()}:*`).catch(() => undefined)
  }
}
