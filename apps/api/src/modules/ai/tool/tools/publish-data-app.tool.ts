import type { AppFacade } from '../../../app/facade/app-facade.service'
import type { AiTool } from '../tool.types'
import { feedAppError, readStr } from './app-error.util'

/**
 * 发布数据应用（write，P13 T120 / R122 / D110；P14 T126 口径修订）。
 *
 * P14 D115：`is_public` 语义 = 「**可被授权读取的总开关**」——不再产出匿名公开链接（pub_code 停止消费），
 * 开启后仍须经展示应用授权（`authorize_data_app`）且站点页走同源取数面才可读。
 * 开启时走发布校验（≥1 张已暴露表）；未过校验**不抛错**，回喂 `{ ok:false, missing[] }`
 * 让模型按缺项引导用户先 expose（闭环：R110）。关闭即时失效取数面缓存。
 */
export function createPublishDataAppTool(appFacade: AppFacade): AiTool {
  return {
    name: 'publish_data_app',
    title: '发布数据应用（可被授权读取）',
    description:
      '开启或关闭数据应用的「可被授权读取」总开关（isPublic）。开启后该应用的数据才能被展示应用（挂靠站点的静态展示页）' +
      '经授权读取；关闭即时失效（站点取数一律 40400）。开启前至少需要 1 张已暴露的表，条件不满足时本工具返回 ok:false 与 ' +
      'missing（缺项清单）：**不要重试同一个调用**，按缺项调用 expose_data_app 补齐后再重试。' +
      '读取的完整前置链：本开关开启 + authorize_data_app 已授权给某展示应用 + 该展示应用已挂靠站点 + 表/字段已暴露。' +
      '调用前先用 list_data_apps 查看 isPublic 与 missing（已开启的应用无需再开）。',
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
        ? `开启数据应用「${appCode}」的发布：授权给展示应用后，站点展示页可只读读取其数据`
        : `关闭数据应用「${appCode}」的发布：站点取数立即失效（一律 40400）`
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
