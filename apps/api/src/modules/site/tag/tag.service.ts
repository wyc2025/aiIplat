import { Injectable } from '@nestjs/common'
import { ErrorCode } from '../../../common/constants/error-code'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { RedisService } from '../../../infra/redis/redis.service'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import type { CreateTagDto, SaveTagDto } from './dto/tag.dto'

/**
 * 标签管理（PRD F2 系列 / API.md §6.2；P7 D73 内容池化）：
 * unique(user_id, name)（重名 40108）、删除连带清理 site_article_tag；
 * 标签跟随文章（无按站显隐：出哪些标签由本站已发表文章的 tagIds 决定）。
 * 属主口径（P7 R76）：标签归用户（user_id 直等），写操作失效本人全部站点的开放层热缓存（D12）。
 */
@Injectable()
export class SiteTagService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** 裸数组（含 articleCount，用户级） */
  async list(userId: bigint) {
    const [tags, counts] = await Promise.all([
      this.prisma.siteTag.findMany({
        where: { userId },
        orderBy: [{ id: 'asc' }],
      }),
      this.prisma.siteArticleTag.groupBy({
        by: ['tagId'],
        where: { tag: { userId } },
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

  /** 新增标签：本人名下重名 → 40108 */
  async create(userId: bigint, dto: CreateTagDto) {
    const exists = await this.prisma.siteTag.findFirst({ where: { userId, name: dto.name } })
    if (exists) {
      throw new BusinessException(ErrorCode.SiteTagExists, '标签已存在')
    }
    const created = await this.prisma.siteTag.create({ data: { userId, name: dto.name } })
    await this.invalidateDataCache(userId)
    return { id: created.id.toString(), name: created.name }
  }

  /** 编辑标签：改名重名 → 40108；不存在 → 40400（文档未定义细分码，用通用资源不存在） */
  async update(userId: bigint, id: bigint, dto: SaveTagDto) {
    const tag = await this.findOwnedTag(userId, id)
    if (dto.name !== tag.name) {
      const exists = await this.prisma.siteTag.findFirst({ where: { userId, name: dto.name } })
      if (exists) {
        throw new BusinessException(ErrorCode.SiteTagExists, '标签已存在')
      }
    }
    const updated = await this.prisma.siteTag.update({ where: { id: tag.id }, data: { name: dto.name } })
    await this.invalidateDataCache(userId)
    return { id: updated.id.toString(), name: updated.name }
  }

  /** 删除标签：连带删 site_article_tag 关联（API.md §6.2） */
  async remove(userId: bigint, id: bigint) {
    const tag = await this.findOwnedTag(userId, id)
    await this.prisma.$transaction([
      this.prisma.siteArticleTag.deleteMany({ where: { tagId: tag.id } }),
      this.prisma.siteTag.delete({ where: { id: tag.id } }),
    ])
    await this.invalidateDataCache(userId)
    return { success: true }
  }

  // ================= 私有辅助 =================

  /** 按实体反查属主（P7 R76：user_id 直等）：标签不存在 → 40400；非本人 → 40119 */
  private async findOwnedTag(userId: bigint, id: bigint) {
    const tag = await this.prisma.siteTag.findFirst({ where: { id } })
    if (!tag) {
      throw new BusinessException(ErrorCode.NotFound, '标签不存在')
    }
    if (tag.userId !== userId) {
      throw new BusinessException(ErrorCode.SiteForbidden, '标签不存在或非属主')
    }
    return tag
  }

  /** 失效开放层热数据缓存（D12：标签归用户 → 失效本人全部站点） */
  private async invalidateDataCache(userId: bigint): Promise<void> {
    const sites = await this.prisma.siteSite.findMany({ where: { userId }, select: { id: true } })
    for (const site of sites) {
      await this.redis.scanDel(`site:data:${site.id.toString()}:*`).catch(() => undefined)
    }
  }
}
