import type { AppFacade } from '../../../app/facade/app-facade.service'
import type { AiTool } from '../tool.types'
import { feedAppError, readStr } from './app-error.util'

/**
 * 生成管理功能页（write，P11 T105）：按 purpose 选主表，生成 filterBar + table + form 三区块标准页，
 * 并自动挂到「应用中心 ▸ 应用 ▸ 功能页」菜单。
 */
export function createGenAdminPageTool(appFacade: AppFacade): AiTool {
  return {
    name: 'gen_admin_page',
    title: '生成管理页面',
    description:
      '为数据应用自动生成一个管理功能页（含筛选栏、数据表格、新建表单三区块），' +
      '并挂到「应用中心」菜单下。purpose 用一句话说明这个页面管什么（如「管理文章和栏目」），' +
      '平台据此从已建的表里选主表。若应用还没有表，先调 add_table。',
    parameters: {
      type: 'object',
      properties: {
        appCode: { type: 'string', description: '应用 code' },
        name: { type: 'string', description: '功能页名称（如「文章管理」，1~50 字）' },
        purpose: { type: 'string', description: '页面用途描述（据此选主表）' },
      },
      required: ['appCode', 'name', 'purpose'],
      additionalProperties: false,
    },
    risk: 'write',
    summarize: (params) =>
      `为应用 ${readStr(params, 'appCode')} 生成管理页面「${readStr(params, 'name')}」（用途：${readStr(params, 'purpose')}）`,
    handler: async (ctx, params) => {
      const appCode = readStr(params, 'appCode')
      const name = readStr(params, 'name')
      const purpose = readStr(params, 'purpose')
      if (!appCode || !name) {
        return { ok: false, errorCode: 40001, message: 'appCode / name 均为必填' }
      }
      try {
        return await appFacade.genAdminPage(BigInt(ctx.user.userId), appCode, name, purpose)
      } catch (e) {
        return feedAppError(e)
      }
    },
  }
}
