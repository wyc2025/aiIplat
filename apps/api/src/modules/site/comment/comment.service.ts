import { Injectable } from '@nestjs/common'
import { ErrorCode } from '../../../common/constants/error-code'
import { PageResultDto } from '../../../common/dto/page-result.dto'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { RedisService } from '../../../infra/redis/redis.service'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import type { AuditCommentDto, CommentQueryDto } from './dto/comment.dto'

/**
 * 评论管理（PRD F4 / API.md §6.2）：审核流（1 通过 / 2 驳回，开放层仅返回已过审）、物理删除；
 * 审核结果变更影响访客可见性 → scanDel site:data:{siteId}:* 失效开放层缓存（D12）。
 */
@Injectable()
export class SiteCommentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** 分页列表：筛选 auditStatus/articleId/keyword（昵称模糊），含 articleTitle */
  async list(userId: bigint, query: CommentQueryDto): Promise<PageResultDto<Record<string, unknown>>> {
    const site = await this.assertSite(userId)
    const where = {
      siteId: site.id,
      ...(query.auditStatus !== undefined ? { auditStatus: query.auditStatus } : {}),
      ...(query.articleId !== undefined ? { articleId: BigInt(query.articleId) } : {}),
      ...(query.keyword ? { nickname: { contains: query.keyword } } : {}),
    }
    const [comments, total] = await Promise.all([
      this.prisma.siteComment.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.siteComment.count({ where }),
    ])
    // 文章标题批量装配（评论随文章物理删除（R7），无孤立评论）
    const articleIds = [...new Set(comments.map((c) => c.articleId))]
    const articles = await this.prisma.siteArticle.findMany({
      where: { id: { in: articleIds } },
      select: { id: true, title: true },
    })
    const titleMap = new Map(articles.map((a) => [a.id.toString(), a.title]))
    const list = comments.map((c) => ({
      id: c.id.toString(),
      articleId: c.articleId.toString(),
      articleTitle: titleMap.get(c.articleId.toString()) ?? '',
      nickname: c.nickname,
      content: c.content,
      ip: c.ip,
      auditStatus: c.auditStatus,
      createdAt: c.createdAt,
    }))
    return new PageResultDto(list, total, query)
  }

  /** 审核：1 通过 / 2 驳回；通过后访客可见（开放层仅返回 audit_status=1） */
  async audit(userId: bigint, id: bigint, dto: AuditCommentDto) {
    const site = await this.assertSite(userId)
    const comment = await this.findOwned(site.id, id)
    await this.prisma.siteComment.update({
      where: { id: comment.id },
      data: { auditStatus: dto.auditStatus },
    })
    await this.invalidateDataCache(comment.siteId)
    return { id: comment.id.toString(), auditStatus: dto.auditStatus }
  }

  /** 物理删除 */
  async remove(userId: bigint, id: bigint) {
    const site = await this.assertSite(userId)
    const comment = await this.findOwned(site.id, id)
    await this.prisma.siteComment.delete({ where: { id: comment.id } })
    await this.invalidateDataCache(comment.siteId)
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

  /** 本站评论存在性；不存在 → 40110（R1：他人/不存在一律同码） */
  private async findOwned(siteId: bigint, id: bigint) {
    const comment = await this.prisma.siteComment.findFirst({ where: { id, siteId } })
    if (!comment) {
      throw new BusinessException(ErrorCode.SiteCommentNotFound, '评论不存在')
    }
    return comment
  }

  /** 失效开放层热数据缓存（D12：审核结果影响访客可见性） */
  private async invalidateDataCache(siteId: bigint): Promise<void> {
    await this.redis.scanDel(`site:data:${siteId.toString()}:*`).catch(() => undefined)
  }
}
