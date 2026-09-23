import { BusinessException } from '../../../../common/exceptions/business.exception'

/**
 * app 组工具公共整形/错误回喂（P11 T105）。
 *
 * 注意：本文件刻意**不叫 `*.tool.ts`**——check-ai-prompt.ts 会扫描 `tools/*.tool.ts` 提取
 * name/perms/risk，辅助文件若以 .tool.ts 结尾且无 name 字段会导致静态核查崩溃。
 */

/** 字段类型七类（R88；域边界纪律：ai 域不 import app 域常量，此处本地副本） */
export type AppFieldInputType = 'text' | 'number' | 'datetime' | 'bool' | 'enum' | 'attachment' | 'ref'

/** 工具入参中的字段定义（结构上与 app 域 FieldDefDto 兼容，直接透传） */
export interface AppFieldInput {
  name: string
  label: string
  type: AppFieldInputType
  required?: number
  default?: unknown
  enumOptions?: Array<{ value: string; label: string }>
  refTable?: string
  refMultiple?: number
}

const FIELD_TYPES: readonly string[] = [
  'text',
  'number',
  'datetime',
  'bool',
  'enum',
  'attachment',
  'ref',
]

/** 业务异常 → 回喂结构（非业务异常重新抛出，交由工具层统一失败处理） */
export function feedAppError(error: unknown): { ok: false; errorCode: number; message: string } {
  if (error instanceof BusinessException) {
    return { ok: false, errorCode: error.code, message: error.message }
  }
  throw error
}

/** 字符串入参整形 */
export function readStr(params: Record<string, unknown>, key: string): string {
  const value = params[key]
  return typeof value === 'string' ? value.trim() : ''
}

/** 字段定义数组整形（模型输出不可信）：非法项直接抛出可读原因，由 handler 回喂 */
export function readFields(params: Record<string, unknown>, key: string): AppFieldInput[] {
  const raw = params[key]
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new BusinessException(40001, `${key} 必须是非空数组`)
  }
  const fields: AppFieldInput[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      throw new BusinessException(40001, `${key} 的每一项都必须是对象`)
    }
    const row = item as Record<string, unknown>
    const name = typeof row.name === 'string' ? row.name.trim() : ''
    const label = typeof row.label === 'string' ? row.label.trim() : ''
    const type = typeof row.type === 'string' ? row.type : ''
    if (!name || !label || !type) {
      throw new BusinessException(40001, '字段定义需包含 name/label/type')
    }
    if (!FIELD_TYPES.includes(type)) {
      throw new BusinessException(40001, `字段类型非法：${type}（允许 ${FIELD_TYPES.join('/')}）`)
    }
    const field: AppFieldInput = { name, label, type: type as AppFieldInputType }
    if (row.required !== undefined) field.required = Number(row.required) === 1 ? 1 : 0
    if (row.default !== undefined) field.default = row.default
    if (Array.isArray(row.enumOptions)) {
      field.enumOptions = row.enumOptions
        .filter((option): option is Record<string, unknown> => Boolean(option) && typeof option === 'object')
        .map((option) => ({
          value: String(option.value ?? ''),
          label: String(option.label ?? option.value ?? ''),
        }))
        .filter((option) => option.value !== '')
    }
    if (typeof row.refTable === 'string') field.refTable = row.refTable.trim()
    if (row.refMultiple !== undefined) field.refMultiple = Number(row.refMultiple) === 1 ? 1 : 0
    fields.push(field)
  }
  return fields
}
