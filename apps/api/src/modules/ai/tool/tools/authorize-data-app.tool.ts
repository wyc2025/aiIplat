import type { DisplayFacade } from '../../../display/facade/display-facade.service'
import type { AiTool } from '../tool.types'
import { feedDisplayError, readStr } from './display-error.util'

/**
 * 数据应用授权（write，P14 T130 / D114 / ARCHITECTURE §30.7 工具 43）。
 *
 * 授权两跳的第一跳（数据应用 → 展示应用）：授权后，该展示应用挂靠站点的展示页才能经
 * 同源路径 `/api/open/{slug}/api/app/{appCode}/...` 读取该应用的数据；未授权一律 40400。
 * displayId 取 `list_data_apps` 返回的展示应用清单（含 id / 名称 / 挂靠站点 / 已授权应用）。
 */
export function createAuthorizeDataAppTool(displayFacade: DisplayFacade): AiTool {
  return {
    name: 'authorize_data_app',
    title: '授权数据应用给展示应用',
    description:
      '把某个数据应用「授权」给一个展示应用（isGranted=false 则撤销授权）。授权后该展示应用挂靠的站点页' +
      '才能经同源路径 /api/open/{站点slug}/api/app/{appCode}/... 读取该应用的数据（只读）。' +
      'displayId 从 list_data_apps 的展示应用清单里取（形如 { id, name, siteSlug }）。' +
      '读取的完整前置：① 已授权（本工具）② 应用已发布 is_public=1（publish_data_app）' +
      '③ 表与字段已暴露（expose_data_app）④ 展示应用已挂靠站点。任一不满足 → 取数一律 40400。',
    parameters: {
      type: 'object',
      properties: {
        appCode: { type: 'string', description: '数据应用 code（list_data_apps 返回的 appCode）' },
        displayId: {
          type: 'string',
          description: '展示应用 id（list_data_apps 的展示应用清单里的 id）',
        },
        isGranted: {
          type: 'boolean',
          description: 'true = 授权（可读取）；false = 撤销授权',
        },
      },
      required: ['appCode', 'displayId', 'isGranted'],
      additionalProperties: false,
    },
    risk: 'write',
    summarize: (params) => {
      const appCode = readStr(params, 'appCode')
      const displayId = readStr(params, 'displayId')
      return params.isGranted === false
        ? `撤销数据应用「${appCode}」对展示应用 #${displayId} 的读取授权`
        : `授权数据应用「${appCode}」给展示应用 #${displayId}（站点页可只读读取）`
    },
    handler: async (ctx, params) => {
      const appCode = readStr(params, 'appCode')
      const displayId = readStr(params, 'displayId')
      if (!appCode || !displayId) {
        return { ok: false, errorCode: 40001, message: 'appCode 与 displayId 必填' }
      }
      if (!/^\d{1,20}$/.test(displayId)) {
        return { ok: false, errorCode: 40001, message: `displayId 必须是数字 id：${displayId}` }
      }
      if (typeof params.isGranted !== 'boolean') {
        return { ok: false, errorCode: 40001, message: 'isGranted 必须是布尔值（true/false）' }
      }
      try {
        const userId = BigInt(ctx.user.userId)
        if (!params.isGranted) {
          const revoked = await displayFacade.revokeDataApp(userId, BigInt(displayId), appCode)
          return {
            ok: true,
            appCode: revoked.appCode,
            displayId: revoked.displayId,
            isGranted: false,
          }
        }
        const granted = await displayFacade.grantDataApp(userId, BigInt(displayId), appCode)
        return {
          ok: true,
          appCode: granted.appCode,
          displayId: granted.displayId,
          isGranted: true,
          ...(granted.isPublic !== 1
            ? {
                hint: '该数据应用尚未发布（is_public=0）：授权已生效，但站点取数仍会 40400，请先 publish_data_app',
              }
            : {}),
        }
      } catch (e) {
        return feedDisplayError(e)
      }
    },
  }
}
