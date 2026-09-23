import type { AppFacade } from '../../../app/facade/app-facade.service'
import type { AiTool } from '../tool.types'
import { feedAppError, readStr } from './app-error.util'

/**
 * 建多对多关系（write，P11 T105）：平台自动生成中间表（isSystem，用户不可见）。
 * 幂等：同一 (fromTable, fromField, toTable) 重复调用返回现存关系。
 */
export function createSetRelationTool(appFacade: AppFacade): AiTool {
  return {
    name: 'set_relation',
    title: '新建多对多关系',
    description:
      '在两张表之间建立「多对多」关系（平台自动生成中间的关联表）。' +
      'fromField 是源表上的关联字段名（不存在则自动创建为多值 ref）。' +
      '多对一（1n）不需要本工具：建表时给字段 type=ref + refTable 即可。幂等，可重复调用。',
    parameters: {
      type: 'object',
      properties: {
        appCode: { type: 'string', description: '应用 code' },
        fromTable: { type: 'string', description: '源表名（如 article）' },
        fromField: { type: 'string', description: '源表上的关联字段名（如 tag_ids）' },
        toTable: { type: 'string', description: '目标表名（如 tag）' },
      },
      required: ['appCode', 'fromTable', 'fromField', 'toTable'],
      additionalProperties: false,
    },
    risk: 'write',
    summarize: (params) =>
      `建立多对多：${readStr(params, 'fromTable')}.${readStr(params, 'fromField')} ↔ ${readStr(params, 'toTable')}（自动生成中间表）`,
    handler: async (ctx, params) => {
      const appCode = readStr(params, 'appCode')
      const fromTable = readStr(params, 'fromTable')
      const fromField = readStr(params, 'fromField')
      const toTable = readStr(params, 'toTable')
      if (!appCode || !fromTable || !fromField || !toTable) {
        return { ok: false, errorCode: 40001, message: 'appCode / fromTable / fromField / toTable 均为必填' }
      }
      try {
        return await appFacade.setRelation(
          BigInt(ctx.user.userId),
          appCode,
          fromTable,
          fromField,
          toTable,
        )
      } catch (e) {
        return feedAppError(e)
      }
    },
  }
}
