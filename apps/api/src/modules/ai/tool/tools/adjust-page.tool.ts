import type { AppFacade } from '../../../app/facade/app-facade.service'
import type { AiTool } from '../tool.types'
import { feedAppError, readStr } from './app-error.util'

/**
 * 调整功能页（write，P11 T105）。
 * 本期口径：按应用**当前表结构**重建页面区块（新增/删除字段自动反映到表格与表单）；
 * 自由文本 instruction 仅作为意图说明，不解析为结构化指令（精细调整走前端功能页编辑器，R97）。
 */
export function createAdjustPageTool(appFacade: AppFacade): AiTool {
  return {
    name: 'adjust_page',
    title: '调整功能页面',
    description:
      '按应用最新的表结构刷新已有功能页的区块（表格列、表单字段、下拉数据源都会同步）。' +
      '用于加/删字段后让页面跟上结构。若用户需要更精细的页面定制（区块顺序、自定义筛选等），' +
      '请告知改用「应用中心 → 功能页编辑器」手工调整。',
    parameters: {
      type: 'object',
      properties: {
        appCode: { type: 'string', description: '应用 code' },
        pageCode: { type: 'string', description: '功能页 code（gen_admin_page 返回）' },
        instruction: { type: 'string', description: '调整意图（一句话说明，如「加上评分列」）' },
      },
      required: ['appCode', 'pageCode', 'instruction'],
      additionalProperties: false,
    },
    risk: 'write',
    summarize: (params) =>
      `刷新功能页 ${readStr(params, 'pageCode')}（按最新表结构；意图：${readStr(params, 'instruction')}）`,
    handler: async (ctx, params) => {
      const appCode = readStr(params, 'appCode')
      const pageCode = readStr(params, 'pageCode')
      const instruction = readStr(params, 'instruction')
      if (!appCode || !pageCode) {
        return { ok: false, errorCode: 40001, message: 'appCode / pageCode 均为必填' }
      }
      try {
        return await appFacade.adjustPage(BigInt(ctx.user.userId), appCode, pageCode, instruction)
      } catch (e) {
        return feedAppError(e)
      }
    },
  }
}
