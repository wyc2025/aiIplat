import type { ResolvedTable } from '../schema/schema.types'

/**
 * 功能页 schema 生成器（P11 T104/T105，ARCHITECTURE-P11 §5）：
 * 按应用当前表结构生成标准管理页（filterBar + table + form 三区块 + 三动作），
 * 供 AI 工具 gen_admin_page / adjust_page 与人工「生成页面」共用。
 *
 * 契约（§5）：layout 区块绑定 dataSource 或 action；字段描述用字符串 DSL：
 * - filterBar：`字段:op`
 * - table 列：`字段` / `字段:expand:目标表`
 * - form 字段：`字段[:textarea|:enum|:attachment|:ref:目标表[:multiple]]`
 */

/** 动作命名约定（renderer 依此解析 rowActions edit/delete） */
export function actionName(op: 'create' | 'update' | 'delete', tableName: string): string {
  return `${op}_${tableName}`
}

/** 取表的「标签字段」：优先 text 字段，其次任意非 ref 字段 */
function labelField(table: ResolvedTable): string | null {
  const text = table.fields.find((field) => field.type === 'text')
  if (text) return text.name
  const first = table.fields.find((field) => field.type !== 'attachment' && !field.refMultiple)
  return first?.name ?? null
}

/** 生成单个表的标准管理页 schema（含 ref 下拉数据源） */
export function buildAdminPageSchema(
  tables: ResolvedTable[],
  main: ResolvedTable,
  title: string,
): Record<string, unknown> {
  const byName = new Map(tables.map((table) => [table.name, table]))
  const dataSources: Record<string, unknown> = {}
  const formFields: string[] = []
  const columnFields: string[] = []
  const filterFields: string[] = []

  const sortField = main.fields.find(
    (field) => field.type === 'datetime' || field.type === 'number' || field.type === 'text',
  )

  for (const field of main.fields) {
    // 列：单值 ref 展开目标标签
    if (field.type === 'ref' && !field.refMultiple && field.refTableName) {
      columnFields.push(`${field.name}:expand:${field.refTableName}`)
    } else {
      columnFields.push(field.name)
    }
    // 过滤：文本 contains / 枚举、布尔 eq
    if (field.type === 'text') filterFields.push(`${field.name}:contains`)
    else if (field.type === 'enum' || field.type === 'bool') filterFields.push(`${field.name}:eq`)

    // 表单字段
    if (field.type === 'attachment') formFields.push(`${field.name}:attachment`)
    else if (field.type === 'enum') formFields.push(`${field.name}:enum`)
    else if (field.type === 'ref' && field.refMultiple && field.refTableName) {
      formFields.push(`${field.name}:ref:${field.refTableName}:multiple`)
    } else if (field.type === 'ref' && field.refTableName) {
      formFields.push(`${field.name}:ref:${field.refTableName}`)
    } else formFields.push(field.name)

    // ref 目标的候选数据源（下拉/多选）
    if (field.type === 'ref' && field.refTableName) {
      const target = byName.get(field.refTableName)
      const label = target ? labelField(target) : null
      dataSources[`${field.name}_options`] = {
        op: 'list',
        table: field.refTableName,
        fields: ['rowId', ...(label ? [label] : [])],
        size: 100,
      }
    }
  }

  dataSources.mainList = {
    op: 'list',
    table: main.name,
    ...(sortField ? { sort: [{ f: sortField.name, dir: 'desc' }] } : {}),
    size: 20,
  }

  const createAction = actionName('create', main.name)
  return {
    kind: 'admin',
    layout: [
      { type: 'filterBar', bind: 'mainList', fields: filterFields },
      { type: 'table', bind: 'mainList', columns: columnFields, rowActions: ['edit', 'delete'] },
      { type: 'form', bind: createAction, title: `新建${main.label || title}`, fields: formFields, placement: 'dialog' },
    ],
    dataSources,
    actions: {
      [createAction]: { tx: false, steps: [{ op: 'create', table: main.name }] },
      [actionName('update', main.name)]: { tx: false, steps: [{ op: 'update', table: main.name }] },
      [actionName('delete', main.name)]: { tx: false, steps: [{ op: 'delete', table: main.name }] },
    },
  }
}

/**
 * 依 purpose 选主表：命中表名/显示名（含互相包含）优先，否则取第一个非系统表。
 * 「AI 选表」在本期落为**确定性关键词匹配**（purpose 由模型按用户意图填写）。
 */
export function pickMainTable(purpose: string, tables: ResolvedTable[]): ResolvedTable | null {
  const candidates = tables.filter((table) => !table.isSystem)
  if (candidates.length === 0) return null
  const text = (purpose || '').toLowerCase()
  if (!text) return candidates[0]
  const exact = candidates.find(
    (table) => text.includes(table.name.toLowerCase()) || text.includes(table.label.toLowerCase()),
  )
  if (exact) return exact
  const partial = candidates.find(
    (table) =>
      table.name.toLowerCase().includes(text) || table.label.toLowerCase().includes(text),
  )
  return partial ?? candidates[0]
}
