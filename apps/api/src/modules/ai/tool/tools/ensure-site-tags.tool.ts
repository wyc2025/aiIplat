import { ErrorCode } from '../../../../common/constants/error-code'
import type { SiteFacade } from '../../../site/facade/site-facade.service'
import type { AiTool } from '../tool.types'
import { feedSiteError } from './list-site-files.tool'
import { resolveToolSite } from './list-site-articles.tool'
import { readStrArrayParam } from './tool-params'

/** 确保标签批量存在（write，确认卡；D63/R65 ensure 语义：已存在的复用、不存在的创建，幂等） */
export function createEnsureSiteTagsTool(siteFacade: SiteFacade): AiTool {
  return {
    name: 'ensure_site_tags',
    title: '确保站点标签存在',
    description:
      '确保站点里存在一批标签（**批量幂等**）：按名称给出，已存在的直接复用（created=false）、不存在的创建（created=true），返回每个标签的 id。' +
      '用于给文章打标签前先拿到标签 id（create_site_article / update_site_article 也可直接传 tagNames 一步到位，无需先调本工具）。' +
      '单次最多 20 个，名称 1~32 字；删除标签请让用户在后台「标签管理」操作。',
    parameters: {
      type: 'object',
      properties: {
        slug: {
          type: 'string',
          description: '目标站点标识（多站点用户必传；省略时：0 站返回引导、1 站直通、多站返回站点清单请用户指定）',
        },
        names: {
          type: 'array',
          items: { type: 'string' },
          description: '标签名称数组（1~20 个，名称 1~32 字）',
        },
      },
      required: ['names'],
      additionalProperties: false,
    },
    perms: 'site:tag:create',
    risk: 'write',
    /** 确认卡摘要：标签清单 + 复用/新建预判 */
    summarize: async (params, ctx) => {
      const names = readStrArrayParam(params, 'names')
      if (names.length === 0) return null
      try {
        const target = await resolveToolSite(siteFacade, ctx.user.userId, params)
        if (!target.ok) return null
        const existing = await siteFacade.listTags(BigInt(ctx.user.userId), target.site.id)
        const existingNames = new Set(existing.map((t) => t.name))
        const lines = [`确保 ${names.length} 个标签存在：`]
        for (const [index, name] of names.entries()) {
          lines.push(`${index + 1}. ${name}${existingNames.has(name) ? '（已存在，复用）' : '（将新建）'}`)
        }
        lines.push(`目标站点：${target.site.title}（${target.site.slug}）`)
        return lines.join('\n')
      } catch {
        return null
      }
    },
    handler: async (ctx, params) => {
      const names = readStrArrayParam(params, 'names')
      if (names.length === 0) {
        return { ok: false, errorCode: ErrorCode.ParamInvalid, message: 'names 至少提供 1 个标签名称' }
      }
      try {
        const target = await resolveToolSite(siteFacade, ctx.user.userId, params)
        if (!target.ok) return target.feed
        const tags = await siteFacade.ensureTags(BigInt(ctx.user.userId), target.site.id, names)
        return {
          ok: true,
          site: { slug: target.site.slug, title: target.site.title },
          tags,
        }
      } catch (e) {
        return feedSiteError(e)
      }
    },
  }
}
