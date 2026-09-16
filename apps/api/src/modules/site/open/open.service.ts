import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ErrorCode } from '../../../common/constants/error-code'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { RedisKey } from '../../../common/constants/redis-key'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import { RedisService } from '../../../infra/redis/redis.service'
import { assertRateLimit } from './rate-limit.util'
import { SiteResolveService, type ResolvedSite } from './site-resolve.service'
import type { CreateOpenCommentDto, OpenArticlesQueryDto, OpenCommentPageDto } from './dto/open.dto'

/** 开放数据热缓存 TTL（秒，§14.6：60s，site 域写操作主动 scanDel 失效） */
const DATA_TTL_SEC = 60
/** R8 查看数去重窗口（秒）：site:view:{articleId}:{ip} SET NX EX 300 */
const VIEW_WINDOW_SEC = 300
/** R9 同文章同 IP 评论间隔（秒）：60s 一条，命中 40111 */
const COMMENT_INTERVAL_SEC = 60
/** 开放层摘要关键词截断（缓存 key 防超长） */
const KEYWORD_KEY_MAX = 50

/** 开放层契约：一切资源类失败统一 40400（不区分站点/文章/栏目，防探测，R15/D10） */
function notFound(): never {
  throw new BusinessException(ErrorCode.NotFound, '资源不存在')
}

/** 文章列表原生 SQL 行（MySQL 列名 snake_case） */
interface OpenArticleRow {
  id: bigint
  column_id: bigint
  title: string
  summary: string
  cover_path: string | null
  word_count: number | bigint
  view_count: number | bigint
  published_at: Date | null
}

/** 原生行 → toOpenItem 入参形态 */
function toArticleShape(row: OpenArticleRow) {
  return {
    id: row.id,
    columnId: row.column_id,
    title: row.title,
    summary: row.summary,
    coverPath: row.cover_path,
    wordCount: Number(row.word_count),
    viewCount: Number(row.view_count),
    publishedAt: row.published_at,
  }
}

/**
 * 开放数据 API 编排（§14.6 / API.md §6.3，v1 只增不改）：
 * 全部只读 + 评论提交；仅返回已发布文章与已过审评论；columns 后端组嵌套树（消费者是用户站点代码）；
 * 热数据缓存 site:data:{siteId}:{接口}:{参数摘要} TTL 60s（详情不含 viewCount，返回前读库覆盖，保证计数实时性）；
 * 文章详情触发查看数（R8）；评论提交限流（R9：10 次/分/IP + 同文章同 IP 60s 一条 → 40111）。
 * 全程禁挂 @OperationLog（D11，由 controller 层保证）。
 */
