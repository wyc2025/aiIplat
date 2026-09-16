import { ErrorCode } from '../../../../common/constants/error-code'
import type { SiteFacade } from '../../../site/facade/site-facade.service'
import type { AiTool } from '../tool.types'
import { feedSiteError } from './list-site-files.tool'
import { articleIdParam, resolveToolSite } from './list-site-articles.tool'

/** 读取文章全文（read，自动执行）；正文超 64KB 截断并置 truncated=true */
export function createReadSiteArticleTool(siteFacade: SiteFacade): AiTool {
  return {
    name: 'read_site_article',
    title: '读取我的站点文章',
    description:
      '按文章 id 读取当前用户某篇文章的**全文**（含 markdown 正文 contentMd、所属栏目、标签、状态、字数、浏览量）。' +
      'id 需先通过 list_site_articles 获取；正文超过 64KB 时会被截断并返回 truncated=true。' +
      '改写文章前建议先读一次（确认现有内容与状态）。',
    parameters: {
      type: 'object',
      properties: {
        slug: {
          type: 'string',
          description: '目标站点标识（多站点用户必传；省略时：0 站返回引导、1 站直通、多站返回站点清单请用户指定）',
        },
        id: { type: 'integer', description: '文章 id（从 list_site_articles 获取）' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    perms: 'site:article:list',
    risk: 'read',
    handler: async (ctx, params) => {
      const id = articleIdParam(params)
      if (id === null) {
        return { ok: false, errorCode: ErrorCode.ParamInvalid, message: '请提供文章 id（可用 list_site_articles 获取）' }
      }
      try {
        const target = await resolveToolSite(siteFacade, ctx.user.userId, params)
        if (!target.ok) return target.feed
        const article = await siteFacade.readArticle(BigInt(ctx.user.userId), BigInt(id))
        // P7 D73：文章不再「属于」某站 —— 改校验是否已发表到该站
        if (!article.sites.some((s) => s.id === target.site.id.toString())) {
          return {
            ok: false,
            errorCode: ErrorCode.SiteArticleNotFound,
            message: `文章 ${id} 未发表到站点 ${target.site.slug}（请确认 slug 与文章 id 是否配套）`,
          }
        }
        return { site: { slug: target.site.slug, title: target.site.title }, article }
      } catch (e) {
        return feedSiteError(e)
      }
    },
  }
}
