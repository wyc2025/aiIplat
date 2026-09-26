import type { MarketFacade } from '../../../market/facade/market-facade.service'
import type { AiTool } from '../tool.types'
import { feedAppError, readStr } from './app-error.util'

/**
 * 提交应用到市场审核（write，P13 T120 / R122 / D110）。
 *
 * 提交即物化结构快照（D107）：之后修改源应用不影响在架版本；同应用同时仅 1 个活跃条目（50013）；
 * 演示数据每表 ≤100 行（超限 50015，不静默截断）；审核通过后其他用户可一键复制。
 */
export function createSubmitMarketAppTool(marketFacade: MarketFacade): AiTool {
  return {
    name: 'submit_market_app',
    title: '提交应用市场审核',
    description:
      '把当前用户的一个数据应用提交到「应用市场」等待管理员审核。' +
      '提交那一刻会冻结应用的**结构快照**（表/字段/关系/功能页）：之后你再改源应用，不影响已提交的在架版本。' +
      '同一应用同时只允许 1 个待审或在架条目，重复提交返回 50013；' +
      'withDemoData=true 时把现有数据作为演示数据一并提交（**每表上限 100 行**，超出返回 50015；附件字段不随复制迁移，副本中为空）。' +
      '审核是人工的：提交后状态为 pending，通过后其他用户才能在市场看到并一键复制。提交前先用 list_data_apps 确认 appCode。',
    parameters: {
      type: 'object',
      properties: {
        appCode: { type: 'string', description: '应用 code（list_data_apps 返回的 appCode）' },
        withDemoData: {
          type: 'boolean',
          description: '是否附带现有数据作为演示数据（每表 ≤100 行；默认 false = 只分享结构）',
        },
      },
      required: ['appCode'],
      additionalProperties: false,
    },
    risk: 'write',
    summarize: (params) => {
      const appCode = readStr(params, 'appCode')
      const withDemo = params.withDemoData === true
      return [
        `把数据应用「${appCode}」提交到应用市场审核：`,
        `- 提交后进入人工审核队列（状态 pending），通过后其他用户可一键复制为自有应用`,
        `- 提交即冻结结构快照，之后修改源应用不影响该条目`,
        withDemo
          ? '- 附带演示数据（每表 ≤100 行；附件字段在副本中为空）'
          : '- 仅分享结构（不含任何数据）',
      ].join('\n')
    },
    handler: async (ctx, params) => {
      const appCode = readStr(params, 'appCode')
      if (!appCode) return { ok: false, errorCode: 40001, message: 'appCode 必填' }
      try {
        return await marketFacade.submitMarketApp(
          BigInt(ctx.user.userId),
          appCode,
          params.withDemoData === true,
        )
      } catch (e) {
        return feedAppError(e)
      }
    },
  }
}
