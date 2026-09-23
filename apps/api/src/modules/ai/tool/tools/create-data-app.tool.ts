import type { AppFacade } from '../../../app/facade/app-facade.service'
import type { AiTool } from '../tool.types'
import { feedAppError, readStr } from './app-error.util'

/**
 * 创建数据应用草稿（write，P11 T105，API-P11 §4）。
 * 属主自服务（perms 留空），返回 appCode 供后续 add_table / gen_admin_page / confirm_data_app 引用（P9 T92 教训）。
 * draft 不占 active 额度（限 3 个）；用户确认后调 confirm_data_app 入册。
 */
export function createCreateDataAppTool(appFacade: AppFacade): AiTool {
  return {
    name: 'create_data_app',
    title: '创建数据应用',
    description:
      '创建一个「数据应用」草稿（不占正式额度，最多 3 个草稿）。' +
      '数据应用 = 自定义逻辑表 + 字段 + 关系，并自动生成管理后台功能页。' +
      '调用前先向用户确认应用名称与用途（如需可追问 1~2 轮），创建后用返回的 appCode 继续加表/加关系/生成页面，' +
      '最后必须调 confirm_data_app 由用户确认入册，否则草稿 7 天后自动清理。',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: '应用名称（1~50 字，如「书单」「库存管理」）',
        },
        description: {
          type: 'string',
          description: '应用用途描述（≤200 字，可选）',
        },
      },
      required: ['name'],
      additionalProperties: false,
    },
    risk: 'write',
    summarize: (params) => {
      const name = readStr(params, 'name')
      return `创建数据应用草稿「${name}」（不占正式额度，确认后入册）`
    },
    handler: async (ctx, params) => {
      const name = readStr(params, 'name')
      if (!name) return { ok: false, errorCode: 40001, message: '应用名称必填' }
      const description = readStr(params, 'description') || undefined
      try {
        return await appFacade.createAppDraft(BigInt(ctx.user.userId), name, description)
      } catch (e) {
        return feedAppError(e)
      }
    },
  }
}
