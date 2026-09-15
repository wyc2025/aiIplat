import { ErrorCode } from '../../../../common/constants/error-code'
import type { SiteFacade } from '../../../site/facade/site-facade.service'
import { countWordsR14 } from '../../../site/facade/site-facade.service'
import type { AiTool } from '../tool.types'
import { feedSiteError } from './list-site-files.tool'
import { articleStatusText, resolveToolSite } from './list-site-articles.tool'
import { readNumParam, readStrArrayParam, readStrParam } from './tool-params'

/**
 * 创建站点文章（write，确认卡）。
 * D63 代发语义：默认草稿；只有用户明示「直接发布」才带 status=1，
 * 且 status=1 时确认卡摘要必须带「发布即公开可见」警示行（R63）。
 * R65：columnId 归属校验（缺省时本站唯一栏目直达、否则回喂栏目清单）；tagNames 走 ensure 语义；
 * summary 留空由域内既有口径自动取正文前 100 字；字数由域内 R14 口径统计。
 */
export function createCreateSiteArticleTool(siteFacade: SiteFacade): AiTool {
  return {
    name: 'create_site_article',
    title: '创建站点文章',
    description:
      '为当前用户的个人站点**新建一篇文章**（CMS 文章）。' +
      '默认创建为**草稿**（status 省略或传 0，访客看不到）；只有在用户明确要求「直接发布/立即发布」时才传 status=1。' +
      'title 必填；contentMd 为 markdown 正文（≤20 万字符）；summary 省略时自动取正文前 100 字；' +
      'columnId 省略时：本站仅一个栏目则自动使用，否则会回喂栏目清单请你带上 columnId 重试（也可先用 ensure_site_column 创建栏目）；' +
      'tagNames 按名称给出，已存在的标签直接复用、不存在的自动创建。' +
      '注意：本工具建的是**文章（表驱动内容）**，不是站点文件；要改页面/样式请用 write_site_files。',
    parameters: {
      type: 'object',
      properties: {
        slug: {
          type: 'string',
          description: '目标站点标识（多站点用户必传；省略时：0 站返回引导、1 站直通、多站返回站点清单请用户指定）',
        },
        columnId: { type: 'integer', description: '栏目 id（省略时本站唯一栏目自动使用，多栏目会回喂清单请你指定）' },
        title: { type: 'string', description: '文章标题（1~100 字）' },
        contentMd: { type: 'string', description: 'markdown 正文（≤20 万字符）' },
        summary: { type: 'string', description: '摘要（≤200 字，省略时自动取正文前 100 字）' },
        tagNames: {
          type: 'array',
          items: { type: 'string' },
          description: '标签名称数组（≤20 个，名称 1~32 字；已存在的复用、不存在的自动创建）',
        },
        status: {
          type: 'integer',
          enum: [0, 1],
          description: '状态：0 草稿（默认，访客不可见）/ 1 发布（公开可见）——仅当用户明确要求直接发布时才传 1',
        },
      },
      required: ['title', 'contentMd'],
      additionalProperties: false,
    },
    perms: 'site:article:create',
    risk: 'write',
    /** 确认卡摘要（R63）：标题 / 栏目 / 标签 / 状态 / 字数（+ 发布警示行） */
    summarize: async (params, ctx) => {
      const title = readStrParam(params, 'title')
      const contentMd = typeof params.contentMd === 'string' ? params.contentMd : ''
      if (!title || !contentMd) return null
      const status = readNumParam(params, 'status') === 1 ? 1 : 0
      const tagNames = readStrArrayParam(params, 'tagNames')
      const columnId = readNumParam(params, 'columnId')

      try {
        const target = await resolveToolSite(siteFacade, ctx.user.userId, params)
        if (!target.ok) return null
        const lines: string[] = [`${status === 1 ? '新建并发布文章' : '新建文章（草稿）'}：`, `标题：${title}`]

        const columns = await siteFacade.listColumns(BigInt(ctx.user.userId), target.site.id)
        const column = columnId !== undefined ? columns.find((c) => c.id === String(columnId)) : undefined
        if (column) {
          lines.push(`栏目：${column.name}（id=${column.id}）`)
        } else if (columnId === undefined && columns.length === 1) {
          lines.push(`栏目：${columns[0].name}（自动：本站唯一栏目）`)
        } else if (columnId === undefined) {
          lines.push('栏目：未指定（执行时若本站存在多个栏目会要求先指定 columnId）')
        } else {
          lines.push(`栏目：id=${columnId}（未在本站栏目中找到，执行时会报错）`)
        }

        if (tagNames.length > 0) {
          lines.push(`标签：${tagNames.join('、')}（已存在的复用，不存在的自动创建）`)
        }
        lines.push(`字数：${countWordsR14(contentMd)}`)
        lines.push(`状态：${articleStatusText(status)}`)
        if (status === 1) {
          lines.push('⚠️ 发布即公开可见：保存后访客立即可通过站点访问该文章')
        }
        lines.push(`目标站点：${target.site.title}（${target.site.slug}）`)
        return lines.join('\n')
      } catch {
        return null
      }
    },
    handler: async (ctx, params) => {
      const title = readStrParam(params, 'title') ?? ''
      const contentMd = typeof params.contentMd === 'string' ? params.contentMd : ''
      if (!title || !contentMd) {
        return { ok: false, errorCode: ErrorCode.ParamInvalid, message: 'title 与 contentMd 均为必填' }
      }
      try {
        const target = await resolveToolSite(siteFacade, ctx.user.userId, params)
        if (!target.ok) return target.feed
        const article = await siteFacade.createArticle(BigInt(ctx.user.userId), target.site.id, {
          columnId: readNumParam(params, 'columnId'),
          title,
          contentMd,
          summary: readStrParam(params, 'summary'),
          tagNames: readStrArrayParam(params, 'tagNames'),
          status: readNumParam(params, 'status') === 1 ? 1 : 0,
        })
        return {
          ok: true,
          site: { slug: target.site.slug, title: target.site.title },
          id: article.id,
          title: article.title,
          columnId: article.columnId,
          columnName: article.columnName,
          tagNames: article.tagNames,
          status: article.status,
          wordCount: article.wordCount,
        }
      } catch (e) {
        return feedSiteError(e)
      }
    },
  }
}
