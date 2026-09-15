import { Injectable } from '@nestjs/common'
import { ErrorCode } from '../../../common/constants/error-code'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { RedisKey } from '../../../common/constants/redis-key'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import { RedisService } from '../../../infra/redis/redis.service'
import {
  CloudFacade,
  type RawWriteResult,
  type SubtreeEntry,
} from '../../cloud/facade/cloud-facade.service'
import type { CreateArticleDto, UpdateArticleDto, UpdateArticleStatusDto } from '../article/dto/article.dto'
// 注意：以下 Service 必须为值导入（Nest 需构造函数实参做 DI；type-only 导入会被擦除成 Function）
import { SiteArticleService, ArticleQueryDto } from '../article/article.service'
import { SiteColumnService } from '../column/column.service'
import { SiteTagService } from '../tag/tag.service'
import type { CreateSiteDto, UpdateSiteDto } from '../manage/dto/site.dto'
import { SiteManageService, type SiteView } from '../manage/manage.service'

/**
 * 站点文本文件扩展名白名单（P4b §15.12：AI 三件套校验用，写死代码不进配置组；
 * 前端编辑器另维护同集显示条件，两边以架构增补 §15.12 为准对齐）。
 */
export const SITE_FILE_TEXT_EXTS: ReadonlySet<string> = new Set([
  'html',
  'htm',
  'css',
  'js',
  'mjs',
  'txt',
  'md',
  'json',
  'svg',
  'xml',
  'yml',
  'yaml',
  'csv',
])

/** AI 写单文件上限 256KB（§15.12） */
export const AI_WRITE_MAX_FILE_BYTES = 256 * 1024
/** AI 单次写入文件数上限（§15.12；超过时模型应分批 write，每批一张确认卡） */
export const AI_WRITE_MAX_FILES = 10
/** AI 读文件上限 64KB（§15.12：同时是模型上下文护栏） */
export const AI_READ_MAX_BYTES = 64 * 1024
/** AI 文章列表单页上限（P5 §20.1：20 条，防摘要列表撑爆上下文） */
export const AI_ARTICLE_PAGE_MAX = 20
/** AI 单次 ensure 标签数上限（P5 §20.1） */
export const AI_TAG_MAX = 20

/** 当前用户的某个站点信息（rootFolderId 保持 bigint 供域内机械操作，出域序列化由调用方转字符串） */
export interface MySiteInfo {
  id: bigint
  slug: string
  title: string
  status: number
  rootFolderId: bigint
}

/** 站点轻量标识（R56 回喂给模型请用户指定站点用） */
export interface SiteBrief {
  slug: string
  title: string
}

/**
 * 站点解析结果（P4E R56/D55）：只解析当前用户自己的站点，查无此 slug 不暴露他人站点存在性。
 * - `none`：0 站 → 工具回喂 40101 引导建站
 * - `ok`：命中（slug 提供且命中 / 省略且唯一站直通）
 * - `pick`：多站且省略 slug → 回喂站点列表请用户指定
 * - `notfound`：slug 提供但查无 → 回喂 40119 + 用户现有站点列表
 */
export type SiteResolution =
  | { status: 'none' }
  | { status: 'ok'; site: MySiteInfo }
  | { status: 'pick'; sites: SiteBrief[] }
  | { status: 'notfound'; sites: SiteBrief[] }

/** 站点文件清单结果（listFiles；null = 站点不存在/非属主） */
export interface SiteFileListResult {
  site: { slug: string; title: string; status: number }
  files: SubtreeEntry[]
  truncated: boolean
}

/** 单文件写入结果（writeFiles 逐项，部分成功语义 R18） */
export interface SiteFileWriteResult {
  path: string
  ok: boolean
  action?: 'created' | 'overwritten'
  size?: number
  error?: string
}

/** 站点读文件结果（UTF-8 解码后返回） */
export interface SiteFileReadResult {
  path: string
  size: number
  content: string
}

