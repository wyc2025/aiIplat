import { BusinessException } from '../../../../common/exceptions/business.exception'
import type { MySiteInfo, SiteFacade } from '../../../site/facade/site-facade.service'
import type { AiTool } from '../tool.types'

/**
 * 业务异常 → 模型回喂对象（ok:false + 错误码 + 文案，不抛栈）。
 * 三件套共用口径：未开通 40101 / 路径 40113 / 白名单 40114 / 超限 40115 / 不存在 40400 /
 * 非属主 40119。
 */
export function feedSiteError(e: unknown): unknown {
  if (e instanceof BusinessException) {
    return { ok: false, errorCode: e.code, message: e.message }
  }
  throw e
}

/** 未开通站点的统一引导回喂（PRD F1：不抛给访客，模型转述；P4E 40101 语义收窄为仅「未开通」） */
export const NO_SITE_FEED = {
  ok: false,
  errorCode: 40101,
  message: '用户尚未开通个人网站，请引导其到「个人网站 → 站点列表」新建站点',
}

/** slug 参数安全取值（模型可能给出非字符串） */
export function readSlugParam(params: Record<string, unknown>): string | undefined {
  const raw = params.slug
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/** 站点解析结果（工具层）：命中站点 or 直接回喂给模型 */
export type ToolSiteTarget = { kind: 'feed'; feed: unknown } | { kind: 'site'; site: MySiteInfo }

/**
 * 解析目标站点（P4E R56/D55）——AI 三件套 slug 可选参数的统一入口：
 * - slug 提供 → 命中即用；查无 → 回喂 40119 + 用户现有站点列表（不暴露他人站点存在性）
 * - slug 省略 → 0 站回喂 40101 引导；1 站直通；多站回喂 `{ needSitePick, sites }` 请用户指定
 */
export async function resolveSiteForTool(
  siteFacade: SiteFacade,
  userId: string,
  slug: string | undefined,
): Promise<ToolSiteTarget> {
  const resolution = await siteFacade.resolveSite(BigInt(userId), slug)
  if (resolution.status === 'none') return { kind: 'feed', feed: NO_SITE_FEED }
  if (resolution.status === 'pick') {
    return {
      kind: 'feed',
      feed: {
        needSitePick: true,
        sites: resolution.sites,
        message:
          '该用户有多个站点，请先询问用户目标站点的 slug（或先调用 list_site_files 查看），再带上 slug 参数重试',
      },
    }
  }
  if (resolution.status === 'notfound') {
    return {
      kind: 'feed',
      feed: {
        ok: false,
        errorCode: 40119,
        message: '站点不存在或非属主（slug 只在你自己的站点中查找）',
        sites: resolution.sites,
      },
    }
  }
  return { kind: 'site', site: resolution.site }
}

/**
 * 列出我的站点文件树（read，site:site:manage）。
 * 管理侧语义（属主视角，不做公开性判定）；经 SiteFacade → CloudFacade.listSubtreeRaw。
 */
export function createListSiteFilesTool(siteFacade: SiteFacade): AiTool {
  return {
    name: 'list_site_files',
    title: '列出我的站点文件',
    description:
      '列出当前用户自己的某个个人站点的文件树（站点根 = 云盘站点同名目录，属主视角）。' +
      '返回站点信息与全部文件（相对路径/是否目录/大小/更新时间，最多 500 条）。' +
      '多站点用户建议先调用本工具（省略 slug 可列出站点清单）或直接询问用户目标站点 slug，再传 slug 精确指定；' +
      '单站点用户可省略 slug 直通。改写站点前建议先 read_site_file 读取现有文件（尤其 README.txt，内含开放 API 契约）。' +
      '用户未开通站点时返回引导信息。',
    parameters: {
      type: 'object',
      properties: {
        slug: {
          type: 'string',
          description: '目标站点标识（多站点用户必传；省略时：0 站返回引导、1 站直通、多站返回站点清单请用户指定）',
        },
      },
      additionalProperties: false,
    },
    perms: 'site:site:manage',
    risk: 'read',
    handler: async (ctx, params) => {
      try {
        const target = await resolveSiteForTool(siteFacade, ctx.user.userId, readSlugParam(params))
        if (target.kind === 'feed') return target.feed
        const result = await siteFacade.listFiles(BigInt(ctx.user.userId), target.site.id)
        return { site: result.site, files: result.files, truncated: result.truncated }
      } catch (e) {
        return feedSiteError(e)
      }
    },
  }
}
