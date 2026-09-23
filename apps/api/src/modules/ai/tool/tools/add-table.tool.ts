import type { AppFacade } from '../../../app/facade/app-facade.service'
import type { AiTool } from '../tool.types'
import { feedAppError, readFields, readStr } from './app-error.util'

/**
 * 新建逻辑表（write，P11 T105）：含初始字段；字段 type=ref 时自动建 1n 关联字段（refTable 填目标表名）。
 * 多对多（多值 ref）请改用 set_relation（需自动生成中间表）。
 */
export function createAddTableTool(appFacade: AppFacade): AiTool {
  return {
    name: 'add_table',
    title: '新建数据表',
    description:
      '为数据应用新建一张逻辑表（含字段定义）。字段类型：text/number/datetime/bool/enum/attachment/ref；' +
      'enum 必须给 enumOptions；ref 必须给 refTable（目标表名，表示多对一）。' +
      '表名与字段名用小写字母开头、仅小写字母/数字/下划线；单应用最多 20 张表。' +
      '多对多关系请改用 set_relation（会自动生成中间表）。',
    parameters: {
      type: 'object',
      properties: {
        appCode: { type: 'string', description: '应用 code（create_data_app 返回）' },
        table: { type: 'string', description: '表名（如 article）' },
        label: { type: 'string', description: '表显示名（如 文章）' },
        fields: {
          type: 'array',
          description: '字段定义数组（至少 1 个）',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: '字段名（如 title）' },
              label: { type: 'string', description: '字段显示名（如 标题）' },
              type: {
                type: 'string',
                enum: ['text', 'number', 'datetime', 'bool', 'enum', 'attachment', 'ref'],
              },
              required: { type: 'number', description: '是否必填（1/0，默认 0）' },
              enumOptions: {
                type: 'array',
                description: 'enum 选项 [{ value, label }]',
                items: {
                  type: 'object',
                  properties: {
                    value: { type: 'string' },
                    label: { type: 'string' },
                  },
                  required: ['value'],
                },
              },
              refTable: { type: 'string', description: 'ref 目标表名' },
            },
            required: ['name', 'label', 'type'],
          },
        },
      },
      required: ['appCode', 'table', 'label', 'fields'],
      additionalProperties: false,
    },
    risk: 'write',
    summarize: (params) => {
      const table = readStr(params, 'table')
      const label = readStr(params, 'label')
      const raw = params.fields
      const count = Array.isArray(raw) ? raw.length : 0
      return `在应用 ${readStr(params, 'appCode')} 新建表 ${table}（${label}），共 ${count} 个字段`
    },
    handler: async (ctx, params) => {
      const appCode = readStr(params, 'appCode')
      const table = readStr(params, 'table')
      const label = readStr(params, 'label')
      if (!appCode || !table || !label) {
        return { ok: false, errorCode: 40001, message: 'appCode / table / label 均为必填' }
      }
      try {
        const fields = readFields(params, 'fields')
        return await appFacade.addTable(BigInt(ctx.user.userId), appCode, { table, label, fields })
      } catch (e) {
        return feedAppError(e)
      }
    },
  }
}
