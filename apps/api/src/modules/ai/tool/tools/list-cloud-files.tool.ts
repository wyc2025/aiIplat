import { BusinessException } from '../../../../common/exceptions/business.exception'
import type { CloudFacade } from '../../../cloud/facade/cloud-facade.service'
import type { AiTool } from '../tool.types'
import { readStrParam } from './tool-params'

/**
 * 云盘系列工具共用 helper 宿主（P5 T72，照 P4b 站点三件套把 helper 放首个工具文件的先例）。
 * 工具永远薄：只做参数透传 + 结果回喂，校验/记账/语义全部在 CloudFacade（D66/R63）。
 * 入参整形 helper 统一在 tool-params.ts（云盘/CMS/生命周期三类工具共用）。
 */

/** 业务异常 → 模型回喂对象（ok:false + 错误码 + 文案，不抛栈；与站点工具同口径） */
export function feedCloudError(e: unknown): unknown {
  if (e instanceof BusinessException) {
    return { ok: false, errorCode: e.code, message: e.message }
  }
  throw e
}

/**
 * 列出我的云盘文件（read，自动执行）。
 * description 边界纪律（R63）：站点目录也在云盘内，操作站点内容必须点明优先 site 系列工具，
 * 25 个工具并存下靠 description 防误选。
 */
export function createListCloudFilesTool(cloudFacade: CloudFacade): AiTool {
  return {
    name: 'list_cloud_files',
    title: '列出我的云盘文件',
    description:
      '列出当前用户云盘（「云盘 → 我的文件」）的目录内容。path 为相对云盘根的路径（如空=根目录、docs、photos/2024）；默认只列一层，recursive=true 时列出有界子树（最多 10 层 / 500 条，超出时 truncated=true）。' +
      '返回每个条目的名称、相对路径 path、是否目录、大小、扩展名、修改时间、是否位于站点目录内（inSite），以及配额用量（quota.used / quota.limit）。' +
      '注意：个人站点的目录（目录名 = 站点标识 slug）也在云盘内，列表里会标 inSite=true。**查看或修改站点内容（index.html / style.css / 文章配套文件等）请优先用 site 系列工具**（list_site_files / read_site_file / write_site_files，它们按站点根寻址并校验站点属主）；本工具只用于站点之外的云盘文件管理。',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '目录的相对路径（相对云盘根），如 docs、photos/2024；省略或空串 = 云盘根目录',
        },
        recursive: {
          type: 'boolean',
          description: '是否列出整棵子树（默认 false 只列当前一层；true 为有界递归，最多 10 层 / 500 条）',
        },
      },
      additionalProperties: false,
    },
    perms: 'cloud:file:list',
    risk: 'read',
    handler: async (ctx, params) => {
      try {
        const result = await cloudFacade.listUserFiles(BigInt(ctx.user.userId), {
          path: readStrParam(params, 'path'),
          recursive: params.recursive === true,
        })
        return result
      } catch (e) {
        return feedCloudError(e)
      }
    },
  }
}
