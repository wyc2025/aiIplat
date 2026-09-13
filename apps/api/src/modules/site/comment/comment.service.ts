import { Injectable } from '@nestjs/common'
import { ErrorCode } from '../../../common/constants/error-code'
import { PageResultDto } from '../../../common/dto/page-result.dto'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { RedisService } from '../../../infra/redis/redis.service'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import type { AuditCommentDto, CommentQueryDto } from './dto/comment.dto'

/**
 * 评论管理（PRD F4 / API.md §6.2；P4E T61 多站点作用域化）：审核流（1 通过 / 2 驳回，
 * 开放层仅返回已过审）、物理删除；审核结果变更影响访客可见性 → scanDel site:data:{siteId}:*（D12）。
 * 属主口径（API-P4E §10.3）：list 以请求 siteId 为准（40119）；
 * audit/delete 按实体反查所属站点再校验属主，不信任请求里的 siteId。
 */
@Injectable()
export class SiteCommentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** 分页列表：筛选 auditStatus/articleId/keyword（昵称模糊），含 articleTitle */
  async list(userId: bigint, query: CommentQueryDto): Promise<PageResultDto<Record<string, unknown>>> {
    const site = await this.requireOwnedSite(userId, BigInt(query.siteId))
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
    const comment = await this.findOwnedComment(userId, id)
    await this.prisma.siteComment.update({
      where: { id: comment.id },
      data: { auditStatus: dto.auditStatus },
    })
    await this.invalidateDataCache(comment.siteId)
    return { id: comment.id.toString(), auditStatus: dto.auditStatus }
  }

  /** 物理删除 */
  async remove(userId: bigint, id: bigint) {
    const comment = await this.findOwnedComment(userId, id)
    await this.prisma.siteComment.delete({ where: { id: comment.id } })
    await this.invalidateDataCache(comment.siteId)
    return { success: true }
  }

  // ================= 私有辅助 =================

  /** 属主站点（P4E：不存在/非属主 → 40119；list 以请求 siteId 为准） */
  private async requireOwnedSite(userId: bigint, siteId: bigint) {
    const site = await this.prisma.siteSite.findFirst({ where: { id: siteId, userId } })
    if (!site) {
      throw new BusinessException(ErrorCode.SiteForbidden, '站点不存在或非属主')
    }
    return site
  }

  /**
   * 按实体反查属主（P4E T61：audit/delete 不信任请求 siteId）：
   * 评论不存在 → 40110；评论存在但站点非属主 → 40119。
   */
  private async findOwnedComment(userId: bigint, id: bigint) {
    const comment = await this.prisma.siteComment.findFirst({ where: { id } })
    if (!comment) {
      throw new BusinessException(ErrorCode.SiteCommentNotFound, '评论不存在')
    }
    await this.requireOwnedSite(userId, comment.siteId)
    return comment
  }

  /** 失效开放层热数据缓存（D12：审核结果影响访客可见性） */
  private async invalidateDataCache(siteId: bigint): Promise<void> {
    await this.redis.scanDel(`site:data:${siteId.toString()}:*`).catch(() => undefined)
  }
}
