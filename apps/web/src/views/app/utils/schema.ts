import type { AppFieldType, AppTableItem, DataRowView } from '@/types/api'

/**
 * app 域前端同源常量与 schema 解析（P11 T106，ARCHITECTURE-P11 §6）：
 * 字段类型七类 / 区块字段 DSL 解析 / 单元格展示——与后端 schema.constants.ts、page.builder.ts 同口径。
 * 真正的校验链在后端（R94），此处副本仅用于渲染与提示。
 */

/** R88 字段类型七类（含中文名） */
export const FIELD_TYPE_LABELS: Record<AppFieldType, string> = {
  text: '文本',
  number: '数字',
  datetime: '日期时间',
  bool: '布尔',
  enum: '枚举',
  attachment: '附件',
  ref: '关联',
}

export const FIELD_TYPES: AppFieldType[] = [
  'text',
  'number',
  'datetime',
  'bool',
  'enum',
  'attachment',
  'ref',
]

/** 区块字段 DSL 解析结果 */
export interface FieldSpec {
  name: string
  /** textarea / enum / attachment / ref / expand / 过滤 op */
  modifier?: string
  /** ref 目标表名 */
  target?: string
  multiple?: boolean
}

/** 解析 `name[:modifier[:target[:multiple]]]`（filterBar 用 `name:op`） */
export function parseFieldSpec(spec: string): FieldSpec {
  const parts = spec.split(':')
  const [name, modifier, target, extra] = parts
  return {
    name,
    modifier,
    target,
    multiple: extra === 'multiple' || modifier === 'multiple',
  }
}

/** 表名 → 表定义 */
export function tableMap(tables: AppTableItem[]): Map<string, AppTableItem> {
  return new Map(tables.map((table) => [table.name, table]))
}

/** 按字段名取字段定义（跨表：遍历所有表） */
export function findField(tables: AppTableItem[], fieldName: string) {
  for (const table of tables) {
    const hit = table.fields.find((field) => field.name === fieldName)
    if (hit) return hit
  }
  return undefined
}

/** 单元格展示（列 DSL：`name` 或 `name:expand:目标字段`） */
export function displayCell(
  row: DataRowView,
  spec: string,
  tables: AppTableItem[],
): string {
  const parsed = parseFieldSpec(spec)
  const value = row.data[parsed.name]
  if (parsed.modifier === 'expand') {
    const expanded = row.expanded?.[parsed.name] as
      | Record<string, unknown>
      | Array<Record<string, unknown>>
      | undefined
    const target = parsed.target
    if (Array.isArray(expanded)) {
      return expanded
        .map((item) => String(target ? (item?.[target] ?? item?.rowId ?? '') : (item?.rowId ?? '')))
        .join('、')
    }
    if (expanded && typeof expanded === 'object') {
      return String(target ? (expanded[target] ?? expanded.rowId ?? '') : (expanded.rowId ?? ''))
    }
    return Array.isArray(value) ? value.join('、') : ''
  }
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (Array.isArray(value)) return value.join('、')
  const field = findField(tables, parsed.name)
  if (field?.type === 'enum') {
    const option = field.enumOptions?.find((item) => item.value === String(value))
    return option?.label ?? String(value)
  }
  if (field?.type === 'datetime') {
    const date = new Date(String(value))
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString()
  }
  return String(value)
}

/** 功能页 schema 模板（人工建页 / AI 不可用时的兜底，结构与后端 page.builder 一致） */
export function pageSchemaTemplate(table: string, label: string): Record<string, unknown> {
  return {
    kind: 'admin',
    layout: [
      { type: 'filterBar', bind: 'mainList', fields: [] },
      {
        type: 'table',
        bind: 'mainList',
        columns: [],
        rowActions: ['edit', 'delete'],
      },
      // 新建表单默认走弹窗（2026-09-30）：渲染为表头「新建」按钮，与「编辑」体验一致
      { type: 'form', bind: `create_${table}`, title: `新建${label}`, fields: [], placement: 'dialog' },
    ],
    dataSources: { mainList: { op: 'list', table, size: 20 } },
    actions: {
      [`create_${table}`]: { tx: false, steps: [{ op: 'create', table }] },
      [`update_${table}`]: { tx: false, steps: [{ op: 'update', table }] },
      [`delete_${table}`]: { tx: false, steps: [{ op: 'delete', table }] },
    },
  }
}

/**
 * 公开展示页 schema 模板（P12 T113 / R102）：只读三区块（filterBar + table，可自行加 detail），
 * 无动作、无 form、dataSources 仅 list/get —— 与后端 display 校验规则一致，可直接保存。
 * 详情页与 rowLink 可在编辑器里补：detail 区块须绑 op=get 数据源，rowLink.page 指向同应用页 code。
 */
export function displayPageSchemaTemplate(table: string): Record<string, unknown> {
  return {
    kind: 'display',
    dataSources: { mainList: { op: 'list', table, size: 20 } },
    actions: {},
    layout: [
      { type: 'filterBar', bind: 'mainList', fields: [] },
      { type: 'table', bind: 'mainList', columns: [] },
    ],
  }
}
