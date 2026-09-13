import { Injectable } from '@nestjs/common'
import { ErrorCode } from '../../../common/constants/error-code'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { RedisService } from '../../../infra/redis/redis.service'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import type { CreateTagDto, SaveTagDto } from './dto/tag.dto'

/**
 * 标签管理（PRD F2 系列 / API.md §6.2；P4E T61 多站点作用域化）：unique(site_id, name)（40108）、
 * 删除连带清理 site_article_tag；写操作后失效开放层热缓存（D12）。
 * 属主口径（API-P4E §10.3）：list/create 以请求 siteId 为准（40119）；
 * update/delete 按实体反查所属站点再校验属主，不信任请求里的 siteId。
 */
@Injectable()
export class SiteTagService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** 裸数组（含 articleCount） */
  async list(userId: bigint, siteId: bigint) {
    const site = await this.requireOwnedSite(userId, siteId)
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
  async create(userId: bigint, dto: CreateTagDto) {
    const site = await this.requireOwnedSite(userId, BigInt(dto.siteId))
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
    const { tag, site } = await this.findOwnedTag(userId, id)
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
    const { tag, site } = await this.findOwnedTag(userId, id)
    await this.prisma.$transaction([
      this.prisma.siteArticleTag.deleteMany({ where: { tagId: tag.id } }),
      this.prisma.siteTag.delete({ where: { id: tag.id } }),
    ])
    await this.invalidateDataCache(site.id)
    return { success: true }
  }

  // ================= 私有辅助 =================

  /** 属主站点（P4E：不存在/非属主 → 40119；list/create 以请求 siteId 为准） */
  private async requireOwnedSite(userId: bigint, siteId: bigint) {
    const site = await this.prisma.siteSite.findFirst({ where: { id: siteId, userId } })
    if (!site) {
      throw new BusinessException(ErrorCode.SiteForbidden, '站点不存在或非属主')
    }
    return site
  }

  /**
   * 按实体反查属主（P4E T61：update/delete 不信任请求 siteId）：
   * 标签不存在 → 40400（错误码表未定义"标签不存在"细分码）；站点非属主 → 40119。
   */
  private async findOwnedTag(userId: bigint, id: bigint) {
    const tag = await this.prisma.siteTag.findFirst({ where: { id } })
    if (!tag) {
      throw new BusinessException(ErrorCode.NotFound, '标签不存在')
    }
    const site = await this.requireOwnedSite(userId, tag.siteId)
    return { tag, site }
  }

  /** 失效开放层热数据缓存（D12） */
  private async invalidateDataCache(siteId: bigint): Promise<void> {
    await this.redis.scanDel(`site:data:${siteId.toString()}:*`).catch(() => undefined)
  }
}
