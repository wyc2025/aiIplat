import { ErrorCode } from '../../../../common/constants/error-code'
import type { SiteFacade } from '../../../site/facade/site-facade.service'
import type { AiTool } from '../tool.types'
import { feedSiteError } from './list-site-files.tool'
import { articleIdParam, resolveToolSite } from './list-site-articles.tool'
import { readNumParam } from './tool-params'

/** 文章上架/下架（write，确认卡；上架摘要带「发布即公开可见」警示行 R63/D63） */
export function createPublishSiteArticleTool(siteFacade: SiteFacade): AiTool {
  return {
    name: 'publish_site_article',
    title: '文章上架/下架',
    description:
      '把当前用户的某篇文章**上架（status=1，发布即公开可见）或下架（status=0，访客立即不可见）**。' +
      'id 需先通过 list_site_articles 获取。首次发布才会记录发布时间（下架再上架不刷新发布时间）。' +
      '下架只是隐藏，不会删除文章；要修改内容请用 update_site_article。',
    parameters: {
      type: 'object',
      properties: {
        slug: {
          type: 'string',
          description: '目标站点标识（多站点用户必传；省略时：0 站返回引导、1 站直通、多站返回站点清单请用户指定）',
        },
        id: { type: 'integer', description: '文章 id（从 list_site_articles 获取）' },
        status: { type: 'integer', enum: [0, 1], description: '目标状态：1 发布（公开可见）/ 0 下架（不可见）' },
      },
      required: ['id', 'status'],
      additionalProperties: false,
    },
    perms: 'site:article:publish',
    risk: 'write',
    /** 确认卡摘要：文章标识 + 目标状态 +（上架时）公开可见警示 */
    summarize: async (params, ctx) => {
      const id = articleIdParam(params)
      const status = readNumParam(params, 'status')
      if (id === null || (status !== 0 && status !== 1)) return null
      try {
        const target = await resolveToolSite(siteFacade, ctx.user.userId, params)
        if (!target.ok) return null
        const article = await siteFacade.readArticle(BigInt(ctx.user.userId), BigInt(id))
        if (article.siteId !== target.site.id.toString()) return null
        const lines = [
          status === 1
            ? `将文章《${article.title}》（id=${id}）上架`
            : `将文章《${article.title}》（id=${id}）下架`,
          `当前状态：${article.status === 1 ? '已发布' : '草稿'}`,
        ]
        if (status === 1) {
          lines.push('⚠️ 发布即公开可见：访客立即可通过站点访问该文章')
        } else {
          lines.push('下架后访客立即不可见（文章不会被删除，可再次上架）')
        }
        lines.push(`目标站点：${target.site.title}（${target.site.slug}）`)
        return lines.join('\n')
      } catch {
        return null
      }
    },
    handler: async (ctx, params) => {
      const id = articleIdParam(params)
      const status = readNumParam(params, 'status')
      if (id === null || (status !== 0 && status !== 1)) {
        return {
          ok: false,
          errorCode: ErrorCode.ParamInvalid,
          message: '请提供文章 id（整数）与 status（0 下架 / 1 发布）',
        }
      }
      try {
        const target = await resolveToolSite(siteFacade, ctx.user.userId, params)
        if (!target.ok) return target.feed
        const article = await siteFacade.publishArticle(BigInt(ctx.user.userId), BigInt(id), status)
        return {
          ok: true,
          site: { slug: target.site.slug, title: target.site.title },
          id: article.id,
          title: article.title,
          status: article.status,
          publishedAt: article.publishedAt,
        }
      } catch (e) {
        return feedSiteError(e)
      }
    },
  }
}
