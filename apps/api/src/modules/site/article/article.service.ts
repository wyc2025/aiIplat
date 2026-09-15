import { Injectable } from '@nestjs/common'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, Length, Min } from 'class-validator'
import { ErrorCode } from '../../../common/constants/error-code'
import { PageResultDto } from '../../../common/dto/page-result.dto'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { RedisService } from '../../../infra/redis/redis.service'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import { SitePageQueryDto } from '../dto/site-id.dto'
import type { CreateArticleDto, UpdateArticleDto, UpdateArticleStatusDto } from './dto/article.dto'
import type { SiteArticle } from '@prisma/client'

/** 文章列表查询（分页 + 必带 siteId + 筛选：栏目/标签/状态/标题关键词） */
export class ArticleQueryDto extends SitePageQueryDto {
  @ApiPropertyOptional({ description: '按栏目筛选' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  columnId?: number

  @ApiPropertyOptional({ description: '按标签筛选' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  tagId?: number

  @ApiPropertyOptional({ description: '按状态筛选（0 草稿 / 1 已发布）', enum: [0, 1] })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn([0, 1])
  status?: number

  @ApiPropertyOptional({ description: '标题关键词（模糊）' })
  @IsOptional()
  @IsString()
  @Length(0, 100)
  keyword?: string
}

/** R14 剔除的 markdown 标记符号：# * > ` ~ _ - + | [ ] ( ) ! */
const MD_MARKS = /[#*>`~_\-+|[\]()!]/g

/**
 * R14 字数口径：正文去除全部空白字符与 markdown 标记符号后的字符数，
 * 中英文均计 1；仅作展示（前后端不互验）。
 */
export function countWordsR14(contentMd: string): number {
  return contentMd.replace(MD_MARKS, '').replace(/\s/g, '').length
}

/** 正文转纯文本（摘要自动生成用）：去代码块/图片/链接壳/标记符号，空白压缩 */
export function toPlainText(contentMd: string): string {
  return contentMd
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#*>`~_\-|+]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 摘要：留空自动取正文纯文本前 100 字（PRD F3） */
export function resolveSummary(summary: string | undefined, contentMd: string): string {
  if (summary !== undefined && summary !== '') return summary
  return toPlainText(contentMd).slice(0, 100)
}

/**
 * 文章管理（PRD F3 / API.md §6.2；P4E T61 多站点作用域化）：字数 R14 保存时统计、摘要自动生成、
 * 封面必须 media/ 前缀（40105）、发布状态机（首次发布写 published_at，下架再上架不刷新）、
 * 物理删除连带标签关联与评论（R7）、tagIds 多对多整体重建；写操作后 scanDel site:data:{siteId}:*（D12）。
 * 属主口径（API-P4E §10.3）：list/create 以请求 siteId 为准（40119）；
 * detail/update/delete 按实体反查所属站点再校验属主，不信任请求里的 siteId。
 */
@Injectable()
export class SiteArticleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** 分页列表：筛选 columnId/tagId/status/keyword（标题模糊） */
  async list(userId: bigint, query: ArticleQueryDto): Promise<PageResultDto<Record<string, unknown>>> {
    const site = await this.requireOwnedSite(userId, BigInt(query.siteId))

    // tagId 筛选：先查关联表得文章 ID 集（空集直接返回空页）
    let tagArticleIds: bigint[] | null = null
    if (query.tagId !== undefined) {
      const relations = await this.prisma.siteArticleTag.findMany({
        where: { tagId: BigInt(query.tagId), article: { siteId: site.id } },
        select: { articleId: true },
      })
      tagArticleIds = relations.map((r) => r.articleId)
      if (tagArticleIds.length === 0) {
        return new PageResultDto([], 0, query)
      }
    }

    const where = {
      siteId: site.id,
      ...(query.columnId !== undefined ? { columnId: BigInt(query.columnId) } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.keyword ? { title: { contains: query.keyword } } : {}),
      ...(tagArticleIds ? { id: { in: tagArticleIds } } : {}),
    }

    const [articles, total] = await Promise.all([
      this.prisma.siteArticle.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: query.skip,
        take: query.take,
      }),
      this.prisma.siteArticle.count({ where }),
    ])
    const list = await this.toListItem(site.id, articles)
    return new PageResultDto(list, total, query)
  }

  /** 详情（附加 contentMd） */
  async detail(userId: bigint, id: bigint) {
    const { article, site } = await this.findOwnedArticle(userId, id)
    const [item] = await this.toListItem(site.id, [article])
    return { ...item, contentMd: article.contentMd }
  }

  /** 新建文章 */
  async create(userId: bigint, dto: CreateArticleDto) {
    const site = await this.requireOwnedSite(userId, BigInt(dto.siteId))
    await this.assertColumn(site.id, BigInt(dto.columnId))
    await this.assertTags(site.id, dto.tagIds)
    this.assertCoverPath(dto.coverPath)

    const now = new Date()
    // 文章 + 标签关联同一事务（半成品不可见）
    const created = await this.prisma.$transaction(async (tx) => {
      const article = await tx.siteArticle.create({
        data: {
          siteId: site.id,
          columnId: BigInt(dto.columnId),
          title: dto.title,
          summary: resolveSummary(dto.summary, dto.contentMd),
          coverPath: dto.coverPath || null,
          contentMd: dto.contentMd,
          wordCount: countWordsR14(dto.contentMd),
          status: dto.status,
          // 首建即发布 → 写发布时间
          publishedAt: dto.status === 1 ? now : null,
        },
      })
      const unique = [...new Set(dto.tagIds ?? [])]
      if (unique.length > 0) {
        await tx.siteArticleTag.createMany({
          data: unique.map((tagId) => ({ articleId: article.id, tagId: BigInt(tagId) })),
        })
      }
      return article
    })
    await this.invalidateDataCache(site.id)
    return { id: created.id.toString() }
  }

  /**
   * 文章所属站点 id（P5 T71：SiteFacade CMS 层写路径需要站点作用域时复用同一属主链——
   * 文章不存在 40109 / 站点非属主 40119，不信任请求里的 siteId）。
   */
  async getOwnedSiteId(userId: bigint, id: bigint): Promise<bigint> {
    const { site } = await this.findOwnedArticle(userId, id)
    return site.id
  }

  /** 编辑文章：提供即更新；tagIds 提供即整体重建；发布状态机同 status 接口 */
  async update(userId: bigint, id: bigint, dto: UpdateArticleDto) {
    const { article, site } = await this.findOwnedArticle(userId, id)
    if (dto.columnId !== undefined) {
      await this.assertColumn(site.id, BigInt(dto.columnId))
    }
    if (dto.tagIds !== undefined) {
      await this.assertTags(site.id, dto.tagIds)
    }
    this.assertCoverPath(dto.coverPath)

    const data: {
      columnId?: bigint
      title?: string
      summary?: string
      coverPath?: string | null
      contentMd?: string
      wordCount?: number
      status?: number
      publishedAt?: Date
    } = {}
    if (dto.columnId !== undefined) data.columnId = BigInt(dto.columnId)
    if (dto.title !== undefined) data.title = dto.title
    // 摘要：提供且非空用之；提供空串触发自动生成（依据最终正文）
    const finalContent = dto.contentMd ?? article.contentMd
    if (dto.summary !== undefined || dto.contentMd !== undefined) {
      data.summary = resolveSummary(dto.summary, finalContent)
    }
    if (dto.coverPath !== undefined) data.coverPath = dto.coverPath || null
    if (dto.contentMd !== undefined) data.contentMd = dto.contentMd
    if (dto.contentMd !== undefined) data.wordCount = countWordsR14(dto.contentMd)
    if (dto.status !== undefined) {
      data.status = dto.status
      // 首次发布写 published_at（下架再上架不刷新，D8）
      const publishedAt = this.resolvePublishedAt(article, dto.status)
      if (publishedAt) data.publishedAt = publishedAt
    }

    const updated = await this.prisma.siteArticle.update({ where: { id: article.id }, data })
    if (dto.tagIds !== undefined) {
      await this.replaceTags(updated.id, dto.tagIds)
    }
    await this.invalidateDataCache(site.id)
    return { id: updated.id.toString() }
  }

  /** 发布/下架：0 下架 / 1 发布；首次发布写 published_at（下架再上架不刷新） */
  async updateStatus(userId: bigint, id: bigint, dto: UpdateArticleStatusDto) {
    const { article, site } = await this.findOwnedArticle(userId, id)
    const publishedAt = this.resolvePublishedAt(article, dto.status)
    await this.prisma.siteArticle.update({
      where: { id: article.id },
      data: { status: dto.status, ...(publishedAt ? { publishedAt } : {}) },
    })
    await this.invalidateDataCache(site.id)
    return { id: article.id.toString(), status: dto.status }
  }

  /** 物理删除（R7）：连带 site_article_tag 与该文章全部评论，不进回收站 */
  async remove(userId: bigint, id: bigint) {
    const { article, site } = await this.findOwnedArticle(userId, id)
    await this.prisma.$transaction([
      this.prisma.siteArticleTag.deleteMany({ where: { articleId: article.id } }),
      this.prisma.siteComment.deleteMany({ where: { articleId: article.id } }),
      this.prisma.siteArticle.delete({ where: { id: article.id } }),
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
   * 按实体反查属主（P4E T61：detail/update/delete 不信任请求 siteId）：
   * 文章不存在 → 40109；文章存在但站点非属主 → 40119。
   */
  private async findOwnedArticle(userId: bigint, id: bigint) {
    const article = await this.prisma.siteArticle.findFirst({ where: { id } })
    if (!article) {
      throw new BusinessException(ErrorCode.SiteArticleNotFound, '文章不存在')
    }
    const site = await this.requireOwnedSite(userId, article.siteId)
    return { article, site }
  }

  /** 栏目归属校验（本站）→ 40106 */
  private async assertColumn(siteId: bigint, columnId: bigint) {
    const column = await this.prisma.siteColumn.findFirst({ where: { id: columnId, siteId } })
    if (!column) {
      throw new BusinessException(ErrorCode.SiteColumnNotFound, '栏目不存在')
    }
  }

  /** 标签归属校验（本站，全部必须存在）→ 40400（错误码表无"标签不存在"细分码） */
  private async assertTags(siteId: bigint, tagIds: number[] | undefined) {
    if (!tagIds || tagIds.length === 0) return
    const unique = [...new Set(tagIds)]
    const count = await this.prisma.siteTag.count({
      where: { siteId, id: { in: unique.map((v) => BigInt(v)) } },
    })
    if (count !== unique.length) {
      throw new BusinessException(ErrorCode.NotFound, '标签不存在')
    }
  }

  /** 封面必须 media/ 前缀（API.md §6.2：40105 口径校验） */
  private assertCoverPath(coverPath: string | undefined): void {
    if (coverPath !== undefined && coverPath !== '' && !coverPath.startsWith('media/')) {
      throw new BusinessException(ErrorCode.SiteRootUnavailable, '封面必须位于站点 media/ 目录内')
    }
  }

  /** 发布状态机：0→1 且从未发布 → 返回 now（首次发布）；其余返回 null（不刷新） */
  private resolvePublishedAt(article: SiteArticle, newStatus: number): Date | null {
    if (newStatus === 1 && article.status === 0 && !article.publishedAt) {
      return new Date()
    }
    return null
  }

  /** 重建文章-标签关联（整体替换） */
  private async replaceTags(articleId: bigint, tagIds: number[]): Promise<void> {
    const unique = [...new Set(tagIds)]
    await this.prisma.$transaction(async (tx) => {
      await tx.siteArticleTag.deleteMany({ where: { articleId } })
      if (unique.length > 0) {
        await tx.siteArticleTag.createMany({
          data: unique.map((tagId) => ({ articleId, tagId: BigInt(tagId) })),
        })
      }
    })
  }

  /** 列表/详情 item 组装（columnName/tagIds 批量查询） */
  private async toListItem(siteId: bigint, articles: SiteArticle[]) {
    if (articles.length === 0) return []
    const columnIds = [...new Set(articles.map((a) => a.columnId))]
    const articleIds = articles.map((a) => a.id)
    const [columns, tagRelations] = await Promise.all([
      this.prisma.siteColumn.findMany({
        where: { id: { in: columnIds } },
        select: { id: true, name: true },
      }),
      this.prisma.siteArticleTag.findMany({
        where: { articleId: { in: articleIds } },
        select: { articleId: true, tagId: true },
      }),
    ])
    const columnNameMap = new Map(columns.map((c) => [c.id.toString(), c.name]))
    const tagsMap = new Map<string, string[]>()
    for (const rel of tagRelations) {
      const key = rel.articleId.toString()
      const arr = tagsMap.get(key) ?? []
      arr.push(rel.tagId.toString())
      tagsMap.set(key, arr)
    }
    return articles.map((a) => ({
      id: a.id.toString(),
      columnId: a.columnId.toString(),
      columnName: columnNameMap.get(a.columnId.toString()) ?? '',
      title: a.title,
      summary: a.summary,
      coverPath: a.coverPath,
      tagIds: tagsMap.get(a.id.toString()) ?? [],
      wordCount: a.wordCount,
      viewCount: a.viewCount,
      status: a.status,
      publishedAt: a.publishedAt,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    }))
  }

  /** 失效开放层热数据缓存（D12） */
  private async invalidateDataCache(siteId: bigint): Promise<void> {
    await this.redis.scanDel(`site:data:${siteId.toString()}:*`).catch(() => undefined)
  }
}
