import type { AppFacade } from '../../../app/facade/app-facade.service'
import type { AiTool } from '../tool.types'
import { feedAppError, readStr } from './app-error.util'

/**
 * 确认数据应用入册（write，P11 T105）：draft → active，占 active 额度（上限 10），
 * 菜单即时出现（「应用中心 ▸ 应用 ▸ 功能页」）。
 */
export function createConfirmDataAppTool(appFacade: AppFacade): AiTool {
  return {
    name: 'confirm_data_app',
    title: '确认数据应用',
    description:
      '把数据应用草稿确认入册（draft → active，开始占正式额度，上限 10 个），' +
      '入册后应用与功能页立即出现在「应用中心」菜单。' +
      '应在用户明确同意后调用。草稿超过 7 天未确认会被自动清理。',
    parameters: {
      type: 'object',
      properties: {
        appCode: { type: 'string', description: '应用 code（create_data_app 返回）' },
      },
      required: ['appCode'],
      additionalProperties: false,
    },
    risk: 'write',
    summarize: (params) => `确认数据应用 ${readStr(params, 'appCode')} 入册（draft → active，占正式额度）`,
    handler: async (ctx, params) => {
      const appCode = readStr(params, 'appCode')
      if (!appCode) return { ok: false, errorCode: 40001, message: 'appCode 必填' }
      try {
        return await appFacade.confirmDataApp(BigInt(ctx.user.userId), appCode)
      } catch (e) {
        return feedAppError(e)
      }
    },
  }
}
