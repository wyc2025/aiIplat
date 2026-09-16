import { ErrorCode } from '../../../../common/constants/error-code'
import type { SiteFacade } from '../../../site/facade/site-facade.service'
import { COMMENT_CONTENT_MAX } from '../../../site/facade/site-facade.service'
import type { AiTool } from '../tool.types'
import { feedSiteError } from './list-site-files.tool'
import { resolveToolSite } from './list-site-articles.tool'
import { briefText } from './list-site-comments.tool'
import { readNumParam } from './tool-params'

/**
 * 以作者身份回复评论（write，确认卡；D69 代回 / R71 / R74）。
 * 一级回复：每条评论至多一条，重复回复 = 覆盖更新；content 传空串 = 清除已有回复。
 * 当前实现不改审核语义：评论本身未过审时回复也不可见（R71）。
 */
export function createReplySiteCommentTool(siteFacade: SiteFacade): AiTool {
  return {
    name: 'reply_site_comment',
    title: '以作者身份回复评论',
    description:
      '以站点作者身份回复一条评论（一级回复，每条评论至多一条；再次回复会**覆盖**原有回复）。' +
      `content 为回复正文（trim 后 ≤${COMMENT_CONTENT_MAX} 字），**传空字符串表示清除已有回复**。` +
      '评论 id 需先用 list_site_comments 获取；评论必须属于当前站点。' +
      '回复内容会在评论过审后随评论在站点公开显示（作者回复不单独审核）。',
    parameters: {
      type: 'object',
      properties: {
        slug: {
          type: 'string',
          description: '目标站点标识（多站点用户必传；省略时：0 站返回引导、1 站直通、多站返回站点清单请用户指定）',
        },
        id: { type: 'integer', description: '评论 id（从 list_site_comments 获取）' },
        content: {
          type: 'string',
          description: `回复内容（≤${COMMENT_CONTENT_MAX} 字；空字符串 = 清除已有回复）`,
        },
      },
      required: ['id', 'content'],
      additionalProperties: false,
    },
    perms: 'site:comment:audit',
    risk: 'write',
    /** 确认卡摘要（R71）：原评论昵称/内容截断 + 回复内容 */
    summarize: async (params, ctx) => {
      const id = readNumParam(params, 'id')
      if (id === undefined) return null
      const content = typeof params.content === 'string' ? params.content.trim() : ''
      try {
        const target = await resolveToolSite(siteFacade, ctx.user.userId, params)
        if (!target.ok) return null
        const brief = await siteFacade.getCommentBrief(BigInt(ctx.user.userId), target.site.id, BigInt(id))
        const lines = [
          content.length > 0
            ? `回复评论 #${brief.id}（${brief.nickname}）：`
            : `清除评论 #${brief.id}（${brief.nickname}）的作者回复：`,
          `原评论：「${briefText(brief.content)}」`,
        ]
        if (brief.replyContent) {
          lines.push(`当前回复：「${briefText(brief.replyContent)}」（将被${content.length > 0 ? '覆盖' : '清除'}）`)
        }
        if (content.length > 0) lines.push(`回复内容：${content}`)
        lines.push('回复随评论一起在站点公开显示（评论未过审则一并不可见）')
        lines.push(`目标站点：${target.site.title}（${target.site.slug}）`)
        return lines.join('\n')
      } catch {
        return null
      }
    },
    handler: async (ctx, params) => {
      const id = readNumParam(params, 'id')
      if (id === undefined) {
        return { ok: false, errorCode: ErrorCode.ParamInvalid, message: '请提供评论 id（可用 list_site_comments 获取）' }
      }
      const content = typeof params.content === 'string' ? params.content : ''
      if (content.trim().length > COMMENT_CONTENT_MAX) {
        return {
          ok: false,
          errorCode: ErrorCode.ParamInvalid,
          message: `回复内容最多 ${COMMENT_CONTENT_MAX} 字`,
        }
      }
      try {
        const target = await resolveToolSite(siteFacade, ctx.user.userId, params)
        if (!target.ok) return target.feed
        const result = await siteFacade.replyComment(
          BigInt(ctx.user.userId),
          target.site.id,
          BigInt(id),
          content,
        )
        return {
          ok: true,
          site: { slug: target.site.slug, title: target.site.title },
          id: result.id,
          nickname: result.nickname,
          content: briefText(result.content),
          replyContent: result.replyContent,
          replyAt: result.replyAt,
          cleared: result.replyContent === null,
        }
      } catch (e) {
        return feedSiteError(e)
      }
    },
  }
}
