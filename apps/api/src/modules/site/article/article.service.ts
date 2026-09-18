import { Injectable } from '@nestjs/common'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { Type } from 'class-transformer'
import { IsIn, IsInt, IsOptional, IsString, Length, Min } from 'class-validator'
import { ErrorCode } from '../../../common/constants/error-code'
import { PageResultDto } from '../../../common/dto/page-result.dto'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { RedisService } from '../../../infra/redis/redis.service'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import { UserPageQueryDto } from '../dto/site-id.dto'
import { CloudFacade } from '../../cloud/facade/cloud-facade.service'
import { IMPORT_ALLOWED_EXTS, IMPORT_MAX_BYTES, ImportParseError, parseArticleFile } from './article-import.parser'
import { formatMarkdown } from './markdown-format'
import type {
  ArticleSitesDto,
  CreateArticleDto,
  UpdateArticleDto,
  UpdateArticleStatusDto,
} from './dto/article.dto'
import type { FormatArticleDto, ImportArticleDto } from './dto/article-tools.dto'
import type { SiteArticle } from '@prisma/client'

/** 文章列表查询（P7 D73：用户级；siteId 降为可选筛选「已发表到该站」） */
export class ArticleQueryDto extends UserPageQueryDto {
  @ApiPropertyOptional({ description: '按发表站点筛选（可选；不传 = 全部内容池文章）' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  siteId?: number

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

/** 文章已发表站点（列表 item 出口径） */
export interface ArticleSiteItem {
  id: string
  name: string
  slug: string
  isTop: boolean
  publishedAt: Date | null
}

/**
 * 文章管理（PRD F3 / API.md §6.2；P7 D73 内容池化）：字数 R14 保存时统计、摘要自动生成、
 * 封面必须 media/ 前缀（40105）、发布状态机（首次发布写 published_at，下架再上架不刷新）、
 * 物理删除连带标签关联 / 发表关联 / 评论（R7）、tagIds 多对多整体重建。
 * 属主口径（P7 R76）：文章归用户（user_id 直等），站点只是展示窗口——
 * list/create 以当前用户为准（站点需属主 40119）；detail/update/delete 按实体反查 user_id（40109/40119）。
 * 缓存失效（§22.6）：文章本体变更 → 其全部发表站点的 site:data 缓存族。
 */
@Injectable()
export class SiteArticleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly cloudFacade: CloudFacade,
  ) {}

  /** 分页列表（用户级）：筛选 columnId/tagId/status/keyword + 可选 siteId（按发表过滤） */
  async list(userId: bigint, query: ArticleQueryDto): Promise<PageResultDto<Record<string, unknown>>> {
    // tagId 筛选：先查关联表得文章 ID 集（空集直接返回空页）
    let tagArticleIds: bigint[] | null = null
    if (query.tagId !== undefined) {
      const relations = await this.prisma.siteArticleTag.findMany({
        where: { tagId: BigInt(query.tagId), article: { userId } },
        select: { articleId: true },
      })
      tagArticleIds = relations.map((r) => r.articleId)
      if (tagArticleIds.length === 0) {
        return new PageResultDto([], 0, query)
      }
    }

    const where = {
      userId,
      ...(query.siteId !== undefined
        ? { publishes: { some: { siteId: BigInt(query.siteId) } } }
        : {}),
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
    const list = await this.toListItem(articles)
    return new PageResultDto(list, total, query)
  }

  /** 详情（附加 contentMd） */
  async detail(userId: bigint, id: bigint) {
    const article = await this.findOwnedArticle(userId, id)
    const [item] = await this.toListItem([article])
    return { ...item, contentMd: article.contentMd }
  }

  /**
   * 从云盘已有文件导入文章（P8 T88）：
   * 经 CloudFacade 读字节（域边界）→ 本域解析（编码探测/标题/摘要/标签）→ 标签名匹配已有标签。
   * **只解析不落库**：结果填入编辑表单，由用户确认后再走常规 create/update。
   */
  async importFromFile(userId: bigint, dto: ImportArticleDto) {
    const fileId = BigInt(dto.fileId)
    const file = await this.cloudFacade.readTextFileById(userId, fileId, {
      exts: IMPORT_ALLOWED_EXTS,
      maxBytes: IMPORT_MAX_BYTES,
      purpose: '导入文章',
    })

    let parsed
    try {
      parsed = parseArticleFile(file.content, file.name)
    } catch (error) {
      // 解析失败属于"用户可纠正"的问题（类型/编码/内容），转成业务码返回可读原因
      if (error instanceof ImportParseError) {
        throw new BusinessException(ErrorCode.ParamInvalid, error.message)
      }
      throw error
    }

    const tags = await this.matchTagsByName(userId, parsed.tagNames)
    return {
      fileId: file.id,
      filename: file.name,
      title: parsed.title,
      contentMd: parsed.contentMd,
      summary: parsed.summary,
      wordCount: countWordsR14(parsed.contentMd),
      matchedTags: tags.matched,
      unmatchedTags: tags.unmatched,
      warnings: parsed.warnings,
      meta: parsed.meta,
    }
  }

  /**
   * 一键排版（P8 T89）：纯文本变换，不落库、不改状态。
   * 规则引擎见 `markdown-format.ts`（保护区机制 + 三档可开关 + 幂等）；
   * 返回 stats.rules 供前端提示"改了哪些地方"。
   */
  formatContent(dto: FormatArticleDto) {
    const result = formatMarkdown(dto.contentMd, dto.options ?? {})
    return { contentMd: result.contentMd, changed: result.changed, stats: result.stats }
  }

  /** 标签名 → 平台已有标签（**只匹配不创建**：导入动作不产生意外数据；未匹配的回给前端提示） */
  private async matchTagsByName(userId: bigint, names: string[]) {
    if (names.length === 0) return { matched: [], unmatched: [] }
    const rows = await this.prisma.siteTag.findMany({
      where: { userId, name: { in: names } },
      select: { id: true, name: true },
    })
    const hit = new Set(rows.map((row) => row.name))
    return {
      matched: rows.map((row) => ({ id: row.id.toString(), name: row.name })),
      unmatched: names.filter((name) => !hit.has(name)),
    }
  }

  /**
   * 新建文章（P7 D73）：文章本体入内容池（user_id），siteIds 指定的站点建发表关联。
   * 缺省 siteIds = 不发表到任何站（纯草稿躺池，随时可补）。
   */
  async create(userId: bigint, dto: CreateArticleDto) {
    const siteIds = await this.assertSites(userId, dto.siteIds)
    await this.assertColumn(userId, BigInt(dto.columnId))
    await this.assertTags(userId, dto.tagIds)
    this.assertCoverPath(dto.coverPath)

    const now = new Date()
    const status = dto.status
    // 文章 + 标签关联 + 发表关联同一事务（半成品不可见）
    const created = await this.prisma.$transaction(async (tx) => {
      const article = await tx.siteArticle.create({
        data: {
          userId,
          columnId: BigInt(dto.columnId),
          title: dto.title,
          summary: resolveSummary(dto.summary, dto.contentMd),
          coverPath: dto.coverPath || null,
          contentMd: dto.contentMd,
          wordCount: countWordsR14(dto.contentMd),
          status,
          // 首建即发布 → 写发布时间
          publishedAt: status === 1 ? now : null,
        },
      })
      const unique = [...new Set(dto.tagIds ?? [])]
      if (unique.length > 0) {
        await tx.siteArticleTag.createMany({
          data: unique.map((tagId) => ({ articleId: article.id, tagId: BigInt(tagId) })),
        })
      }
      if (siteIds.length > 0) {
        await tx.siteArticlePublish.createMany({
          data: siteIds.map((siteId) => ({
            articleId: article.id,
            siteId,
            publishedAt: status === 1 ? now : null,
          })),
        })
      }
      return article
    })
    await this.invalidateForSites(siteIds)
    return { id: created.id.toString() }
  }

  /** 编辑文章：提供即更新；tagIds 提供即整体重建；siteIds 提供即替换式更新发表集合 */
  async update(userId: bigint, id: bigint, dto: UpdateArticleDto) {
    const article = await this.findOwnedArticle(userId, id)
    if (dto.columnId !== undefined) {
      await this.assertColumn(userId, BigInt(dto.columnId))
    }
    if (dto.tagIds !== undefined) {
      await this.assertTags(userId, dto.tagIds)
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
    const affectedSites = await this.currentSiteIds(updated.id)
    if (dto.siteIds !== undefined) {
      const siteIds = await this.assertSites(userId, dto.siteIds)
      await this.replacePublishes(updated.id, siteIds, data.publishedAt ?? updated.publishedAt)
      for (const siteId of siteIds) {
        if (!affectedSites.includes(siteId)) affectedSites.push(siteId)
      }
    }
    await this.invalidateForSites(affectedSites)
    return { id: updated.id.toString() }
  }

  /** 发布/下架：0 下架 / 1 发布；首次发布写 published_at（下架再上架不刷新） */
  async updateStatus(userId: bigint, id: bigint, dto: UpdateArticleStatusDto) {
    const article = await this.findOwnedArticle(userId, id)
    const publishedAt = this.resolvePublishedAt(article, dto.status)
    await this.prisma.siteArticle.update({
      where: { id: article.id },
      data: { status: dto.status, ...(publishedAt ? { publishedAt } : {}) },
    })
    const siteIds = await this.currentSiteIds(article.id)
    await this.invalidateForSites(siteIds)
    return { id: article.id.toString(), status: dto.status }
  }

  /**
   * 替换式管理发表关联（P7 API §14.2）：提交集合 = 最终集合；空数组 = 全站下架（本体保留）。
   * 返回最终态 `[{ id, name, slug, isTop, publishedAt }]`。
   */
  async setSites(userId: bigint, id: bigint, dto: ArticleSitesDto) {
    const article = await this.findOwnedArticle(userId, id)
    const before = await this.currentSiteIds(article.id)
    const siteIds = await this.assertSites(
      userId,
      dto.sites.map((s) => s.siteId),
    )
    await this.replacePublishes(article.id, siteIds, article.publishedAt, dto.sites)
    const affected = [...new Set([...before, ...siteIds])]
    await this.invalidateForSites(affected)
    return { ok: true, sites: await this.siteItemsOf(article.id) }
  }

  /** 物理删除（R7）：连带发表关联 / 标签关联 / 该文章全部评论（各站），不进回收站 */
  async remove(userId: bigint, id: bigint) {
    const article = await this.findOwnedArticle(userId, id)
    const siteIds = await this.currentSiteIds(article.id)
    await this.prisma.$transaction([
      this.prisma.siteArticlePublish.deleteMany({ where: { articleId: article.id } }),
      this.prisma.siteArticleTag.deleteMany({ where: { articleId: article.id } }),
      this.prisma.siteComment.deleteMany({ where: { articleId: article.id } }),
      this.prisma.siteArticle.delete({ where: { id: article.id } }),
    ])
    await this.invalidateForSites(siteIds)
    return { success: true }
  }

  // ================= 私有辅助 =================

  /**
   * 按实体反查属主（P7 R76：user_id 直等）：
   * 文章不存在 → 40109；存在但非本人 → 40119。
   */
  private async findOwnedArticle(userId: bigint, id: bigint) {
    const article = await this.prisma.siteArticle.findFirst({ where: { id } })
    if (!article) {
      throw new BusinessException(ErrorCode.SiteArticleNotFound, '文章不存在')
    }
    if (article.userId !== userId) {
      throw new BusinessException(ErrorCode.SiteForbidden, '文章不存在或非属主')
    }
    return article
  }

  /** 站点归属校验（含他人/不存在 → 40119）；返回 bigint 集合（去重） */
  private async assertSites(userId: bigint, siteIds: number[] | undefined): Promise<bigint[]> {
    if (!siteIds || siteIds.length === 0) return []
    const unique = [...new Set(siteIds)]
    if (unique.length > 100) {
      throw new BusinessException(ErrorCode.ParamInvalid, '站点最多 100 个')
    }
    const sites = await this.prisma.siteSite.findMany({
      where: { id: { in: unique.map((v) => BigInt(v)) }, userId },
      select: { id: true },
    })
    if (sites.length !== unique.length) {
      throw new BusinessException(ErrorCode.SiteForbidden, '站点不存在或非属主')
    }
    return sites.map((s) => s.id)
  }

  /** 栏目归属校验（本人栏目）→ 40106 */
  private async assertColumn(userId: bigint, columnId: bigint) {
    const column = await this.prisma.siteColumn.findFirst({ where: { id: columnId, userId } })
    if (!column) {
      throw new BusinessException(ErrorCode.SiteColumnNotFound, '栏目不存在')
    }
  }

  /** 标签归属校验（本人标签，全部必须存在）→ 40400 */
  private async assertTags(userId: bigint, tagIds: number[] | undefined) {
    if (!tagIds || tagIds.length === 0) return
    const unique = [...new Set(tagIds)]
    const count = await this.prisma.siteTag.count({
      where: { userId, id: { in: unique.map((v) => BigInt(v)) } },
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

  /** 文章当前发表站点 id 集合（缓存失效用） */
  private async currentSiteIds(articleId: bigint): Promise<bigint[]> {
    const rows = await this.prisma.siteArticlePublish.findMany({
      where: { articleId },
      select: { siteId: true },
    })
    return rows.map((r) => r.siteId)
  }

  /**
   * 替换式重建发表关联（保留已存在站点的置顶与发表时间；新增站点按传入 isTop 落定）。
   * publishedAt：沿用文章全局发布时间（present = 文章当前 publishedAt）。
   */
  private async replacePublishes(
    articleId: bigint,
    siteIds: bigint[],
    publishedAt: Date | null,
    inputs?: Array<{ siteId: number; isTop?: boolean }>,
  ): Promise<void> {
    const topMap = new Map((inputs ?? []).map((s) => [BigInt(s.siteId).toString(), s.isTop === true]))
    const existing = await this.prisma.siteArticlePublish.findMany({
      where: { articleId },
      select: { siteId: true, isTop: true },
    })
    const existingTop = new Map(existing.map((r) => [r.siteId.toString(), r.isTop]))
    await this.prisma.$transaction(async (tx) => {
      await tx.siteArticlePublish.deleteMany({ where: { articleId } })
      if (siteIds.length === 0) return
      await tx.siteArticlePublish.createMany({
        data: siteIds.map((siteId) => {
          const key = siteId.toString()
          return {
            articleId,
            siteId,
            isTop: (topMap.get(key) ?? existingTop.get(key) === 1) ? 1 : 0,
            publishedAt,
          }
        }),
      })
    })
  }

  /** 文章发表站点明细（最终态，按站点 id 升序） */
  private async siteItemsOf(articleId: bigint): Promise<ArticleSiteItem[]> {
    const rows = await this.prisma.siteArticlePublish.findMany({
      where: { articleId },
      orderBy: { siteId: 'asc' },
    })
    if (rows.length === 0) return []
    const sites = await this.prisma.siteSite.findMany({
      where: { id: { in: rows.map((r) => r.siteId) } },
      select: { id: true, title: true, slug: true },
    })
    const map = new Map(sites.map((s) => [s.id.toString(), s]))
    return rows.map((r) => {
      const site = map.get(r.siteId.toString())
      return {
        id: r.siteId.toString(),
        name: site?.title ?? r.siteId.toString(),
        slug: site?.slug ?? '',
        isTop: r.isTop === 1,
        publishedAt: r.publishedAt,
      }
    })
  }

  /** 列表/详情 item 组装（columnName/tagIds/sites 批量查询） */
  private async toListItem(articles: SiteArticle[]): Promise<Record<string, unknown>[]> {
    if (articles.length === 0) return []
    const columnIds = [...new Set(articles.map((a) => a.columnId))]
    const articleIds = articles.map((a) => a.id)
    const [columns, tagRelations, publishes, sites] = await Promise.all([
      this.prisma.siteColumn.findMany({
        where: { id: { in: columnIds } },
        select: { id: true, name: true },
      }),
      this.prisma.siteArticleTag.findMany({
        where: { articleId: { in: articleIds } },
        select: { articleId: true, tagId: true },
      }),
      this.prisma.siteArticlePublish.findMany({
        where: { articleId: { in: articleIds } },
        orderBy: { siteId: 'asc' },
      }),
      this.prisma.siteSite.findMany({ select: { id: true, title: true, slug: true } }),
    ])
    const columnNameMap = new Map(columns.map((c) => [c.id.toString(), c.name]))
    const siteMap = new Map(sites.map((s) => [s.id.toString(), s]))
    const tagsMap = new Map<string, string[]>()
    for (const rel of tagRelations) {
      const key = rel.articleId.toString()
      const arr = tagsMap.get(key) ?? []
      arr.push(rel.tagId.toString())
      tagsMap.set(key, arr)
    }
    const publishMap = new Map<string, ArticleSiteItem[]>()
    for (const p of publishes) {
      const key = p.articleId.toString()
      const site = siteMap.get(p.siteId.toString())
      const arr = publishMap.get(key) ?? []
      arr.push({
        id: p.siteId.toString(),
        name: site?.title ?? p.siteId.toString(),
        slug: site?.slug ?? '',
        isTop: p.isTop === 1,
        publishedAt: p.publishedAt,
      })
      publishMap.set(key, arr)
    }
    return articles.map((a) => ({
      id: a.id.toString(),
      columnId: a.columnId.toString(),
      columnName: columnNameMap.get(a.columnId.toString()) ?? '',
      title: a.title,
      summary: a.summary,
      coverPath: a.coverPath,
      tagIds: tagsMap.get(a.id.toString()) ?? [],
      /** 已发表站点（P7 API §14.1） */
      sites: publishMap.get(a.id.toString()) ?? [],
      wordCount: a.wordCount,
      viewCount: a.viewCount,
      status: a.status,
      publishedAt: a.publishedAt,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    }))
  }

  /** 失效相关站点的开放层热数据缓存（D12 / §22.6：文章变更 → 全部发表站点） */
  private async invalidateForSites(siteIds: bigint[]): Promise<void> {
    const unique = [...new Set(siteIds.map((id) => id.toString()))]
    for (const siteId of unique) {
      await this.redis.scanDel(`site:data:${siteId}:*`).catch(() => undefined)
    }
  }
}
