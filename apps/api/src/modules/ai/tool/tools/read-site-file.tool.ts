import type { SiteFacade } from '../../../site/facade/site-facade.service'
import type { AiTool } from '../tool.types'
import { feedSiteError, readSlugParam, resolveSiteForTool } from './list-site-files.tool'

/**
 * 读取我的站点文件（read，site:site:manage）。
 * 站点语义校验在 SiteFacade（非属主 40119 / 路径 40113 / 白名单 40114 / ≤64KB 40115 / 不存在 40400），
 * 异常统一转 { ok:false, errorCode, message } 回喂模型，不抛栈。
 */
export function createReadSiteFileTool(siteFacade: SiteFacade): AiTool {
  return {
    name: 'read_site_file',
    title: '读取我的站点文件',
    description:
      '读取当前用户自己的某个个人站点内的文本文件（站点根 = 云盘站点同名目录）。' +
      '多站点用户建议先询问用户目标站点 slug 或先 list_site_files，再传 slug 精确指定；单站点用户可省略 slug 直通。' +
      '改写站点前建议先 read_site_file("README.txt") 获取开放 API 契约；' +
      '若 README.txt 不存在（P4a 旧站点），按 PLATFORM-GUIDE 摘要保守操作。' +
      '仅支持文本文件（白名单扩展名，单文件 ≤64KB）。读取类调用尽量并行、一轮发出。',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '站点根相对路径，如 index.html、style.css、README.txt、pages/about.html',
        },
        slug: {
          type: 'string',
          description: '目标站点标识（多站点用户必传；省略时：0 站返回引导、1 站直通、多站返回站点清单请用户指定）',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
    perms: 'site:site:manage',
    risk: 'read',
    handler: async (ctx, params) => {
      const path = typeof params.path === 'string' ? params.path : ''
      try {
        const target = await resolveSiteForTool(siteFacade, ctx.user.userId, readSlugParam(params))
        if (target.kind === 'feed') return target.feed
        const r = await siteFacade.readFile(BigInt(ctx.user.userId), target.site.id, path)
        return { site: { slug: target.site.slug, title: target.site.title }, path: r.path, size: r.size, content: r.content }
      } catch (e) {
        return feedSiteError(e)
      }
    },
  }
}
