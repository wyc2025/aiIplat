import type { MySiteInfo, SiteFacade } from '../../../site/facade/site-facade.service'
import { AI_ARTICLE_PAGE_MAX } from '../../../site/facade/site-facade.service'
import type { AiTool } from '../tool.types'
import { feedSiteError, readSlugParam, resolveSiteForTool } from './list-site-files.tool'
import { readNumParam } from './tool-params'

/**
 * 站点 CMS 系列工具共用 helper 宿主（P5 T73，照站点三件套先例）。
 * slug → 站点的解析统一走 resolveSiteForTool（R56 四分支），facade 只收 siteId。
 */

/** 站点解析结果（工具层）：命中站点 or 直接回喂给模型 */
export type ToolSiteResult =
  | { ok: true; site: MySiteInfo }
  | { ok: false; feed: unknown }

/** CMS / 生命周期工具的 slug 解析统一入口（省略 slug 的四种分支语义由 resolveSiteForTool 承担） */
export async function resolveToolSite(
  siteFacade: SiteFacade,
  userId: string,
  params: Record<string, unknown>,
): Promise<ToolSiteResult> {
  const target = await resolveSiteForTool(siteFacade, userId, readSlugParam(params))
  return target.kind === 'feed' ? { ok: false, feed: target.feed } : { ok: true, site: target.site }
}

/** 文章状态中文文案 */
export function articleStatusText(status: number): string {
  return status === 1 ? '已发布（公开可见）' : '草稿（不公开）'
}

/** 文章载荷 JSON 片段：`123`（非法/缺省 → null） */
export function articleIdParam(params: Record<string, unknown>): number | null {
  return readNumParam(params, 'id') ?? null
}

/**
 * 分页查询我的站点文章（read）。
 * 只返回摘要（无正文）；正文用 read_site_article。
 */
export function createListSiteArticlesTool(siteFacade: SiteFacade): AiTool {
  return {
    name: 'list_site_articles',
    title: '列出我的站点文章',
    description:
      '分页查询当前用户某个个人站点的文章列表（CMS 层文章，表驱动，与站点文件无关）。' +
      '可按 columnId（栏目 id）、status（0 草稿 / 1 已发布）、keyword（标题模糊）筛选；每页最多 20 条，返回标题、摘要、所属栏目名、标签、字数、浏览量、状态与发布时间。' +
      '返回**不含正文**；要读正文请用 read_site_article（需先从这里拿到文章 id）。' +
      '改写文章前建议先 list 一次确认 id 与状态，避免误改。',
    parameters: {
      type: 'object',
      properties: {
        slug: {
          type: 'string',
          description: '目标站点标识（多站点用户必传；省略时：0 站返回引导、1 站直通、多站返回站点清单请用户指定）',
        },
        columnId: { type: 'integer', description: '按栏目 id 筛选（可选）' },
        status: { type: 'integer', description: '按状态筛选：0 草稿 / 1 已发布（可选）', enum: [0, 1] },
        keyword: { type: 'string', description: '标题关键词（模糊匹配，可选）' },
        page: { type: 'integer', description: '页码，从 1 起（默认 1）' },
      },
      additionalProperties: false,
    },
    perms: 'site:article:list',
    risk: 'read',
    handler: async (ctx, params) => {
      try {
        const target = await resolveToolSite(siteFacade, ctx.user.userId, params)
        if (!target.ok) return target.feed
        // P7 D73：内容池化后按用户查内容池，站点降为「已发表到该站」筛选
        const result = await siteFacade.listArticles(
          BigInt(ctx.user.userId),
          {
            columnId: readNumParam(params, 'columnId'),
            status: readNumParam(params, 'status'),
            keyword: typeof params.keyword === 'string' ? params.keyword.trim() : undefined,
            pageNo: readNumParam(params, 'page') ?? 1,
            pageSize: AI_ARTICLE_PAGE_MAX,
          },
          target.site.id,
        )
        return {
          site: { slug: target.site.slug, title: target.site.title },
          total: result.total,
          pageNo: result.pageNo,
          pageSize: result.pageSize,
          articles: result.list,
        }
      } catch (e) {
        return feedSiteError(e)
      }
    },
  }
}
