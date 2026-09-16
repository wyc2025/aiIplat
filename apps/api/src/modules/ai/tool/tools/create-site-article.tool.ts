import { ErrorCode } from '../../../../common/constants/error-code'
import type { SiteFacade } from '../../../site/facade/site-facade.service'
import { countWordsR14 } from '../../../site/facade/site-facade.service'
import type { AiTool } from '../tool.types'
import { feedSiteError } from './list-site-files.tool'
import { articleStatusText, resolveToolSite } from './list-site-articles.tool'
import { readNumArrayParam, readNumParam, readStrArrayParam, readStrParam } from './tool-params'

/**
 * 封面路径校验（P6 T79 / R72）：失败直接产出回喂对象（40105 + media/ 可用图片清单），
 * 由 create/update 文章工具共用；成功返回校验通过的规范化路径。
 */
export async function resolveCoverOrFeed(
  siteFacade: SiteFacade,
  userId: string,
  siteId: bigint,
  coverPath: string,
): Promise<{ ok: true; path: string } | { ok: false; feed: unknown }> {
  const result = await siteFacade.resolveCoverPath(BigInt(userId), siteId, coverPath)
  if (result.ok) return { ok: true, path: result.path }
  return {
    ok: false,
    feed: {
      ok: false,
      errorCode: result.errorCode,
      message: result.message,
      availableImages: result.availableImages,
      hint:
        result.availableImages.length > 0
          ? '请改用上述 media/ 下已有图片之一作为 coverPath 重试'
          : '该站点 media/ 下暂无图片，请先引导用户到「个人网站 → 文件管理」的 media/ 目录上传图片',
    },
  }
}

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
      'coverPath（可选）= 封面图，必须是本站站点云盘 media/ 目录下**已存在**的图片（如 media/covers/a.png，支持 png/jpg/jpeg/webp/gif）；' +
      '可先用 list_cloud_files { path: "media/" } 查看可用图片；路径非法或图片不存在会回喂 40105 并附该站 media/ 下可用图片清单。AI 无法上传图片，只能用已有图片。' +
      // P7 D73/R77：站点分档解析 —— 草稿免选站（入内容池），发布必须明确发表目标
      'siteIds（可选）= 发表目标站点 id 数组，可一次发表到多个站点；不传时用 slug 解析出的站点（或草稿场景不入任何站）。' +
      'status=1（发布）必须能确定发表站点：多站点用户请传 slug 或 siteIds，否则会回喂站点清单；status=0（草稿）可以完全不选站，只进内容池。' +
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
        coverPath: {
          type: 'string',
          description:
            '封面图：站点云盘 media/ 下**已有图片**的相对路径，如 media/covers/a.png（支持 png/jpg/jpeg/webp/gif）。AI 不能上传图片，请先用 list_cloud_files 查看 media/ 下的图片',
        },
        status: {
          type: 'integer',
          enum: [0, 1],
          description: '状态：0 草稿（默认，访客不可见）/ 1 发布（公开可见）——仅当用户明确要求直接发布时才传 1',
        },
        siteIds: {
          type: 'array',
          items: { type: 'integer' },
          description:
            '发表目标站点 id 数组（可多站；status=1 时必填其一：slug 或 siteIds）。空数组 = 只进内容池，不发表到任何站',
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
      const coverPath = readStrParam(params, 'coverPath')
      const siteIds = readNumArrayParam(params, 'siteIds')

      try {
        const resolved = await resolveToolSite(siteFacade, ctx.user.userId, params)
        // P7 R77 分档：草稿可完全不选站（只进内容池）；发布/带封面必须有明确站点
        const target = resolved.ok ? resolved.site : null
        if (!target && (status === 1 || !!coverPath)) return null
        const lines: string[] = [`${status === 1 ? '新建并发布文章' : '新建文章（草稿）'}：`, `标题：${title}`]

        const columns = await siteFacade.listColumns(BigInt(ctx.user.userId))
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
        if (coverPath && target) {
          // R72：执行前先解析封面，让用户在确认卡上就看到「图是否存在」
          const cover = await siteFacade.resolveCoverPath(BigInt(ctx.user.userId), target.id, coverPath)
          if (cover.ok) {
            lines.push(`封面：${cover.path}`)
          } else {
            const hint = cover.availableImages.slice(0, 3).join('、')
            lines.push(`封面：${coverPath}（⚠️ ${cover.message}${hint ? `；可用图片：${hint}` : ''}）`)
          }
        }
        lines.push(`字数：${countWordsR14(contentMd)}`)
        lines.push(`状态：${articleStatusText(status)}`)
        if (status === 1) {
          lines.push('⚠️ 发布即公开可见：保存后访客立即可通过站点访问该文章')
        }
        // P7 D73：发表目标（多站可一次发表）
        if (siteIds && siteIds.length > 0) {
          const sites = await siteFacade.getSites(BigInt(ctx.user.userId))
          const names = siteIds.map((id) => sites.find((s) => Number(s.id) === id)?.title ?? `id=${id}`)
          lines.push(`发表站点：${names.join('、')}`)
        } else if (siteIds && siteIds.length === 0) {
          lines.push('发表站点：无（仅入内容池，随时可再发表）')
        } else if (target) {
          lines.push(`发表站点：${target.title}（${target.slug}）`)
        }
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
      const siteIds = readNumArrayParam(params, 'siteIds')
      const status = readNumParam(params, 'status') === 1 ? 1 : 0
      try {
        const resolved = await resolveToolSite(siteFacade, ctx.user.userId, params)
        // P7 R77 分档：草稿可免选站；发布 / 带封面 / 显式 siteIds 时必须能确定站点
        if (!resolved.ok && (status === 1 || !!readStrParam(params, 'coverPath') || (siteIds?.length ?? 0) > 0)) {
          return resolved.feed
        }
        const target = resolved.ok ? resolved.site : null
        // R72：封面通道（media/ 前缀 + 真实图片存在性校验，失败回喂 40105 + 可用图片清单）
        const coverInput = readStrParam(params, 'coverPath')
        let coverPath: string | undefined
        if (coverInput && target) {
          const cover = await resolveCoverOrFeed(siteFacade, ctx.user.userId, target.id, coverInput)
          if (!cover.ok) return cover.feed
          coverPath = cover.path
        }
        const primarySiteId = siteIds?.[0] !== undefined ? BigInt(siteIds[0]) : target ? BigInt(target.id) : undefined
        const article = await siteFacade.createArticle(BigInt(ctx.user.userId), primarySiteId, {
          columnId: readNumParam(params, 'columnId'),
          title,
          contentMd,
          summary: readStrParam(params, 'summary'),
          tagNames: readStrArrayParam(params, 'tagNames'),
          status,
          coverPath,
        })
        // 显式 siteIds：整体替换发表集合（多站一次发表）
        let result = article
        if (siteIds && siteIds.length > 0) {
          await siteFacade.setArticleSites(
            BigInt(ctx.user.userId),
            BigInt(article.id),
            siteIds.map((siteId) => ({ siteId })),
          )
          result = await siteFacade.readArticle(BigInt(ctx.user.userId), BigInt(article.id))
        }
        return {
          ok: true,
          site: target ? { slug: target.slug, title: target.title } : undefined,
          id: result.id,
          title: result.title,
          columnId: result.columnId,
          columnName: result.columnName,
          /** P7 D73：已发表站点 */
          sites: result.sites,
          tagNames: result.tagNames,
          coverPath: result.coverPath,
          status: result.status,
          wordCount: result.wordCount,
        }
      } catch (e) {
        return feedSiteError(e)
      }
    },
  }
}