/** AI 文章读取上限（64KB，与站点文件读口径一致：正文可达 20 万字符，直喂会撑爆上下文） */
export const AI_ARTICLE_READ_MAX_BYTES = 64 * 1024

/**
 * R14 字数口径（跨域复用：AI 工具确认卡摘要需在**执行前**展示字数）。
 * 口径单一来源仍在 article.service.ts，本处仅经 site 域门面模块转出，避免 ai 域直插站点域内部文件（铁律 6）。
 */
export { countWordsR14 } from '../article/article.service'

/** 文章列表查询入参（AI 工具参数 → ArticleQueryDto 的薄映射） */
export interface ArticleListParams {
  columnId?: number
  status?: number
  keyword?: string
  pageNo?: number
  pageSize?: number
}

/** 栏目条目（ensure/list 出域形态） */
export interface SiteColumnItem {
  id: string
  parentId: string
  name: string
  sort: number
  articleCount: number
}

/** 文章条目（列表/详情出域形态；tagNames 由本层补全，tagIds 原样保留） */
export interface SiteArticleItem {
  id: string
  /** 所属站点 id（工具层用于交叉校验 slug 解析结果与文章实际归属一致） */
  siteId: string
  columnId: string
  columnName: string
  title: string
  summary: string | null
  tagIds: string[]
  tagNames: string[]
  wordCount: number
  viewCount: number
  status: number
  publishedAt: Date | null
  createdAt: Date
  updatedAt: Date
  /** 仅 readArticle 返回（超 64KB 时截断并置 truncated=true） */
  contentMd?: string
  truncated?: boolean
}

/** 文章创建入参（AI 口径：默认草稿，status=1 才发布；tagNames 走 ensure 语义） */
export interface CreateArticleInput {
  columnId?: number
  title: string
  contentMd: string
  summary?: string
  tagNames?: string[]
  status?: number
}

/** 文章更新入参（部分更新；tagNames 提供即整体替换） */
export interface UpdateArticleInput {
  title?: string
  contentMd?: string
  columnId?: number
  summary?: string
  tagNames?: string[]
}

/** ensure 语义结果（存在复用 / 不存在创建，幂等） */
export interface EnsureResult {
  id: string
  name: string
  created: boolean
}

/** 删站影响面（R66 确认卡摘要：三段影响中的「N 篇文章/栏目/标签/评论」） */
export interface SiteDeleteImpact {
  slug: string
  articles: number
  columns: number
  tags: number
  comments: number
}

