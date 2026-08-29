import { BusinessException } from '../../../../common/exceptions/business.exception'
import type { SiteFacade } from '../../../site/facade/site-facade.service'
import type { AiTool } from '../tool.types'

/**
 * 业务异常 → 模型回喂对象（ok:false + 错误码 + 文案，不抛栈）。
 * 三件套共用口径：未开通 40101 / 路径 40113 / 白名单 40114 / 超限 40115 / 不存在 40400。
 */
export function feedSiteError(e: unknown): unknown {
  if (e instanceof BusinessException) {
    return { ok: false, errorCode: e.code, message: e.message }
  }
  throw e
}

/** 未开通站点的统一引导回喂（PRD F1：不抛给访客，模型转述） */
export const NO_SITE_FEED = {
  ok: false,
  errorCode: 40101,
  message: '用户尚未开通个人网站，请引导其到「个人网站 → 站点设置」创建',
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
      '列出当前用户自己的个人站点文件树（站点根 = 云盘「我的站点」目录，属主视角）。' +
      '返回站点信息与全部文件（相对路径/是否目录/大小/更新时间，最多 500 条）。' +
      '改写站点前建议先 read_site_file 读取现有文件（尤其 README.txt，内含开放 API 契约）。' +
      '用户未开通站点时返回引导信息。',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    perms: 'site:site:manage',
    risk: 'read',
    handler: async (ctx) => {
      try {
        const result = await siteFacade.listFiles(BigInt(ctx.user.userId))
        if (!result) return NO_SITE_FEED
        return { site: result.site, files: result.files, truncated: result.truncated }
      } catch (e) {
        return feedSiteError(e)
      }
    },
  }
}
