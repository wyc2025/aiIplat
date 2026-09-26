import type { AppFacade } from '../../../app/facade/app-facade.service'
import type { AiTool } from '../tool.types'
import { feedAppError, readStr } from './app-error.util'

/**
 * 公开发布数据应用（write，P13 T120 / R122 / D110，覆盖 P12-PATCH2 的 D106 写工具缺口）。
 *
 * 行为：开启时走 R103 校验（≥1 张已暴露表 + ≥1 个已公开 display 页 + 公开页数据源字段全暴露）；
 * 未过校验**不抛错**，回喂 `{ ok:false, missing[] }` 让模型按缺项引导用户先 expose（闭环：R110）。
 * 关闭即时失效公开端（pubCode 失效，缓存 DEL 由 app 域负责）。
 */
export function createPublishDataAppTool(appFacade: AppFacade): AiTool {
  return {
    name: 'publish_data_app',
    title: '公开发布数据应用',
    description:
      '开启或关闭一个数据应用的「公开发布」开关（isPublic）。开启后该应用的公开链接与公开只读接口对**匿名访客**可用；' +
      '关闭即时失效（pubCode 立即不可访问）。开启前必须先满足公开条件：至少 1 张已暴露的表、至少 1 个已公开展示页（display）、' +
      '且公开页数据源与区块字段引用的表和字段全部已暴露。' +
      '若条件不满足，本工具返回 ok:false 与 missing（缺项清单）：**不要重试同一个调用**，按缺项逐项调用 expose_data_app 补齐后再重试。' +
      '调用前先用 list_data_apps 查看应用的 isPublic 与 missing（已公开的应用无需再开）。',
    parameters: {
      type: 'object',
      properties: {
        appCode: { type: 'string', description: '应用 code（list_data_apps 返回的 appCode）' },
        isPublic: {
          type: 'boolean',
          description: 'true = 公开发布（匿名可访问）；false = 取消公开（即时失效）',
        },
      },
      required: ['appCode', 'isPublic'],
      additionalProperties: false,
    },
    risk: 'write',
    summarize: (params) => {
      const appCode = readStr(params, 'appCode')
      const isPublic = params.isPublic === true
      return isPublic
        ? `开启数据应用「${appCode}」的公开发布：公开链接与公开只读接口将对匿名访客可访问`
        : `关闭数据应用「${appCode}」的公开发布：公开链接与公开只读接口立即失效`
    },
    handler: async (ctx, params) => {
      const appCode = readStr(params, 'appCode')
      if (!appCode) return { ok: false, errorCode: 40001, message: 'appCode 必填' }
      if (typeof params.isPublic !== 'boolean') {
        return { ok: false, errorCode: 40001, message: 'isPublic 必须是布尔值（true/false）' }
      }
      try {
        return await appFacade.setPublic(BigInt(ctx.user.userId), appCode, params.isPublic ? 1 : 0)
      } catch (e) {
        return feedAppError(e)
      }
    },
  }
}
