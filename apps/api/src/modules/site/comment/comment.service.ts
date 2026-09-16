import { Injectable } from '@nestjs/common'
import { ErrorCode } from '../../../common/constants/error-code'
import { PageResultDto } from '../../../common/dto/page-result.dto'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { RedisService } from '../../../infra/redis/redis.service'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import type { AuditCommentDto, CommentQueryDto } from './dto/comment.dto'

/** 评论内容上限（正文与作者回复同口径，R71） */
export const COMMENT_CONTENT_MAX = 500

/** 作者回复结果（含原评论昵称/内容，供管理端回执、AI 确认卡摘要与结果回喂复用） */
export interface CommentReplyResult {
  ok: true
  id: string
  nickname: string
  content: string
  /** null = 无回复（含本次清除） */
  replyContent: string | null
  replyAt: Date | null
}

/**
 * 评论管理（PRD F4 / API.md §6.2；P4E T61 多站点作用域化）：审核流（1 通过 / 2 驳回，
 * 开放层仅返回已过审）、物理删除；审核结果变更影响访客可见性 → scanDel site:data:{siteId}:*（D12）。
 * 属主口径（API-P4E §10.3）：list 以请求 siteId 为准（40119）；
 * audit/delete 按实体反查所属站点再校验属主，不信任请求里的 siteId。
 * P6 T78：增作者回复（reply/getCommentBrief，一级回复 D69/R71）；AI 工具链路额外传 expectedSiteId，
 * 跨站评论一律 40119（不暴露他人评论存在性）。
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
      /** 作者回复（P6 D69：一级回复，未回复为 null） */
      replyContent: c.replyContent,
      replyAt: c.replyAt,
      createdAt: c.createdAt,
    }))
    return new PageResultDto(list, total, query)
  }

  /**
   * 审核：1 通过 / 2 驳回；通过后访客可见（开放层仅返回 audit_status=1）。
   * expectedSiteId（P6 T78）：AI 工具链路传入解析出的站点 id，跨站评论一律 40119；
   * 管理端 HTTP 端点不传（沿用「按实体反查属主」既有口径）。
   */
  async audit(userId: bigint, id: bigint, dto: AuditCommentDto, expectedSiteId?: bigint) {
    const comment = await this.findOwnedComment(userId, id, expectedSiteId)
    await this.prisma.siteComment.update({
      where: { id: comment.id },
      data: { auditStatus: dto.auditStatus },
    })
    await this.invalidateDataCache(comment.siteId)
    return { id: comment.id.toString(), auditStatus: dto.auditStatus }
  }

  /**
   * 作者回复（P6 T78 / D69 / R71）：一级回复，每条评论至多一条。
   * - 内容 trim 后 ≤500 字（40115 之外走 40001：AI 工具层不经过 DTO 校验，此处兜底）
   * - 空串 / null = 清除回复（reply_content、reply_at 同置 NULL）
   * - 回复不单独审核；公开可见条件 = 评论本身 audit_status=1（开放层已按此过滤）
   * - 变更后失效开放层热数据缓存（既有 comment 写路径同口径，R71）
   */
  async reply(
    userId: bigint,
    id: bigint,
    content?: string | null,
    expectedSiteId?: bigint,
  ): Promise<CommentReplyResult> {
    const comment = await this.findOwnedComment(userId, id, expectedSiteId)
    const trimmed = typeof content === 'string' ? content.trim() : ''
    if (trimmed.length > COMMENT_CONTENT_MAX) {
      throw new BusinessException(ErrorCode.ParamInvalid, `回复内容最多 ${COMMENT_CONTENT_MAX} 字`)
    }
    const updated = await this.prisma.siteComment.update({
      where: { id: comment.id },
      data:
        trimmed.length > 0
          ? { replyContent: trimmed, replyAt: new Date() }
          : { replyContent: null, replyAt: null },
    })
    await this.invalidateDataCache(comment.siteId)
    return {
      ok: true,
      id: updated.id.toString(),
      nickname: comment.nickname,
      content: comment.content,
      replyContent: updated.replyContent,
      replyAt: updated.replyAt,
    }
  }

  /** 单条评论摘要（AI 回复确认卡预热用；属主校验与 audit/reply 同链） */
  async getCommentBrief(userId: bigint, id: bigint, expectedSiteId?: bigint): Promise<CommentReplyResult> {
    const comment = await this.findOwnedComment(userId, id, expectedSiteId)
    return {
      ok: true,
      id: comment.id.toString(),
      nickname: comment.nickname,
      content: comment.content,
      replyContent: comment.replyContent,
      replyAt: comment.replyAt,
    }
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
   * expectedSiteId（P6 R71）：AI 工具链路要求评论归属解析出的当前站点，跨站评论同样 40119。
   */
  private async findOwnedComment(userId: bigint, id: bigint, expectedSiteId?: bigint) {
    const comment = await this.prisma.siteComment.findFirst({ where: { id } })
    if (!comment) {
      throw new BusinessException(ErrorCode.SiteCommentNotFound, '评论不存在')
    }
    await this.requireOwnedSite(userId, comment.siteId)
    if (expectedSiteId !== undefined && comment.siteId !== expectedSiteId) {
      throw new BusinessException(ErrorCode.SiteForbidden, '评论不属于当前站点')
    }
    return comment
  }

  /** 失效开放层热数据缓存（D12：审核结果影响访客可见性） */
  private async invalidateDataCache(siteId: bigint): Promise<void> {
    await this.redis.scanDel(`site:data:${siteId.toString()}:*`).catch(() => undefined)
  }
}
