import { ErrorCode } from '../../../../common/constants/error-code'
import type { SiteFacade } from '../../../site/facade/site-facade.service'
import type { AiTool } from '../tool.types'
import { feedSiteError } from './list-site-files.tool'
import { resolveToolSite } from './list-site-articles.tool'
import { readNumParam, readStrParam } from './tool-params'

/**
 * 确保栏目存在（write，确认卡；D63/R65 ensure 语义）。
 * 幂等：同名同父栏目命中即复用（created=false），不存在才创建（created=true）——避免 AI 造重复栏目。
 */
export function createEnsureSiteColumnTool(siteFacade: SiteFacade): AiTool {
  return {
    name: 'ensure_site_column',
    title: '确保站点栏目存在',
    description:
      '确保站点里存在某个栏目（**幂等**）：同名且同父级的栏目已存在时直接复用（返回 created=false），不存在才创建（created=true），并返回栏目 id。' +
      '用于「给文章指定/创建栏目」：先拿到 columnId 再创建文章；也可响应用户「加一个技术栏目」。' +
      '栏目最多 3 级（parentId 省略 = 顶级栏目，传 id 则挂到该栏目下）；删除栏目请让用户在后台「栏目管理」操作。',
    parameters: {
      type: 'object',
      properties: {
        slug: {
          type: 'string',
          description: '目标站点标识（多站点用户必传；省略时：0 站返回引导、1 站直通、多站返回站点清单请用户指定）',
        },
        name: { type: 'string', description: '栏目名称（1~32 字）' },
        parentId: { type: 'integer', description: '父栏目 id（省略 = 顶级栏目）' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    perms: 'site:column:create',
    risk: 'write',
    /** 确认卡摘要：栏目名 + 父级 + 复用/新建预判 */
    summarize: async (params, ctx) => {
      const name = readStrParam(params, 'name')
      if (!name) return null
      const parentId = readNumParam(params, 'parentId') ?? 0
      try {
        const target = await resolveToolSite(siteFacade, ctx.user.userId, params)
        if (!target.ok) return null
        const columns = await siteFacade.listColumns(BigInt(ctx.user.userId), target.site.id)
        const hit = columns.find((c) => c.name === name && c.parentId === String(parentId))
        const parent = columns.find((c) => c.id === String(parentId))
        const parentText = parentId === 0 ? '顶级栏目' : parent ? `${parent.name}（id=${parent.id}）` : `id=${parentId}`
        return [
          `确保栏目「${name}」存在：`,
          `父级：${parentText}`,
          hit
            ? `已存在同名栏目（id=${hit.id}）→ 直接复用，不会重复创建`
            : '尚不存在 → 将新建该栏目',
          `目标站点：${target.site.title}（${target.site.slug}）`,
        ].join('\n')
      } catch {
        return null
      }
    },
    handler: async (ctx, params) => {
      const name = readStrParam(params, 'name') ?? ''
      if (!name) {
        return { ok: false, errorCode: ErrorCode.ParamInvalid, message: '栏目名称 name 为必填' }
      }
      try {
        const target = await resolveToolSite(siteFacade, ctx.user.userId, params)
        if (!target.ok) return target.feed
        const result = await siteFacade.ensureColumn(BigInt(ctx.user.userId), target.site.id, {
          name,
          parentId: readNumParam(params, 'parentId'),
        })
        return {
          ok: true,
          site: { slug: target.site.slug, title: target.site.title },
          id: result.id,
          name: result.name,
          created: result.created,
        }
      } catch (e) {
        return feedSiteError(e)
      }
    },
  }
}
