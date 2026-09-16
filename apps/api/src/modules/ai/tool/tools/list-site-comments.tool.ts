import { ErrorCode } from '../../../../common/constants/error-code'
import type { SiteCommentItem, SiteFacade } from '../../../site/facade/site-facade.service'
import { AI_COMMENT_PAGE_MAX } from '../../../site/facade/site-facade.service'
import type { AiTool } from '../tool.types'
import { feedSiteError } from './list-site-files.tool'
import { resolveToolSite } from './list-site-articles.tool'
import { readNumParam, readStrParam } from './tool-params'

/**
 * 评论系列工具共用 helper 宿主（P6 T78，照站点三件套 / CMS 先例）。
 * slug → 站点的解析统一走 resolveToolSite（R56 四分支），facade 只收 siteId；
 * 评论归属校验：三个工具都要求评论属于解析出的当前站点（跨站 = 40119，R71）。
 */

/** status 参数 → 审核状态（pending 待审 0 / approved 已通过 1 / rejected 已驳回 2 / all 全部） */
export const COMMENT_STATUS_MAP: Record<string, number | undefined> = {
  pending: 0,
  approved: 1,
  rejected: 2,
  all: undefined,
}

/** 审核状态中文文案 */
export function commentStatusText(status: number): string {
  return status === 1 ? '已通过（公开可见）' : status === 2 ? '已驳回' : '待审核'
}

/** 确认卡/回喂用文本截断（默认 30 字，与 R71 摘要口径一致） */
export function briefText(text: string, max = 30): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

/** 评论一行摘要：`#12 访客甲「…」（待审核）` */
export function commentLine(item: { id: string; nickname: string; content: string; auditStatus: number }): string {
  return `#${item.id} ${item.nickname}「${briefText(item.content)}」（${commentStatusText(item.auditStatus)}）`
}

/** 模型可见形态：内容截断到 60 字（防上下文膨胀），截断时置 contentTruncated */
function toModelItem(item: SiteCommentItem) {
  const contentTruncated = item.content.length > 60
  return {
    id: item.id,
    articleId: item.articleId,
    articleTitle: item.articleTitle,
    nickname: item.nickname,
    content: contentTruncated ? briefText(item.content, 60) : item.content,
    contentTruncated,
    auditStatus: item.auditStatus,
    auditStatusText: commentStatusText(item.auditStatus),
    replyContent: item.replyContent,
    replyAt: item.replyAt,
    createdAt: item.createdAt,
  }
}

/**
 * 列出站点评论（read，site:comment:audit）：默认待审核（D69 代审入口）。
 * 批量审核/回复前先用本工具拿评论 id。
 */
export function createListSiteCommentsTool(siteFacade: SiteFacade): AiTool {
  return {
    name: 'list_site_comments',
    title: '列出站点评论',
    description:
      '分页查询当前用户个人站点的评论（默认只看**待审核**）。可按 status 筛选（pending 待审核（默认）/ approved 已通过 / rejected 已驳回 / all 全部），' +
      '可按 articleId 只看某篇文章的评论；每页最多 20 条。每条返回评论 id、所属文章标题、访客昵称、内容（超 60 字截断）、审核状态、作者回复（若有）、提交时间与总数。' +
      '**要在文章底部公开显示的评论必须先审核通过**；批量审核用 audit_site_comments、以作者身份回复用 reply_site_comment（两者都需先从这里拿到评论 id）。',
    parameters: {
      type: 'object',
      properties: {
        slug: {
          type: 'string',
          description: '目标站点标识（多站点用户必传；省略时：0 站返回引导、1 站直通、多站返回站点清单请用户指定）',
        },
        status: {
          type: 'string',
          enum: ['pending', 'approved', 'rejected', 'all'],
          description: '按审核状态筛选，默认 pending（待审核）',
        },
        articleId: { type: 'integer', description: '按文章 id 筛选（可选）' },
        page: { type: 'integer', description: '页码，从 1 起（默认 1）' },
        pageSize: { type: 'integer', description: `每页条数（默认 10，最多 ${AI_COMMENT_PAGE_MAX}）` },
      },
      additionalProperties: false,
    },
    perms: 'site:comment:audit',
    risk: 'read',
    handler: async (ctx, params) => {
      try {
        const target = await resolveToolSite(siteFacade, ctx.user.userId, params)
        if (!target.ok) return target.feed
        const statusKey = readStrParam(params, 'status') ?? 'pending'
        const auditStatus = COMMENT_STATUS_MAP[statusKey] ?? COMMENT_STATUS_MAP.pending
        const result = await siteFacade.listComments(BigInt(ctx.user.userId), target.site.id, {
          auditStatus,
          articleId: readNumParam(params, 'articleId'),
          pageNo: readNumParam(params, 'page') ?? 1,
          pageSize: readNumParam(params, 'pageSize'),
        })
        return {
          site: { slug: target.site.slug, title: target.site.title },
          filter: { status: statusKey, articleId: readNumParam(params, 'articleId') ?? null },
          total: result.total,
          pageNo: result.pageNo,
          pageSize: result.pageSize,
          comments: result.list.map(toModelItem),
        }
      } catch (e) {
        return feedSiteError(e)
      }
    },
  }
}

/** 审核批量工具入参校验共用的 id 数组安全取值 */
export function readCommentIds(params: Record<string, unknown>): number[] {
  const raw = params.ids
  if (!Array.isArray(raw)) return []
  const ids: number[] = []
  for (const item of raw) {
    const num = typeof item === 'number' ? item : typeof item === 'string' && /^\d+$/.test(item.trim()) ? Number(item.trim()) : NaN
    if (Number.isInteger(num) && num > 0) ids.push(num)
  }
  return [...new Set(ids)]
}

/** 审核动作 → 审核状态（approve 1 / reject 2） */
export function auditActionStatus(action: string | undefined): number {
  return action === 'reject' ? 2 : 1
}

/** 参数非法回喂（不抛栈） */
export function feedParamInvalid(message: string): unknown {
  return { ok: false, errorCode: ErrorCode.ParamInvalid, message }
}