@Injectable()
export class SiteOpenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly resolveService: SiteResolveService,
    private readonly config: ConfigService,
  ) {}

  /** 站点信息（标题/描述；复用 slug 解析缓存，无需二级缓存） */
  async siteInfo(slug: string): Promise<{ title: string; description: string | null }> {
    const site = await this.assertSite(slug)
    return { title: site.title, description: site.description }
  }

  /**
   * 栏目嵌套树（后端组树，契约例外于平台平铺惯例）。
   * P7 D73：只出「本站展示」的栏目（存在 site_column_display 行），排序用该行的 sort。
   */
  async columns(slug: string): Promise<Array<{ id: string; name: string; sort: number; children: unknown[] }>> {
    const site = await this.assertSite(slug)
    return this.cached(site.siteId, 'columns', async () => {
      const [displays, columns] = await Promise.all([
        this.prisma.siteColumnDisplay.findMany({
          where: { siteId: BigInt(site.siteId) },
          orderBy: [{ sort: 'asc' }, { columnId: 'asc' }],
        }),
        this.prisma.siteColumn.findMany({ where: { userId: BigInt(site.userId) } }),
      ])
      const sortMap = new Map(displays.map((d) => [d.columnId.toString(), d.sort]))
      const visible = new Set(displays.map((d) => d.columnId.toString()))
      return this.buildTree(
        columns
          .filter((c) => visible.has(c.id.toString()))
          .map((c) => ({ ...c, sort: sortMap.get(c.id.toString()) ?? c.sort })),
      )
    })
  }

  /**
   * 标签列表（P7 D73）：标签跟随文章——只出本站已发表文章实际用到的标签。
   */
  async tags(slug: string): Promise<Array<{ id: string; name: string }>> {
    const site = await this.assertSite(slug)
    return this.cached(site.siteId, 'tags', async () => {
      const relations = await this.prisma.siteArticleTag.findMany({
        where: {
          article: { status: 1, publishes: { some: { siteId: BigInt(site.siteId) } } },
        },
        select: { tagId: true },
        distinct: ['tagId'],
      })
      if (relations.length === 0) return []
      const tags = await this.prisma.siteTag.findMany({
        where: { id: { in: relations.map((r) => r.tagId) } },
        orderBy: { id: 'asc' },
      })
      return tags.map((t) => ({ id: t.id.toString(), name: t.name }))
    })
  }

  /**
   * 文章分页列表（P7 D73：仅「已发布且发表到本站」的文章；排序 = 本站置顶优先 → 发布时间倒序）。
   * 置顶排序跨关联表（site_article_publish.is_top），Prisma 无法对关联字段排序，故走参数化原生 SQL。
   */
  async articles(slug: string, query: OpenArticlesQueryDto) {
    const site = await this.assertSite(slug)
    const key = `articles:${this.articlesKeyDigest(query)}`
    return this.cached(site.siteId, key, async () => {
      // tagId 筛选：先查关联得文章 ID 集（空集短路）
      let tagArticleIds: bigint[] | null = null
      if (query.tagId !== undefined) {
        const relations = await this.prisma.siteArticleTag.findMany({
          where: {
            tagId: BigInt(query.tagId),
            article: { status: 1, publishes: { some: { siteId: BigInt(site.siteId) } } },
          },
          select: { articleId: true },
        })
        tagArticleIds = relations.map((r) => r.articleId)
        if (tagArticleIds.length === 0) {
          return { list: [], total: 0, pageNo: query.pageNo, pageSize: query.pageSize }
        }
      }
      const conditions = ['p.site_id = ?', 'a.status = 1']
      const params: unknown[] = [BigInt(site.siteId)]
      if (query.columnId !== undefined) {
        conditions.push('a.column_id = ?')
        params.push(BigInt(query.columnId))
      }
      if (query.keyword) {
        conditions.push('a.title LIKE ?')
        params.push(`%${query.keyword}%`)
      }
      if (tagArticleIds) {
        conditions.push(`a.id IN (${tagArticleIds.map(() => '?').join(',')})`)
        params.push(...tagArticleIds)
      }
      const whereSql = conditions.join(' AND ')
      const rows = await this.prisma.$queryRawUnsafe<OpenArticleRow[]>(
        `SELECT a.id, a.column_id, a.title, a.summary, a.cover_path, a.word_count, a.view_count, a.published_at
         FROM site_article a
         JOIN site_article_publish p ON p.article_id = a.id AND p.site_id = ?
         WHERE ${whereSql}
         ORDER BY p.is_top DESC, a.published_at DESC, a.id DESC
         LIMIT ? OFFSET ?`,
        BigInt(site.siteId),
        ...params,
        query.pageSize,
        (query.pageNo - 1) * query.pageSize,
      )
      const totalRows = await this.prisma.$queryRawUnsafe<Array<{ c: bigint }>>(
        `SELECT COUNT(*) c FROM site_article a
         JOIN site_article_publish p ON p.article_id = a.id AND p.site_id = ?
         WHERE ${whereSql}`,
        BigInt(site.siteId),
        ...params,
      )
      const list = await this.toOpenItem(slug, rows.map(toArticleShape))
      return {
        list,
        total: Number(totalRows[0]?.c ?? 0),
        pageNo: query.pageNo,
        pageSize: query.pageSize,
      }
    })
  }

  /** 文章详情（含 contentMd；触发查看数 R8；viewCount 实时读库覆盖缓存值） */
  async articleDetail(slug: string, articleId: bigint, ip: string) {
    const site = await this.assertSite(slug)
    const cached = await this.cachedArticle(site.siteId, articleId, slug)
    // R8：SET NX EX 300 去重，首次命中 view_count+1（计数与缓存解耦，窗口内刷新不重复 +1）
    await this.recordView(articleId, ip)
    // viewCount 实时覆盖（§14.6：详情缓存不含 view_count）
    const live = await this.prisma.siteArticle.findUnique({
      where: { id: articleId },
      select: { viewCount: true },
    })
    return { ...cached, viewCount: live?.viewCount ?? cached.viewCount }
  }

  /** 文章评论列表（仅已过审，按时间正序） */
  async comments(slug: string, articleId: bigint, query: OpenCommentPageDto) {
    const site = await this.assertSite(slug)
    await this.assertPublishedArticle(site.siteId, articleId)
    const key = `comments:${articleId.toString()}:p${query.pageNo}-${query.pageSize}`
    return this.cached(site.siteId, key, async () => {
      // P7 D75：评论按站隔离——本站评论只出本站的（同一文章发表到多站时互不可见）
      const where = { siteId: BigInt(site.siteId), articleId, auditStatus: 1 }
      const [rows, total] = await Promise.all([
        this.prisma.siteComment.findMany({
          where,
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          skip: (query.pageNo - 1) * query.pageSize,
          take: query.pageSize,
        }),
        this.prisma.siteComment.count({ where }),
      ])
      // P6 T78 / R71：评论条目携带作者回复（本查询恒为 audit_status=1，故回复可见性与评论一致；
      // 未回复条目两字段为 null，前端判空渲染）
      const list = rows.map((c) => ({
        id: c.id.toString(),
        nickname: c.nickname,
        content: c.content,
        createdAt: c.createdAt,
        replyContent: c.replyContent,
        replyAt: c.replyAt,
      }))
      return { list, total, pageNo: query.pageNo, pageSize: query.pageSize }
    })
  }

  /** 访客提交评论（R9 限流 + 审核流；成功统一文案"已提交，审核后展示"） */
  async submitComment(slug: string, articleId: bigint, dto: CreateOpenCommentDto, ip: string) {
    const site = await this.assertSite(slug)
    await this.assertPublishedArticle(site.siteId, articleId)
    // R9：评论提交独立桶 10 次/分/IP（site 配置组）
    await assertRateLimit(
      this.redis,
      'comment',
      ip,
      this.config.get<number>('site.siteCommentRateLimit', 10),
    )
    // R9：同文章同 IP 60 秒 1 条（命中 → 40111）
    const first = await this.redis.client.set(
      RedisKey.siteCommentRate(articleId.toString(), ip),
      '1',
      'EX',
      COMMENT_INTERVAL_SEC,
      'NX',
    )
    if (first !== 'OK') {
      throw new BusinessException(ErrorCode.SiteCommentTooFrequent, '评论提交过于频繁，请稍后再试')
    }
    // 审核流：站点审核开关开 → 待审（0）；关 → 直过审（1）
    const auditStatus = site.commentAudit === 1 ? 0 : 1
    await this.prisma.siteComment.create({
      data: {
        siteId: BigInt(site.siteId),
        articleId,
        nickname: dto.nickname,
        content: dto.content,
        auditStatus,
        ip,
      },
    })
    // D12：评论变更失效开放层热缓存（直过审场景立即可见）
    await this.redis.scanDel(`site:data:${site.siteId}:*`).catch(() => undefined)
    return { message: '已提交，审核后展示' }
  }

  /** 开放数据接口统一限流（api 桶 60 次/分/IP，site 配置组） */
  async assertApiRateLimit(ip: string): Promise<void> {
    await assertRateLimit(
      this.redis,
      'api',
      ip,
      this.config.get<number>('site.siteOpenApiRateLimit', 60),
    )
  }

  // ================= 私有辅助 =================

  /** slug → 站点；不存在/停用 → 40400（R10/R15） */
  private async assertSite(slug: string): Promise<ResolvedSite> {
    const site = await this.resolveService.resolveSite(slug)
    if (!site) notFound()
    return site
  }

  /** 本站已发布文章（P7 D73：须存在该站发表关联）；草稿/未发表到本站/不存在 → 40400（不区分，防探测） */
  private async assertPublishedArticle(siteId: string, articleId: bigint) {
    const article = await this.prisma.siteArticle.findFirst({
      where: { id: articleId, status: 1, publishes: { some: { siteId: BigInt(siteId) } } },
    })
    if (!article) notFound()
    return article
  }

  /** 文章详情（缓存不含 viewCount；slug 由调用方传入拼 coverUrl，改 slug 时由 manage 侧 scanDel 失效） */
  private async cachedArticle(siteId: string, articleId: bigint, slug: string) {
    return this.cached(siteId, `article:${articleId.toString()}`, async () => {
      const article = await this.prisma.siteArticle.findFirst({
        where: { id: articleId, status: 1, publishes: { some: { siteId: BigInt(siteId) } } },
      })
      if (!article) notFound()
      const [item] = await this.toOpenItem(slug, [article])
      return { ...item, contentMd: article.contentMd }
    })
  }

  /** 热数据缓存（site:data:{siteId}:{key}，TTL 60s；缓存读写失败降级直查） */
  private async cached<T>(siteId: string, key: string, loader: () => Promise<T>): Promise<T> {
    const cacheKey = RedisKey.siteData(siteId, key)
    const hit = await this.redis.client.get(cacheKey).catch(() => null)
    if (hit) {
      try {
        return JSON.parse(hit) as T
      } catch {
        // 缓存损坏：降级直查
      }
    }
    const value = await loader()
    await this.redis.client
      .set(cacheKey, JSON.stringify(value), 'EX', DATA_TTL_SEC)
      .catch(() => undefined)
    return value
  }

  /** R8 查看数：site:view:{articleId}:{ip} SET NX EX 300，首次命中才 +1 */
  private async recordView(articleId: bigint, ip: string): Promise<void> {
    const first = await this.redis.client
      .set(RedisKey.siteView(articleId.toString(), ip), '1', 'EX', VIEW_WINDOW_SEC, 'NX')
      .catch(() => null)
    if (first === 'OK') {
      await this.prisma.siteArticle
        .update({ where: { id: articleId }, data: { viewCount: { increment: 1 } } })
        .catch(() => undefined)
    }
  }

  /** 开放 item 装配：coverUrl 完整公开路径（无封面 null）、columnName、tags */
  private async toOpenItem(
    slug: string,
    articles: Array<{
      id: bigint
      columnId: bigint
      title: string
      summary: string
      coverPath: string | null
      wordCount: number
      viewCount: number
      publishedAt: Date | null
    }>,
  ) {
    if (articles.length === 0) return []
    const columnIds = [...new Set(articles.map((a) => a.columnId))]
    const articleIds = articles.map((a) => a.id)
    const [columns, relations] = await Promise.all([
      this.prisma.siteColumn.findMany({
        where: { id: { in: columnIds } },
        select: { id: true, name: true },
      }),
      this.prisma.siteArticleTag.findMany({
        where: { articleId: { in: articleIds } },
        select: { articleId: true, tag: { select: { id: true, name: true } } },
      }),
    ])
    const columnNameMap = new Map(columns.map((c) => [c.id.toString(), c.name]))
    const tagsMap = new Map<string, Array<{ id: string; name: string }>>()
    for (const rel of relations) {
      const key = rel.articleId.toString()
      const arr = tagsMap.get(key) ?? []
      arr.push({ id: rel.tag.id.toString(), name: rel.tag.name })
      tagsMap.set(key, arr)
    }
    return articles.map((a) => ({
      id: a.id.toString(),
      title: a.title,
      summary: a.summary,
      coverUrl: a.coverPath ? `/api/open/${slug}/${a.coverPath}` : null,
      columnId: a.columnId.toString(),
      columnName: columnNameMap.get(a.columnId.toString()) ?? '',
      tags: tagsMap.get(a.id.toString()) ?? [],
      wordCount: a.wordCount,
      viewCount: a.viewCount,
      publishedAt: a.publishedAt,
    }))
  }

  /** 栏目嵌套树（后端组树，≤3 级） */
  private buildTree(
    columns: Array<{ id: bigint; parentId: bigint; name: string; sort: number }>,
  ): Array<{ id: string; name: string; sort: number; children: unknown[] }> {
    const nodes = new Map<string, { id: string; name: string; sort: number; children: unknown[] }>()
    const roots: Array<{ id: string; name: string; sort: number; children: unknown[] }> = []
    for (const c of columns) {
      nodes.set(c.id.toString(), { id: c.id.toString(), name: c.name, sort: c.sort, children: [] })
    }
    for (const c of columns) {
      const node = nodes.get(c.id.toString())
      if (!node) continue
      const parent = c.parentId === BigInt(0) ? null : nodes.get(c.parentId.toString())
      if (parent) parent.children.push(node)
      else roots.push(node)
    }
    return roots
  }

  /** 文章列表缓存 key 参数摘要 */
  private articlesKeyDigest(query: OpenArticlesQueryDto): string {
    const kw = (query.keyword ?? '').slice(0, KEYWORD_KEY_MAX)
    return `col=${query.columnId ?? ''}&tag=${query.tagId ?? ''}&kw=${kw}&p${query.pageNo}-${query.pageSize}`
  }
}
