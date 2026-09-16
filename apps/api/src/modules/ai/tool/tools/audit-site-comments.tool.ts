import type { SiteFacade } from '../../../site/facade/site-facade.service'
import { AI_COMMENT_BATCH_MAX } from '../../../site/facade/site-facade.service'
import type { AiTool } from '../tool.types'
import { feedSiteError } from './list-site-files.tool'
import { resolveToolSite } from './list-site-articles.tool'
import { auditActionStatus, feedParamInvalid, readCommentIds } from './list-site-comments.tool'
import { readStrParam } from './tool-params'

/**
 * 批量审核评论（write，确认卡；D69 代审 / R71 / R74）。
 * 逐条独立成败（部分成功语义，沿用 P5 批次模式），返回逐条结果供模型汇总；
 * 通过后评论立即在站点公开可见（开放层仅返回 audit_status=1）。
 */
export function createAuditSiteCommentsTool(siteFacade: SiteFacade): AiTool {
  return {
    name: 'audit_site_comments',
    title: '批量审核评论',
    description:
      '批量通过或驳回当前用户站点的评论（单次最多 20 条，需先用 list_site_comments 拿到评论 id）。' +
      'action=approve 通过 → 评论立即在站点访客端公开可见；action=reject 驳回 → 维持访客不可见。' +
      '逐条处理，部分失败不影响其余，返回每条的成功或失败原因。**审核会改变站点公开内容，属写操作，必须先经用户确认**。',
    parameters: {
      type: 'object',
      properties: {
        slug: {
          type: 'string',
          description: '目标站点标识（多站点用户必传；省略时：0 站返回引导、1 站直通、多站返回站点清单请用户指定）',
        },
        ids: {
          type: 'array',
          items: { type: 'integer' },
          description: `要处理的评论 id 数组（1~${AI_COMMENT_BATCH_MAX} 个，来自 list_site_comments）`,
        },
        action: {
          type: 'string',
          enum: ['approve', 'reject'],
          description: 'approve=通过（公开可见）/ reject=驳回（访客不可见）',
        },
      },
      required: ['ids', 'action'],
      additionalProperties: false,
    },
    perms: 'site:comment:audit',
    risk: 'write',
    /** 确认卡摘要（R71）：条数 + 通过/驳回 + 公开影响 + 目标站点 */
    summarize: async (params, ctx) => {
      const ids = readCommentIds(params)
      const action = readStrParam(params, 'action')
      if (ids.length === 0 || !action) return null
      const pass = action === 'approve'
      const lines = [
        `${pass ? '批量通过' : '批量驳回'}评论：${ids.length} 条（${ids.map((id) => `#${id}`).join('、')}）`,
        pass ? '通过后评论立即在站点访客端公开可见' : '驳回后评论保持访客不可见',
      ]
      try {
        const target = await resolveToolSite(siteFacade, ctx.user.userId, params)
        if (!target.ok) return null
        lines.push(`目标站点：${target.site.title}（${target.site.slug}）`)
        return lines.join('\n')
      } catch {
        return null
      }
    },
    handler: async (ctx, params) => {
      const ids = readCommentIds(params)
      const action = readStrParam(params, 'action')
      if (ids.length === 0) return feedParamInvalid('请提供要审核的评论 id 数组（可用 list_site_comments 获取）')
      if (ids.length > AI_COMMENT_BATCH_MAX) {
        return feedParamInvalid(`单次最多审核 ${AI_COMMENT_BATCH_MAX} 条评论，请分批处理`)
      }
      if (!action) return feedParamInvalid('action 仅允许 approve（通过）或 reject（驳回）')
      const auditStatus = auditActionStatus(action)

      try {
        const target = await resolveToolSite(siteFacade, ctx.user.userId, params)
        if (!target.ok) return target.feed
        const results = await siteFacade.auditComments(
          BigInt(ctx.user.userId),
          target.site.id,
          ids,
          auditStatus,
        )
        const succeeded: number[] = []
        const failed: Array<{ id: number; message: string }> = []
        for (const item of results) {
          if (item.ok) succeeded.push(item.id)
          else failed.push({ id: item.id, message: item.message })
        }
        return {
          ok: failed.length === 0,
          site: { slug: target.site.slug, title: target.site.title },
          action,
          total: ids.length,
          succeeded,
          failed,
        }
      } catch (e) {
        return feedSiteError(e)
      }
    },
  }
}