/** 从文件名提取小写扩展名（无扩展名返回 ''） */
function extOfName(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/**
 * site 域门面：跨域（system/ai 等）只通过本门面与 site 交互，禁止直接 import 域内实现（域边界纪律）。
 * 封装：
 * - 删用户预检 hasSite（R13 / PRD-P4A D14）
 * - 多站解析（P4E R56）：getSites / resolveSite（0 站引导 / 单站直通 / 多站请用户指定 / 查无不暴露）
 * - 建站（P4E R57/D55）：createSite 委托 SiteManageService.create —— 与手动建站同一创建链，
 *   配额（40118）与 slug 校验（40102/40103）单点生效
 * - P4b 站点语义校验层（§15.3）：listFiles / readFile / writeFiles（均按 siteId 作用域，属主 40119）。
 *   路径规范 / 文本白名单 / 大小与数量上限等站点语义校验全部收敛在本层，抛 site 段码
 *   （40101 / 40113~40115 / 40400）；机械执行（树遍历/读盘/行写入）在 CloudFacade 机械原语，
 *   cloud 段码（30001/30003/30006）在本层捕获转换（read → 40400；write → per-file error）。
 *   ai 域工具因此只需注入本门面，零跨域 import 内部实现。
 */
@Injectable()
export class SiteFacade {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly cloudFacade: CloudFacade,
    private readonly manageService: SiteManageService,
    private readonly articleService: SiteArticleService,
    private readonly columnService: SiteColumnService,
    private readonly tagService: SiteTagService,
  ) {}

  /** 用户是否已开通站点（有 site_site 行即 true）；删除用户前预检，与 cloud hasFiles 并列 */
  async hasSite(userId: bigint): Promise<boolean> {
    const count = await this.prisma.siteSite.count({ where: { userId } })
    return count > 0
  }

  /** 用户全部站点（P4E：按创建时间升序，保证「第一站」语义稳定；未开通返回空数组） */
  async getSites(userId: bigint): Promise<MySiteInfo[]> {
    const sites = await this.prisma.siteSite.findMany({
      where: { userId },
      orderBy: [{ createTime: 'asc' }, { id: 'asc' }],
    })
    return sites.map((site) => this.toInfo(site))
  }

  /** 单个站点信息（属主校验；不存在/非属主返回 null） */
  async getSiteInfo(userId: bigint, siteId: bigint): Promise<MySiteInfo | null> {
    const site = await this.prisma.siteSite.findFirst({ where: { id: siteId, userId } })
    return site ? this.toInfo(site) : null
  }

  /**
   * 解析目标站点（P4E R56）：AI 三件套 slug 可选参数的统一入口，不抛异常（状态显式回喂模型）。
   * slug 提供 → 命中即 ok、查无 notfound（带站点列表）；省略 → 0 站 none / 1 站直通 ok / 多站 pick。
   */
  async resolveSite(userId: bigint, slug?: string): Promise<SiteResolution> {
    const sites = await this.getSites(userId)
    if (sites.length === 0) return { status: 'none' }
    const briefs: SiteBrief[] = sites.map((s) => ({ slug: s.slug, title: s.title }))
    if (slug) {
      const hit = sites.find((s) => s.slug === slug)
      return hit ? { status: 'ok', site: hit } : { status: 'notfound', sites: briefs }
    }
    if (sites.length === 1) return { status: 'ok', site: sites[0] }
    return { status: 'pick', sites: briefs }
  }

  /**
   * 建站（P4E R57/D55）：委托 SiteManageService.create —— 与手动建站同一创建链，
   * 配额（40118）/ slug 冲突（40102）/ 保留字（40103）口径天然一致。
   * 注意：本方法会把 BusinessException 原样上抛（配额满/slug 冲突），由调用方（工具层）转为回喂对象。
   */
  async createSite(userId: bigint, dto: CreateSiteDto): Promise<SiteView> {
    return this.manageService.create(userId, dto)
  }

  /** 站点数配额视图（AI create_site 配额满时回喂 limit/used 用，P4E R57） */
  async getQuota(userId: bigint): Promise<{ limit: number; used: number }> {
    return this.manageService.getQuota(userId)
  }

  /**
   * 精确失效站点路径解析缓存（§15.4）：对每个 path DEL `site:path:{siteId}:{path}`
   * （含可能存在的 "404" 负缓存）——AI/模板写入后访客立即可见，不等 60s TTL。
   * site 域自持 key 语义，cloud/ai 域不可见。
   */
  async invalidateSitePaths(siteId: bigint, paths: string[]): Promise<void> {
    const siteIdStr = siteId.toString()
    for (const p of paths) {
      await this.redis.client.del(RedisKey.sitePath(siteIdStr, p)).catch(() => undefined)
    }
  }

  /** 站点文件树（管理侧语义，属主视角，不做公开性判定）；站点不存在/非属主 → 40119 */
  async listFiles(userId: bigint, siteId: bigint): Promise<SiteFileListResult> {
    const site = await this.requireOwnedSite(userId, siteId)
    const { files, truncated } = await this.cloudFacade.listSubtreeRaw(site.rootFolderId)
    return {
      site: { slug: site.slug, title: site.title, status: site.status },
      files,
      truncated,
    }
  }

  /**
   * 读站点文本文件（站点语义校验层）：
   * 站点不存在/非属主 40119 / 路径非法 40113 / 非白名单 40114 / 超过 64KB 40115 / 不存在或目录 40400。
   */
  async readFile(userId: bigint, siteId: bigint, path: string): Promise<SiteFileReadResult> {
    const site = await this.requireOwnedSite(userId, siteId)
    const normalized = this.normalizeSitePath(path)
    const ext = extOfName(normalized)
    if (!SITE_FILE_TEXT_EXTS.has(ext)) {
      throw new BusinessException(ErrorCode.SiteFileTypeNotAllowed, '文件类型不允许（仅文本白名单扩展名）')
    }

    // 机械读盘（cloud 段）：不存在/是目录（30001）→ 站点语义层统一 40400（分段归位 §15.3）
    let raw: { size: number; content: Buffer }
    try {
      raw = await this.cloudFacade.readFileRaw(site.rootFolderId, normalized)
    } catch (e) {
      throw this.toSiteError(e)
    }
    if (raw.size > AI_READ_MAX_BYTES) {
      throw new BusinessException(ErrorCode.SiteContentTooLarge, '文件超出读取上限（64KB）')
    }
    return { path: normalized, size: raw.size, content: raw.content.toString('utf-8') }
  }

  /**
   * 批量写站点文件（R18：逐文件独立成败，部分成功不整体回滚）：
   * - 站点不存在/非属主 → 40119
   * - 批量约束：单次 ≤10 个（40115）
   * - 逐文件：路径规范（40113 → per-file error）/ 白名单（40114）/ 单文件 ≤256KB（40115）→
   *   CloudFacade.writeFileRaw 机械写入（30001/30003/30006 捕获为该文件 error）
   * - 同路径软删旧版 + 新建（回收站可回滚，D22）
   * - 全部完成后精确失效 ok 路径的 site:path 缓存（含负缓存）
   */
  async writeFiles(
    userId: bigint,
    siteId: bigint,
    files: Array<{ path: string; content: string }>,
  ): Promise<SiteFileWriteResult[]> {
    const site = await this.requireOwnedSite(userId, siteId)
    if (files.length === 0 || files.length > AI_WRITE_MAX_FILES) {
      throw new BusinessException(
        ErrorCode.SiteContentTooLarge,
        `单次最多写入 ${AI_WRITE_MAX_FILES} 个文件`,
      )
    }

    const results: SiteFileWriteResult[] = []
    for (const file of files) {
      // 站点语义校验（失败记为该项 error，不中断其余文件）
      let normalized: string
      try {
        normalized = this.normalizeSitePath(file.path)
      } catch (e) {
        results.push({ path: file.path, ok: false, error: (e as BusinessException).message })
        continue
      }
      const ext = extOfName(normalized)
      if (!SITE_FILE_TEXT_EXTS.has(ext)) {
        results.push({ path: normalized, ok: false, error: '文件类型不允许（仅文本白名单扩展名）' })
        continue
      }
      if (Buffer.byteLength(file.content, 'utf-8') > AI_WRITE_MAX_FILE_BYTES) {
        results.push({ path: normalized, ok: false, error: '内容超出单文件写入上限（256KB）' })
        continue
      }

      // 机械写入（cloud 段异常捕获为该文件 error，部分成功语义）
      try {
        const r: RawWriteResult = await this.cloudFacade.writeFileRaw(
          userId,
          site.rootFolderId,
          normalized,
          Buffer.from(file.content, 'utf-8'),
        )
        results.push({ path: normalized, ok: true, action: r.action, size: r.size })
      } catch (e) {
        if (e instanceof BusinessException) {
          results.push({ path: normalized, ok: false, error: e.message })
        } else {
          throw e
        }
      }
    }

    // 精确失效 ok 路径的 site:path 缓存（含负缓存）——AI 写完访客立即可见
    const okPaths = results.filter((r) => r.ok).map((r) => r.path)
    if (okPaths.length > 0) {
      await this.invalidateSitePaths(site.id, okPaths)
    }
    return results
  }

  // ==================== P5 §20.1 CMS 层（articles / columns / tags） ====================
  // 全部委托 site 域既有 Service（同域直注），属主校验与业务语义（R6 栏目层级 / R7 / R14 / R65）
  // 留在域内；slug → siteId 的解析在 AI 工具层经 resolveSiteForTool 完成（R56 四分支），
  // 故本层方法一律收 siteId（不回喂对象，避免工具层语义漏进门面）。

  /**
   * 文章分页列表（站点作用域，属主 40119）：摘要形态（无 contentMd），tagNames 在本层补全。
   * pageSize 上限 20（AI 口径，防上下文膨胀）。
   */
  async listArticles(
    userId: bigint,
    siteId: bigint,
    params: ArticleListParams,
  ): Promise<{ list: SiteArticleItem[]; total: number; pageNo: number; pageSize: number }> {
    await this.requireOwnedSite(userId, siteId)
    const query = new ArticleQueryDto()
    query.siteId = Number(siteId)
    query.pageNo = params.pageNo ?? 1
    query.pageSize = Math.min(params.pageSize ?? AI_ARTICLE_PAGE_MAX, AI_ARTICLE_PAGE_MAX)
    if (params.columnId !== undefined) query.columnId = params.columnId
    if (params.status !== undefined) query.status = params.status
    if (params.keyword) query.keyword = params.keyword

    const result = await this.articleService.list(userId, query)
    const tagNames = await this.tagNameMap(userId, siteId)
    return {
      list: result.list.map((item) => this.toArticleItem(item, siteId, tagNames)),
      total: result.total,
      pageNo: result.pageNo,
      pageSize: result.pageSize,
    }
  }

  /** 读文章全文（属主按实体反查 40109/40119）；正文超 64KB 截断并置 truncated=true */
  async readArticle(userId: bigint, id: bigint): Promise<SiteArticleItem> {
    const siteId = await this.articleService.getOwnedSiteId(userId, id)
    const detail = (await this.articleService.detail(userId, id)) as Record<string, unknown>
    const tagNames = await this.tagNameMap(userId, siteId)
    const item = this.toArticleItem(detail, siteId, tagNames)
    const contentMd = typeof detail.contentMd === 'string' ? detail.contentMd : ''
    if (Buffer.byteLength(contentMd, 'utf-8') > AI_ARTICLE_READ_MAX_BYTES) {
      return { ...item, contentMd: contentMd.slice(0, AI_ARTICLE_READ_MAX_BYTES), truncated: true }
    }
    return { ...item, contentMd, truncated: false }
  }

  /**
   * 创建文章（D63/R65）：默认草稿（status 缺省 0，仅显式 1 才发布）；
   * columnId 缺省时——本站仅 1 个栏目则直达，否则回喂 40001 并附栏目清单请模型指定；
   * tagNames 走 ensure 语义（存在复用、不存在创建）；摘要留空由既有口径自动取正文前 100 字。
   */
  async createArticle(userId: bigint, siteId: bigint, input: CreateArticleInput): Promise<SiteArticleItem> {
    await this.requireOwnedSite(userId, siteId)
    const columnId = await this.resolveColumnId(userId, siteId, input.columnId)
    const tags = input.tagNames?.length ? await this.ensureTags(userId, siteId, input.tagNames) : []
    const status = input.status === 1 ? 1 : 0

    const dto: CreateArticleDto = {
      siteId: Number(siteId),
      columnId,
      title: input.title,
      contentMd: input.contentMd,
      status,
      ...(input.summary ? { summary: input.summary } : {}),
      ...(tags.length > 0 ? { tagIds: tags.map((t) => Number(t.id)) } : {}),
    }
    const created = await this.articleService.create(userId, dto)
    return this.composeArticle(userId, siteId, BigInt(created.id))
  }

  /** 更新文章（部分更新；tagNames 提供即整体替换，走 ensure 语义） */
  async updateArticle(userId: bigint, id: bigint, input: UpdateArticleInput): Promise<SiteArticleItem> {
    const siteId = await this.articleService.getOwnedSiteId(userId, id)
    const dto: UpdateArticleDto = {}
    if (input.title !== undefined) dto.title = input.title
    if (input.contentMd !== undefined) dto.contentMd = input.contentMd
    if (input.columnId !== undefined) dto.columnId = input.columnId
    if (input.summary !== undefined) dto.summary = input.summary
    if (input.tagNames !== undefined) {
      // 提供即整体替换：显式空数组 = 清空该文章全部标签（articleService.update 会整体重建关联）
      dto.tagIds =
        input.tagNames.length === 0
          ? []
          : (await this.ensureTags(userId, siteId, input.tagNames)).map((t) => Number(t.id))
    }
    if (Object.keys(dto).length === 0) {
      throw new BusinessException(ErrorCode.ParamInvalid, '至少需要提供一项要修改的字段')
    }
    await this.articleService.update(userId, id, dto)
    return this.composeArticle(userId, siteId, id)
  }

  /** 发布 / 下架文章（0 下架 / 1 发布；published_at 口径沿用） */
  async publishArticle(userId: bigint, id: bigint, status: number): Promise<SiteArticleItem> {
    const siteId = await this.articleService.getOwnedSiteId(userId, id)
    const dto: UpdateArticleStatusDto = { status: status === 1 ? 1 : 0 }
    await this.articleService.updateStatus(userId, id, dto)
    return this.composeArticle(userId, siteId, id)
  }

  /** 栏目 ensure（幂等）：同名同父命中即返回现有（created=false），否则创建（R6 层级校验在域内） */
  async ensureColumn(
    userId: bigint,
    siteId: bigint,
    input: { name: string; parentId?: number },
  ): Promise<EnsureResult> {
    await this.requireOwnedSite(userId, siteId)
    const parentId = input.parentId ?? 0
    const columns = await this.columnService.list(userId, siteId)
    const hit = columns.find((c) => c.name === input.name && String(c.parentId) === String(parentId))
    if (hit) return { id: String(hit.id), name: hit.name, created: false }
    const created = await this.columnService.create(userId, {
      siteId: Number(siteId),
      parentId,
      name: input.name,
      sort: 0,
    })
    return { id: String(created.id), name: created.name, created: true }
  }

  /** 标签列表（AI 工具确认卡摘要「复用/新建」预判用；属主 40119） */
  async listTags(
    userId: bigint,
    siteId: bigint,
  ): Promise<Array<{ id: string; name: string; articleCount: number }>> {
    await this.requireOwnedSite(userId, siteId)
    const tags = await this.tagService.list(userId, siteId)
    return tags.map((t) => ({ id: String(t.id), name: t.name, articleCount: t.articleCount }))
  }

  /** 栏目平铺列表（AI 工具确认卡摘要 / columnId 缺省时的引导清单用；属主 40119） */
  async listColumns(userId: bigint, siteId: bigint): Promise<SiteColumnItem[]> {
    await this.requireOwnedSite(userId, siteId)
    const columns = await this.columnService.list(userId, siteId)
    return columns.map((c) => ({
      id: String(c.id),
      parentId: String(c.parentId),
      name: c.name,
      sort: c.sort,
      articleCount: c.articleCount,
    }))
  }

  /** 标签批量 ensure（幂等）：返回 tagIds；名称去重、去空、限 1~32 字、单次 ≤20 个 */
  async ensureTags(userId: bigint, siteId: bigint, names: string[]): Promise<EnsureResult[]> {
    await this.requireOwnedSite(userId, siteId)
    const cleaned = [
      ...new Set(
        names
          .map((n) => (typeof n === 'string' ? n.trim() : ''))
          .filter((n) => n.length > 0 && n.length <= 32),
      ),
    ]
    if (cleaned.length === 0) {
      throw new BusinessException(ErrorCode.ParamInvalid, '标签名需为 1~32 字')
    }
    if (cleaned.length > AI_TAG_MAX) {
      throw new BusinessException(ErrorCode.ParamInvalid, `单次最多 ${AI_TAG_MAX} 个标签`)
    }
    const existing = await this.tagService.list(userId, siteId)
    const idByName = new Map(existing.map((tag) => [tag.name, String(tag.id)]))
    const results: EnsureResult[] = []
    for (const name of cleaned) {
      const hit = idByName.get(name)
      if (hit) {
        results.push({ id: hit, name, created: false })
        continue
      }
      const created = await this.tagService.create(userId, { siteId: Number(siteId), name })
      results.push({ id: String(created.id), name: created.name, created: true })
    }
    return results
  }

  // ==================== P5 §20.1 站点生命周期（update / delete） ====================

  /** 编辑站点（title/description/newSlug/status/commentAudit；委托 manage.update，slug 校验 40102/40103 同在域内） */
  async updateSite(
    userId: bigint,
    siteId: bigint,
    input: {
      title?: string
      description?: string
      newSlug?: string
      status?: number
      commentAudit?: number
    },
  ): Promise<SiteView> {
    const dto: UpdateSiteDto = {}
    if (input.title !== undefined) dto.title = input.title
    if (input.description !== undefined) dto.description = input.description
    if (input.newSlug !== undefined) dto.slug = input.newSlug
    if (input.status !== undefined) dto.status = input.status
    if (input.commentAudit !== undefined) dto.commentAudit = input.commentAudit
    if (Object.keys(dto).length === 0) {
      throw new BusinessException(ErrorCode.ParamInvalid, '至少需要提供一项要修改的字段')
    }
    return this.manageService.update(userId, siteId, dto)
  }

  /** 删站影响面预检（R66 确认卡摘要用；只读计数，不写库） */
  async getSiteDeleteImpact(userId: bigint, siteId: bigint): Promise<SiteDeleteImpact> {
    const site = await this.requireOwnedSite(userId, siteId)
    const [articles, columns, tags, comments] = await Promise.all([
      this.prisma.siteArticle.count({ where: { siteId: site.id } }),
      this.prisma.siteColumn.count({ where: { siteId: site.id } }),
      this.prisma.siteTag.count({ where: { siteId: site.id } }),
      this.prisma.siteComment.count({ where: { siteId: site.id } }),
    ])
    return { slug: site.slug, articles, columns, tags, comments }
  }

  /** 删站（R50/R53/R55 级联，委托 manage.remove）：返回 `{ deletedArticles, recycledRoot }` 供摘要 */
  async deleteSite(userId: bigint, siteId: bigint): Promise<{ deletedArticles: number; recycledRoot: boolean }> {
    return this.manageService.remove(userId, siteId)
  }

  // ==================== CMS 层私有辅助 ====================

  /** 文章写后回读（摘要口径），tagNames 由本站标签表补全 */
  private async composeArticle(userId: bigint, siteId: bigint, id: bigint): Promise<SiteArticleItem> {
    const detail = (await this.articleService.detail(userId, id)) as Record<string, unknown>
    const tagNames = await this.tagNameMap(userId, siteId)
    return this.toArticleItem(detail, siteId, tagNames)
  }

  /** 本站标签 id → 名称映射 */
  private async tagNameMap(userId: bigint, siteId: bigint): Promise<Map<string, string>> {
    const tags = await this.tagService.list(userId, siteId)
    return new Map(tags.map((tag) => [String(tag.id), tag.name]))
  }

  /** 文章行 → 出域条目（tagIds 经映射补 tagNames，未命中回退原 id） */
  private toArticleItem(
    item: Record<string, unknown>,
    siteId: bigint,
    tagNames: Map<string, string>,
  ): SiteArticleItem {
    const tagIds = Array.isArray(item.tagIds) ? (item.tagIds as string[]).map(String) : []
    return {
      id: String(item.id ?? ''),
      siteId: siteId.toString(),
      columnId: String(item.columnId ?? ''),
      columnName: String(item.columnName ?? ''),
      title: String(item.title ?? ''),
      summary: (item.summary as string | null) ?? null,
      tagIds,
      tagNames: tagIds.map((id) => tagNames.get(id) ?? id),
      wordCount: Number(item.wordCount ?? 0),
      viewCount: Number(item.viewCount ?? 0),
      status: Number(item.status ?? 0),
      publishedAt: (item.publishedAt as Date | null) ?? null,
      createdAt: item.createdAt as Date,
      updatedAt: item.updatedAt as Date,
    }
  }

  /**
   * 解析栏目 id（R65）：显式提供即用（归属校验由 articleService.create/update 抛 40106）；
   * 缺省时本站仅 1 个栏目则直达，否则回喂 40001 并附「名称(id=xx)」清单请模型指定。
   */
  private async resolveColumnId(userId: bigint, siteId: bigint, columnId?: number): Promise<number> {
    if (columnId !== undefined) return columnId
    const columns = await this.columnService.list(userId, siteId)
    if (columns.length === 1) return Number(columns[0].id)
    if (columns.length === 0) {
      throw new BusinessException(
        ErrorCode.ParamInvalid,
        '该站点还没有栏目，请先调用 ensure_site_column 创建栏目，再用返回的 columnId 重试',
      )
    }
    const hint = columns
      .slice(0, 20)
      .map((c) => `${c.name}(id=${c.id})`)
      .join('、')
    throw new BusinessException(ErrorCode.ParamInvalid, `请指定 columnId（本站栏目：${hint}）`)
  }

  /** 断言站点存在且属主（40119，文案不暴露他人站点存在性），返回站点信息 */
  private async requireOwnedSite(userId: bigint, siteId: bigint): Promise<MySiteInfo> {
    const site = await this.getSiteInfo(userId, siteId)
    if (!site) {
      throw new BusinessException(ErrorCode.SiteForbidden, '站点不存在或非属主')
    }
    return site
  }

  /** site_site 行 → 域内站点信息（保持 bigint，出域序列化由调用方负责） */
  private toInfo(site: {
    id: bigint
    slug: string
    title: string
    status: number
    rootFolderId: bigint
  }): MySiteInfo {
    return {
      id: site.id,
      slug: site.slug,
      title: site.title,
      status: site.status,
      rootFolderId: site.rootFolderId,
    }
  }

  /** 站点路径规范化（R17）：拒绝对路径 / `..` / 空段 / 反斜杠 / 段超长（64 字符），返回规范相对路径 → 40113 */
  private normalizeSitePath(path: string): string {
    if (typeof path !== 'string' || path.length === 0) {
      throw new BusinessException(ErrorCode.SiteFilePathInvalid, '站点文件路径非法')
    }
    if (path.includes('\\')) {
      throw new BusinessException(ErrorCode.SiteFilePathInvalid, '站点文件路径非法（禁止反斜杠）')
    }
    if (path.startsWith('/')) {
      throw new BusinessException(ErrorCode.SiteFilePathInvalid, '站点文件路径非法（禁止绝对路径）')
    }
    const segments = path.split('/')
    for (const seg of segments) {
      if (seg.length === 0 || seg === '.' || seg === '..') {
        throw new BusinessException(ErrorCode.SiteFilePathInvalid, '站点文件路径非法（含空段/./..）')
      }
      if (seg.length > 64) {
        throw new BusinessException(ErrorCode.SiteFilePathInvalid, '站点文件路径非法（单段超长）')
      }
    }
    return segments.join('/')
  }

  /** cloud 段异常 → 站点语义层映射（30001 不存在/目录 → 40400；其余原样上抛） */
  private toSiteError(e: unknown): Error {
    if (e instanceof BusinessException && e.code === ErrorCode.CloudFileNotFound) {
      return new BusinessException(ErrorCode.NotFound, '文件不存在')
    }
    return e as Error
  }
}
