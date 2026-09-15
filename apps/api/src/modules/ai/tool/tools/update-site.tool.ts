import { ErrorCode } from '../../../../common/constants/error-code'
import type { SiteFacade } from '../../../site/facade/site-facade.service'
import type { AiTool } from '../tool.types'
import { feedSiteError } from './list-site-files.tool'
import { resolveToolSite } from './list-site-articles.tool'
import { readNumParam, readStrParam } from './tool-params'

/** 站点状态文案 */
function siteStatusText(status: number): string {
  return status === 1 ? '启用' : '停用'
}

/**
 * 更新站点（write，确认卡；D64 生命周期补齐）。
 * slug 必传（指定目标站点）；只传需要改的字段。改 slug / 停用都会立即影响访客访问，摘要中明示。
 */
export function createUpdateSiteTool(siteFacade: SiteFacade): AiTool {
  return {
    name: 'update_site',
    title: '修改站点信息',
    description:
      '修改当前用户某个站点的基本信息：title（标题）、description（描述）、newSlug（站点标识）、status（1 启用 / 0 停用）、commentAudit（评论审核开关：1 需审核 / 0 直过审）。' +
      '只传需要修改的字段，未传的保持不变。**改 newSlug 会导致旧访问地址立即全部失效**（新地址为 /api/open/{newSlug}/）；**status=0 停用后访客访问整站一律失败**（文件与文章都还在，可再启用）。' +
      '用户只想让站点暂时不可访问时，用 status=0（不要删站）；要删除站点请用 delete_site（不可恢复，需用户明确要求）。',
    parameters: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: '目标站点标识（必传，指定要修改哪个站点）' },
        title: { type: 'string', description: '新标题（1~50 字，可选）' },
        description: { type: 'string', description: '新描述（≤200 字，可选；传空串清空）' },
        newSlug: { type: 'string', description: '新站点标识（3~32 位小写字母/数字/连字符，非保留字且全局唯一；改动后旧地址立即失效）' },
        status: { type: 'integer', enum: [0, 1], description: '站点状态：1 启用 / 0 停用（停用后访客访问整站一律失败）' },
        commentAudit: { type: 'integer', enum: [0, 1], description: '评论审核开关：1 需审核后展示 / 0 提交即展示' },
      },
      required: ['slug'],
      additionalProperties: false,
    },
    perms: 'site:site:manage',
    risk: 'write',
    /** 确认卡摘要：站点标识 + 逐项变更 + 影响提示 */
    summarize: async (params, ctx) => {
      const title = readStrParam(params, 'title')
      const description = typeof params.description === 'string' ? params.description : undefined
      const newSlug = readStrParam(params, 'newSlug')
      const status = readNumParam(params, 'status')
      const commentAudit = readNumParam(params, 'commentAudit')
      if (
        title === undefined &&
        description === undefined &&
        newSlug === undefined &&
        status === undefined &&
        commentAudit === undefined
      ) {
        return null
      }
      try {
        const target = await resolveToolSite(siteFacade, ctx.user.userId, params)
        if (!target.ok) return null
        const lines = [`更新站点 ${target.site.slug}（${target.site.title}）：`]
        if (title !== undefined) lines.push(`标题 → ${title}`)
        if (description !== undefined) {
          lines.push(description === '' ? '描述 → 清空' : `描述 → ${description}`)
        }
        if (newSlug !== undefined) {
          lines.push(`站点标识 → ${newSlug}（⚠️ 旧地址 /api/open/${target.site.slug}/ 立即失效，新地址为 /api/open/${newSlug}/）`)
        }
        if (status !== undefined) {
          lines.push(
            `状态 → ${siteStatusText(status)}（当前：${siteStatusText(target.site.status)}）` +
              (status === 0 ? '——停用后访客访问整站一律失败（数据不删，可再启用）' : ''),
          )
        }
        if (commentAudit !== undefined) {
          lines.push(`评论审核 → ${commentAudit === 1 ? '开启（评论需审核后展示）' : '关闭（提交即展示）'}`)
        }
        return lines.join('\n')
      } catch {
        return null
      }
    },
    handler: async (ctx, params) => {
      const slug = readStrParam(params, 'slug')
      if (!slug) {
        return { ok: false, errorCode: ErrorCode.ParamInvalid, message: '请提供目标站点 slug' }
      }
      try {
        const target = await resolveToolSite(siteFacade, ctx.user.userId, params)
        if (!target.ok) return target.feed
        const description = typeof params.description === 'string' ? params.description : undefined
        const site = await siteFacade.updateSite(BigInt(ctx.user.userId), target.site.id, {
          title: readStrParam(params, 'title'),
          description,
          newSlug: readStrParam(params, 'newSlug'),
          status: readNumParam(params, 'status'),
          commentAudit: readNumParam(params, 'commentAudit'),
        })
        return {
          ok: true,
          site: {
            slug: site.slug,
            title: site.title,
            description: site.description,
            status: site.status,
            commentAudit: site.commentAudit,
            siteUrl: site.siteUrl,
          },
        }
      } catch (e) {
        return feedSiteError(e)
      }
    },
  }
}
