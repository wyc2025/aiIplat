import { ErrorCode } from '../../../../common/constants/error-code'
import { BusinessException } from '../../../../common/exceptions/business.exception'
import type { SiteFacade } from '../../../site/facade/site-facade.service'
import type { AiTool } from '../tool.types'
import { feedSiteError } from './list-site-files.tool'

/** slug 规则文案（与 site 域 R11 一致：格式正则 + 保留字黑名单 + 全局唯一） */
const SLUG_RULE = '3~32 位小写字母/数字/连字符，字母或数字开头，非系统保留字，且全局唯一'

/**
 * 创建站点（write，site:site:manage，走确认卡；P4E R57/D55）。
 * handler 经 SiteFacade.createSite 走 manage 同一创建链（配额校验单点生效）：
 * - 配额满 → 回喂 `{ ok:false, errorCode:40118, message, limit, used }`（不抛栈）
 * - slug 冲突 40102 / 保留字 40103 → 回喂 `{ ok:false, errorCode, message }`，模型可换 slug 重试
 * - 成功 → `{ ok:true, site:{ slug, title, siteUrl } }`
 */
export function createCreateSiteTool(siteFacade: SiteFacade): AiTool {
  return {
    name: 'create_site',
    title: '创建站点',
    description:
      '为当前用户新建一个个人站点（默认写入四件套模板：index.html/style.css/app.js/README.txt，并自动创建 media/ 目录）。' +
      `slug 规则：${SLUG_RULE}。` +
      '站点数量受管理员配置的配额限制，配额满时返回 errorCode 40118（含 limit/used），此时不要重试，' +
      '请告知用户联系管理员调整配额。' +
      '用户已有多站点时可正常新建（配额允许范围内）。使用前建议先询问用户期望的站点标识与标题。',
    parameters: {
      type: 'object',
      properties: {
        slug: {
          type: 'string',
          description: `站点标识（${SLUG_RULE}），用于访问地址 /api/open/{slug}/`,
        },
        title: {
          type: 'string',
          description: '站点标题（1~50 字，展示用）',
        },
        description: {
          type: 'string',
          description: '站点描述（≤200 字，可选）',
        },
      },
      required: ['slug', 'title'],
      additionalProperties: false,
    },
    perms: 'site:site:manage',
    risk: 'write',
    /** 确认卡摘要（P4E R57）：人读文案「创建站点 {slug}（{title}）」 */
    summarize: (params) => {
      const slug = typeof params.slug === 'string' ? params.slug : ''
      const title = typeof params.title === 'string' ? params.title : ''
      return `创建站点 ${slug}（${title}）`
    },
    handler: async (ctx, params) => {
      const slug = typeof params.slug === 'string' ? params.slug.trim() : ''
      const title = typeof params.title === 'string' ? params.title.trim() : ''
      const description = typeof params.description === 'string' ? params.description : undefined
      if (!slug || !title) {
        return { ok: false, errorCode: ErrorCode.ParamInvalid, message: 'slug 与 title 均为必填' }
      }
      try {
        const site = await siteFacade.createSite(BigInt(ctx.user.userId), { slug, title, description })
        return { ok: true, site: { slug: site.slug, title: site.title, siteUrl: site.siteUrl } }
      } catch (e) {
        // 配额满：附加 limit/used 供模型转述（R57）
        if (e instanceof BusinessException && e.code === ErrorCode.SiteQuotaExceeded) {
          const { limit, used } = await siteFacade.getQuota(BigInt(ctx.user.userId))
          return { ok: false, errorCode: e.code, message: e.message, limit, used }
        }
        return feedSiteError(e)
      }
    },
  }
}
