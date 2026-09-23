/** app 域 schema 常量（R88/R93，前后端同源口径的前端副本见 apps/web/src/views/app/utils/app-schema.ts） */

/** R88 字段类型七类 */
export const APP_FIELD_TYPES = [
  'text',
  'number',
  'datetime',
  'bool',
  'enum',
  'attachment',
  'ref',
] as const

export type AppFieldType = (typeof APP_FIELD_TYPES)[number]

/** 表名 / 字段名：小写字母开头，小写字母数字下划线（snake_case） */
export const NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/
/** 功能页 code：小写字母开头，小写字母数字连字符 */
export const PAGE_CODE_PATTERN = /^[a-z][a-z0-9-]{0,63}$/
/** 功能页 route：应用内相对路径（如 article / article/list） */
export const PAGE_ROUTE_PATTERN = /^[a-z0-9][a-z0-9-/]{0,63}$/
/** 应用 code：slug 化名称，可能带 "(n)" 冲突后缀 */
export const APP_CODE_PATTERN = /^[a-z0-9][a-z0-9-]{0,40}(\(\d{1,3}\))?$/

/** n:n 中间表两个 ref 字段名（固定，DataService 依赖） */
export const REL_FROM_FIELD = 'from_id'
export const REL_TO_FIELD = 'to_id'

/** 字段类型中文名（错误提示用） */
export const FIELD_TYPE_LABELS: Record<AppFieldType, string> = {
  text: '文本',
  number: '数字',
  datetime: '日期时间',
  bool: '布尔',
  enum: '枚举',
  attachment: '附件',
  ref: '关联',
}

export function isAppFieldType(value: unknown): value is AppFieldType {
  return typeof value === 'string' && (APP_FIELD_TYPES as readonly string[]).includes(value)
}
