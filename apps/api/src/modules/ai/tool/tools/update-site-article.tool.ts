import { ErrorCode } from '../../../../common/constants/error-code'
import type { SiteFacade } from '../../../site/facade/site-facade.service'
import { countWordsR14 } from '../../../site/facade/site-facade.service'
import type { AiTool } from '../tool.types'
import { feedSiteError } from './list-site-files.tool'
import { articleIdParam, articleStatusText, resolveToolSite } from './list-site-articles.tool'
import { resolveCoverOrFeed } from './create-site-article.tool'
import { readNumParam, readStrArrayParam, readStrParam } from './tool-params'

/**
 * 更新站点文章（write，确认卡；D63 允许更新已有文章）。
 * 部分更新：只传需要改的字段；tagNames 提供即整体替换（ensure 语义）。
 * 本期不提供删除文章工具（R7 物理删除不可恢复，D63）。
 */
export function createUpdateSiteArticleTool(siteFacade: SiteFacade): AiTool {
  return {
    name: 'update_site_article',
    title: '更新站点文章',
    description:
      '更新当前用户某篇已有文章：可改 title（标题）、contentMd（正文）、columnId（所属栏目）、summary（摘要）、tagNames（标签，**提供即整体替换**）、coverPath（封面图）。' +
      'coverPath 必须是本站站点云盘 media/ 目录下**已存在**的图片（如 media/covers/a.png，支持 png/jpg/jpeg/webp/gif），可先用 list_cloud_files { path: "media/" } 查看；**传空字符串表示清除封面**。' +
      '只传需要修改的字段，未传的字段保持不变；改正文时字数与摘要会按平台既有口径重新计算（summary 传空串表示按新正文自动生成）。' +
      'id 需先通过 list_site_articles 获取，改写前建议先 read_site_article 读取现有内容。' +
      '**平台不提供删除文章的工具**（文章删除不可恢复）；若用户要下架文章，请用 publish_site_article 把状态改成 0。',
    parameters: {
      type: 'object',
      properties: {
        slug: {
          type: 'string',
          description: '目标站点标识（多站点用户必传；省略时：0 站返回引导、1 站直通、多站返回站点清单请用户指定）',
        },
        id: { type: 'integer', description: '文章 id（从 list_site_articles 获取）' },
        title: { type: 'string', description: '新标题（1~100 字，可选）' },
        contentMd: { type: 'string', description: '新正文 markdown（≤20 万字符，可选）' },
        columnId: { type: 'integer', description: '新的栏目 id（可选，须为本站栏目）' },
        summary: { type: 'string', description: '新摘要（≤200 字；传空串表示按新正文自动生成，可选）' },
        tagNames: {
          type: 'array',
          items: { type: 'string' },
          description: '新标签名称数组（≤20 个；提供即整体替换，已存在的复用、不存在的自动创建）',
        },
        coverPath: {
          type: 'string',
          description:
            '新封面：站点云盘 media/ 下**已有图片**的相对路径（如 media/covers/a.png）；传空字符串 = 清除封面',
        },
      },
      required: ['id'],
      additionalProperties: false,
    },
    perms: 'site:article:update',
    risk: 'write',
    /** 确认卡摘要（R63）：文章标识 + 逐项变更字段 */
    summarize: async (params, ctx) => {
      const id = articleIdParam(params)
      if (id === null) return null
      const title = readStrParam(params, 'title')
      const contentMd = typeof params.contentMd === 'string' ? params.contentMd : undefined
      const summary = typeof params.summary === 'string' ? params.summary : undefined
      const columnId = readNumParam(params, 'columnId')
      const tagNamesProvided = Array.isArray(params.tagNames)
      const tagNames = readStrArrayParam(params, 'tagNames')
      const coverProvided = typeof params.coverPath === 'string'
      const coverPath = coverProvided ? (params.coverPath as string).trim() : ''
      const changes: string[] = []
      if (title) changes.push(`标题 → ${title}`)
      if (contentMd !== undefined) changes.push(`正文 → 重写（${countWordsR14(contentMd)} 字）`)
      if (summary !== undefined) {
        changes.push(summary === '' ? '摘要 → 按新正文自动生成' : `摘要 → ${summary}`)
      }
      if (tagNamesProvided) {
        changes.push(
          tagNames.length > 0
            ? `标签 → ${tagNames.join('、')}（整体替换，不存在的自动创建）`
            : '标签 → 清空全部标签',
        )
      }
      if (changes.length === 0 && columnId === undefined && !coverProvided) return null

      try {
        const target = await resolveToolSite(siteFacade, ctx.user.userId, params)
        if (!target.ok) return null
        const article = await siteFacade.readArticle(BigInt(ctx.user.userId), BigInt(id))
        if (article.siteId !== target.site.id.toString()) return null
        const lines = [
          `更新文章《${article.title}》（id=${id}，当前：${articleStatusText(article.status)}）：`,
          ...changes,
        ]
        if (coverProvided) {
          if (coverPath === '') {
            lines.push(`封面 → 清除当前封面（当前：${article.coverPath ?? '无'}）`)
          } else {
            // R72：执行前先解析封面，让用户在确认卡上就看到「图是否存在」
            const cover = await siteFacade.resolveCoverPath(BigInt(ctx.user.userId), target.site.id, coverPath)
            if (cover.ok) {
              lines.push(`封面 → ${cover.path}`)
            } else {
              const hint = cover.availableImages.slice(0, 3).join('、')
              lines.push(`封面 → ${coverPath}（⚠️ ${cover.message}${hint ? `；可用图片：${hint}` : ''}）`)
            }
          }
        }
        if (columnId !== undefined) {
          const columns = await siteFacade.listColumns(BigInt(ctx.user.userId), target.site.id)
          const column = columns.find((c) => c.id === String(columnId))
          lines.push(`栏目 → ${column ? `${column.name}（id=${column.id}）` : `id=${columnId}（未在本站栏目中找到，执行时会报错）`}`)
        }
        if (changes.length === 0) lines.push('（仅调整栏目，其余字段不变）')
        lines.push('未列出的字段保持不变；文章状态与发布时间不受本操作影响')
        lines.push(`目标站点：${target.site.title}（${target.site.slug}）`)
        return lines.join('\n')
      } catch {
        return null
      }
    },
    handler: async (ctx, params) => {
      const id = articleIdParam(params)
      if (id === null) {
        return { ok: false, errorCode: ErrorCode.ParamInvalid, message: '请提供文章 id（可用 list_site_articles 获取）' }
      }
      const contentMd = typeof params.contentMd === 'string' ? params.contentMd : undefined
      const summary = typeof params.summary === 'string' ? params.summary : undefined
      try {
        const target = await resolveToolSite(siteFacade, ctx.user.userId, params)
        if (!target.ok) return target.feed
        // R72：封面通道（空串 = 清除封面；非空则校验 media/ 前缀 + 真实图片，失败回喂 40105 + 可用清单）
        const coverInput = typeof params.coverPath === 'string' ? params.coverPath.trim() : undefined
        let coverPath: string | undefined
        if (coverInput !== undefined && coverInput !== '') {
          const cover = await resolveCoverOrFeed(siteFacade, ctx.user.userId, target.site.id, coverInput)
          if (!cover.ok) return cover.feed
          coverPath = cover.path
        } else if (coverInput === '') {
          coverPath = ''
        }
        const article = await siteFacade.updateArticle(BigInt(ctx.user.userId), BigInt(id), {
          title: readStrParam(params, 'title'),
          contentMd,
          columnId: readNumParam(params, 'columnId'),
          summary,
          tagNames: Array.isArray(params.tagNames) ? readStrArrayParam(params, 'tagNames') : undefined,
          coverPath,
        })
        return {
          ok: true,
          site: { slug: target.site.slug, title: target.site.title },
          id: article.id,
          title: article.title,
          columnName: article.columnName,
          tagNames: article.tagNames,
          coverPath: article.coverPath,
          status: article.status,
          wordCount: article.wordCount,
        }
      } catch (e) {
        return feedSiteError(e)
      }
    },
  }
}
