import type { AppFacade } from '../../../app/facade/app-facade.service'
import type { AiTool } from '../tool.types'
import { feedAppError, readFields, readStr } from './app-error.util'

/**
 * 给已有表加字段（write，P11 T105）。字段定义口径与 add_table 一致；
 * 字段名表内唯一，已软删的字段名不可复用。
 */
export function createAddFieldsTool(appFacade: AppFacade): AiTool {
  return {
    name: 'add_fields',
    title: '新增字段',
    description:
      '给已有逻辑表增加字段（类型与约束同 add_table）。字段名在表内唯一；' +
      '加字段随时允许（增量结构变更，不影响历史数据）。',
    parameters: {
      type: 'object',
      properties: {
        appCode: { type: 'string', description: '应用 code' },
        table: { type: 'string', description: '逻辑表名' },
        fields: {
          type: 'array',
          description: '要新增的字段定义数组（至少 1 个）',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              label: { type: 'string' },
              type: {
                type: 'string',
                enum: ['text', 'number', 'datetime', 'bool', 'enum', 'attachment', 'ref'],
              },
              required: { type: 'number', description: '是否必填（1/0）' },
              enumOptions: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { value: { type: 'string' }, label: { type: 'string' } },
                  required: ['value'],
                },
              },
              refTable: { type: 'string', description: 'ref 目标表名' },
            },
            required: ['name', 'label', 'type'],
          },
        },
      },
      required: ['appCode', 'table', 'fields'],
      additionalProperties: false,
    },
    risk: 'write',
    summarize: (params) => {
      const raw = params.fields
      const names = Array.isArray(raw)
        ? raw
            .map((item) => (item && typeof item === 'object' ? String((item as { name?: unknown }).name ?? '') : ''))
            .filter(Boolean)
            .join('、')
        : ''
      return `给表 ${readStr(params, 'table')} 增加字段：${names || '（未指定）'}`
    },
    handler: async (ctx, params) => {
      const appCode = readStr(params, 'appCode')
      const table = readStr(params, 'table')
      if (!appCode || !table) {
        return { ok: false, errorCode: 40001, message: 'appCode / table 均为必填' }
      }
      try {
        const fields = readFields(params, 'fields')
        return await appFacade.addFields(BigInt(ctx.user.userId), appCode, table, fields)
      } catch (e) {
        return feedAppError(e)
      }
    },
  }
}
