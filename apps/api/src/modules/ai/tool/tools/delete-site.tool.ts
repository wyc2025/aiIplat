import { ErrorCode } from '../../../../common/constants/error-code'
import type { SiteFacade } from '../../../site/facade/site-facade.service'
import type { AiTool } from '../tool.types'
import { feedSiteError } from './list-site-files.tool'
import { resolveToolSite } from './list-site-articles.tool'
import { readStrParam } from './tool-params'

/**
 * 删除站点（write，确认卡；D64/R66）。
 * 确认卡摘要 = R66 三段影响 + 文章数统计（文章/栏目/标签/评论物理删除不可恢复、站点文件进回收站可还原、
 * slug 立即释放）。执行走 site 域既有删站级联（R50/R53/R55）。
 */
export function createDeleteSiteTool(siteFacade: SiteFacade): AiTool {
  return {
    name: 'delete_site',
    title: '删除站点',
    description:
      '**删除当前用户的某个站点**（确认卡会列出影响面）。删除后：该站点的全部文章、栏目、标签、评论被**物理删除且不可恢复**；站点文件目录移入云盘回收站（可还原）；站点标识 slug 立即释放（可被重新注册）。' +
      '仅当用户**明确要求删除站点**时才调用本工具；若用户只是想临时关站，请改用 update_site 把 status 设为 0。' +
      '删除后如需重建站点，请用 create_site（受站点配额限制）。',
    parameters: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: '要删除的站点标识（必传）' },
      },
      required: ['slug'],
      additionalProperties: false,
    },
    perms: 'site:site:manage',
    risk: 'write',
    /** 确认卡摘要（R66）：三段影响 + 文章/栏目/标签/评论数 */
    summarize: async (params, ctx) => {
      const slug = readStrParam(params, 'slug')
      if (!slug) return null
      try {
        const target = await resolveToolSite(siteFacade, ctx.user.userId, params)
        if (!target.ok) return null
        const impact = await siteFacade.getSiteDeleteImpact(BigInt(ctx.user.userId), target.site.id)
        return [
          `将删除站点 ${impact.slug}（${target.site.title}）：`,
          // P7 D73：删站只删该站的展示关联——文章/栏目/标签本体保留在内容池
          `⚠️ 将从本站下架 ${impact.articles} 篇文章（文章本体保留在内容池）并删除 ${impact.comments} 条评论，**不可恢复**`,
          '站点文件目录将移入云盘回收站（可在回收站还原为普通文件夹）',
          `站点标识 ${impact.slug} 立即释放（此后可被重新注册）`,
        ].join('\n')
      } catch {
        return null
      }
    },
    handler: async (ctx, params) => {
      const slug = readStrParam(params, 'slug')
      if (!slug) {
        return { ok: false, errorCode: ErrorCode.ParamInvalid, message: '请提供要删除的站点 slug' }
      }
      try {
        const target = await resolveToolSite(siteFacade, ctx.user.userId, params)
        if (!target.ok) return target.feed
        const impact = await siteFacade.getSiteDeleteImpact(BigInt(ctx.user.userId), target.site.id)
        const result = await siteFacade.deleteSite(BigInt(ctx.user.userId), target.site.id)
        return {
          ok: true,
          slug: impact.slug,
          unpublishedArticles: result.unpublishedArticles,
          deletedComments: result.deletedComments,
          recycledRoot: result.recycledRoot,
        }
      } catch (e) {
        return feedSiteError(e)
      }
    },
  }
}
