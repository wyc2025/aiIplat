import { ErrorCode } from '../../../common/constants/error-code'
import { BusinessException } from '../../../common/exceptions/business.exception'
import {
  NAME_PATTERN,
  SNAPSHOT_FIELD_TYPES,
  SNAPSHOT_VERSION,
  type AppSnapshot,
  type SnapshotField,
  type SnapshotPage,
  type SnapshotRel,
  type SnapshotTable,
} from './snapshot'

/**
 * 快照序列化 / 反序列化与结构校验（P13 ARCH §29.6「快照 JSON 入出库均过校验，防手改库致物化炸」）。
 *
 * 纪律：**零新依赖手写校验**（照 P11 先例：zod 非本仓依赖，铁律 7 禁新增）；
 * 校验失败一律 **50015**（快照结构非法），不静默修补（ARCH §29.3）。
 */

/** 逻辑名（表名/字段名）本地正则（与 app 域 NAME_PATTERN 语义一致；域内独立维护，不跨域 import） */
function fail(message: string): never {
  throw new BusinessException(ErrorCode.MarketSubmitInvalid, `快照结构非法：${message}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(source: Record<string, unknown>, key: string, where: string): string {
  const value = source[key]
  if (typeof value !== 'string' || value.trim() === '') fail(`${where} 缺少 ${key}`)
  return value
}

function readName(source: Record<string, unknown>, key: string, where: string): string {
  const value = readString(source, key, where)
  if (!NAME_PATTERN.test(value) || value.length > 64) fail(`${where} 的 ${key} 不是合法标识：${value}`)
  return value
}

function parseEnumOptions(raw: unknown, where: string): Array<{ value: string; label: string }> | null {
  if (raw === null || raw === undefined) return null
  if (!Array.isArray(raw) || raw.length === 0) fail(`${where} 的 enumOptions 必须是非空数组`)
  return raw.map((item, index) => {
    if (!isRecord(item)) fail(`${where} 的 enumOptions[${index}] 不是对象`)
    const value = item.value
    const label = item.label
    if (typeof value !== 'string' || typeof label !== 'string') {
      fail(`${where} 的 enumOptions[${index}] 需含字符串 value/label`)
    }
    return { value, label }
  })
}

function parseField(raw: unknown, where: string, tableName: string): SnapshotField {
  if (!isRecord(raw)) fail(`${where} 的字段不是对象`)
  const name = readName(raw, 'name', where)
  const label = readString(raw, 'label', where)
  const type = readString(raw, 'type', where)
  if (!SNAPSHOT_FIELD_TYPES.includes(type)) {
    fail(`${where}.${name} 字段类型不在白名单内：${type}`)
  }
  const refTableRaw = raw.refTable
  const refTable =
    refTableRaw === null || refTableRaw === undefined
      ? null
      : typeof refTableRaw === 'string' && refTableRaw.trim() !== ''
        ? refTableRaw
        : fail(`${where}.${name} 的 refTable 非法`)
  const refMultiple = raw.refMultiple === true
  if (type === 'ref' && !refTable) fail(`${where}.${name} 是 ref 字段但缺少 refTable`)
  if (type !== 'ref' && refTable) fail(`${where}.${name} 非 ref 字段却带 refTable`)
  if (refMultiple && type !== 'ref') fail(`${where}.${name} refMultiple 仅允许 ref 字段`)
  if (refTable === tableName) fail(`${where}.${name} 不允许自关联`)
  const enumOptions = parseEnumOptions(raw.enumOptions, `${where}.${name}`)
  if (type === 'enum' && !enumOptions) fail(`${where}.${name} 是 enum 字段但缺少 enumOptions`)
  return {
    name,
    label,
    type,
    required: raw.required === true,
    default: raw.default ?? null,
    enumOptions,
    refTable,
    refMultiple,
  }
}

function parseTable(raw: unknown, index: number): SnapshotTable {
  if (!isRecord(raw)) fail(`tables[${index}] 不是对象`)
  const where = `tables[${index}]`
  const name = readName(raw, 'name', where)
  const label = readString(raw, 'label', where)
  const fieldsRaw = raw.fields
  if (!Array.isArray(fieldsRaw)) fail(`${where} 的 fields 必须是数组`)
  const fields = fieldsRaw.map((field, fieldIndex) =>
    parseField(field, `${where}.fields[${fieldIndex}]`, name),
  )
  const seen = new Set<string>()
  for (const field of fields) {
    if (seen.has(field.name)) fail(`${where} 字段名重复：${field.name}`)
    seen.add(field.name)
  }
  return { name, label, fields }
}

function parseRel(raw: unknown, index: number, tableNames: Set<string>, fieldOf: Map<string, Set<string>>): SnapshotRel {
  if (!isRecord(raw)) fail(`rels[${index}] 不是对象`)
  const where = `rels[${index}]`
  const fromTable = readName(raw, 'fromTable', where)
  const fromField = readName(raw, 'fromField', where)
  const toTable = readName(raw, 'toTable', where)
  if (!tableNames.has(fromTable)) fail(`${where} 的 fromTable 不存在：${fromTable}`)
  if (!tableNames.has(toTable)) fail(`${where} 的 toTable 不存在：${toTable}`)
  if (!fieldOf.get(fromTable)?.has(fromField)) {
    fail(`${where} 的 fromField 不存在：${fromTable}.${fromField}`)
  }
  if (fromTable === toTable) fail(`${where} 不支持自关联`)
  return { fromTable, fromField, toTable }
}

function parsePage(raw: unknown, index: number): SnapshotPage {
  if (!isRecord(raw)) fail(`pages[${index}] 不是对象`)
  const where = `pages[${index}]`
  const name = readString(raw, 'name', where)
  const route = readString(raw, 'route', where)
  const kind = typeof raw.kind === 'string' && raw.kind !== '' ? raw.kind : 'admin'
  const genBy = typeof raw.genBy === 'string' && raw.genBy !== '' ? raw.genBy : 'manual'
  const sort = typeof raw.sort === 'number' && Number.isFinite(raw.sort) ? raw.sort : 0
  if (!isRecord(raw.schema)) fail(`${where} 的 schema 必须是对象`)
  return { name, route, kind, genBy, sort, schema: raw.schema }
}

/**
 * 出库/入库反序列化（DB JSON → 快照对象）。结构非法 → 50015（不静默修补）。
 * 额外交叉校验（ARCH §29.3「缺表缺字段 → 语义拒绝」）：
 * - 表名唯一；rels 引用的表与 fromField 均存在；
 * - 每个 refMultiple 字段必须有对应 rel（否则物化方无从重建中间表）。
 */
export function parseSnapshot(raw: unknown): AppSnapshot {
  if (!isRecord(raw)) fail('快照不是对象')
  if (raw.version !== SNAPSHOT_VERSION) {
    fail(`快照版本不支持：${String(raw.version)}（当前 ${SNAPSHOT_VERSION}）`)
  }
  const tablesRaw = raw.tables
  if (!Array.isArray(tablesRaw)) fail('tables 必须是数组')
  const tables = tablesRaw.map((table, index) => parseTable(table, index))
  const tableNames = new Set<string>()
  for (const table of tables) {
    if (tableNames.has(table.name)) fail(`表名重复：${table.name}`)
    tableNames.add(table.name)
  }
  const fieldOf = new Map<string, Set<string>>(
    tables.map((table) => [table.name, new Set(table.fields.map((field) => field.name))]),
  )

  const relsRaw = raw.rels
  if (!Array.isArray(relsRaw)) fail('rels 必须是数组')
  const rels = relsRaw.map((rel, index) => parseRel(rel, index, tableNames, fieldOf))

  /** refMultiple 字段 ↔ rel 双向对齐（物化方按 rels 重建中间表） */
  for (const table of tables) {
    for (const field of table.fields) {
      if (!field.refMultiple) continue
      const matched = rels.some(
        (rel) => rel.fromTable === table.name && rel.fromField === field.name && rel.toTable === field.refTable,
      )
      if (!matched) {
        fail(`多值关联字段缺少关系定义：${table.name}.${field.name}`)
      }
    }
  }
  for (const rel of rels) {
    const owner = tables.find((table) => table.name === rel.fromTable)
    const field = owner?.fields.find((item) => item.name === rel.fromField)
    if (!field?.refMultiple) {
      fail(`关系未对应多值关联字段：${rel.fromTable}.${rel.fromField}`)
    }
  }

  const pagesRaw = raw.pages
  if (!Array.isArray(pagesRaw)) fail('pages 必须是数组')
  const pages = pagesRaw.map((page, index) => parsePage(page, index))
  const routes = new Set<string>()
  for (const page of pages) {
    if (routes.has(page.route)) fail(`功能页路由重复：${page.route}`)
    routes.add(page.route)
  }

  return { version: SNAPSHOT_VERSION, tables, rels, pages }
}

/** 入库序列化（快照对象 → JSON 字符串；用于体积护栏与落库） */
export function serializeSnapshot(snapshot: AppSnapshot): string {
  return JSON.stringify(snapshot)
}

/** 快照体积护栏（R117 表：256KB；超出 50015） */
export function assertSnapshotSize(snapshot: AppSnapshot, maxBytes: number): void {
  const bytes = Buffer.byteLength(serializeSnapshot(snapshot), 'utf8')
  if (bytes > maxBytes) {
    fail(`快照体积超限（${bytes} 字节 > ${maxBytes} 字节）`)
  }
}

/** 演示数据行（R118；rowId 为源行标识，复制时重映射引用） */
export interface DemoRow {
  rowId: string
  data: Record<string, unknown>
}

/** 演示数据反序列化（DB JSON → { 表名: 行[] }），结构非法 → 50015 */
export function parseDemoData(raw: unknown): Record<string, DemoRow[]> {
  if (!isRecord(raw)) fail('演示数据不是对象')
  const result: Record<string, DemoRow[]> = {}
  for (const [tableName, rows] of Object.entries(raw)) {
    if (!NAME_PATTERN.test(tableName)) fail(`演示数据表名非法：${tableName}`)
    if (!Array.isArray(rows)) fail(`演示数据 ${tableName} 不是数组`)
    result[tableName] = rows.map((row, index) => {
      if (!isRecord(row)) fail(`演示数据 ${tableName}[${index}] 不是对象`)
      const rowId = row.rowId
      if (typeof rowId !== 'string' || rowId === '') fail(`演示数据 ${tableName}[${index}] 缺少 rowId`)
      if (!isRecord(row.data)) fail(`演示数据 ${tableName}[${index}] 的 data 不是对象`)
      return { rowId, data: row.data }
    })
  }
  return result
}
