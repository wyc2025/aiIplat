import { ErrorCode } from '../../../common/constants/error-code'
import { BusinessException } from '../../../common/exceptions/business.exception'

/**
 * 功能页模式校验（P11 T104，R94 / ARCHITECTURE-P11 §5；P12 T111 扩展 display，R102 / ARCHITECTURE §28.4）。
 *
 * 校验双道中的后端一道：AI 生成或人工提交的 schema 落库前必须过校验，不过即 50004
 * （message 带路径），绝不静默丢弃。
 *
 * 实现说明（对增补文档的一处偏差）：文档写「zod/class-validator」，但 zod 非现有依赖，
 * 铁律 7 禁止新增依赖 → 这里用**手写结构校验**（纯函数、零依赖），能力等价：
 * 类型/必填/枚举/引用存在性 + 路径化错误信息。
 *
 * P12 增量（display kind，R102）：
 * - 区块仅 filterBar / table / detail（禁 form）；table 禁 rowActions；detail 必须绑 op=get；
 * - dataSources op 仅 list / get（禁 count）；actions 一律禁；
 * - 字段 DSL（`字段[:修饰符…]`）语法白名单 + 基础字段存在 + expand/ref 目标表存在；
 * - rowLink.page 必须指向同应用内**已存在**的页 code（ctx.pages）。
 * admin kind 行为与 P11 完全一致（零回归）。
 */

/** 区块四型 */
export const PAGE_BLOCK_TYPES = ['filterBar', 'table', 'form', 'detail'] as const
export type PageBlockType = (typeof PAGE_BLOCK_TYPES)[number]

/** 区块三型（display 只读子集：禁 form，R102） */
export const DISPLAY_BLOCK_TYPES = ['filterBar', 'table', 'detail'] as const

/** 页类型（P12 起支持 display） */
export const PAGE_KINDS = ['admin', 'display'] as const
export type PageKind = (typeof PAGE_KINDS)[number]

/** 数据源 op 白名单 */
export const PAGE_DATA_OPS = ['list', 'get', 'count'] as const
/** display 页数据源 op（R102：禁 count） */
export const DISPLAY_DATA_OPS = ['list', 'get'] as const
/** 动作步骤 op 白名单 */
export const PAGE_STEP_OPS = ['create', 'update', 'delete'] as const
/** filter op 白名单（与 DataService 一致） */
export const PAGE_FILTER_OPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'in'] as const
/** 字段 DSL 修饰符白名单（算子 + 附件/引用/多值/展开，P11 起沿用） */
export const DSL_MODIFIERS = [
  'eq',
  'ne',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'in',
  'expand',
  'ref',
  'attachment',
  'multiple',
] as const
/** 单页区块 / 数据源 / 动作上限（防爆） */
const MAX_BLOCKS = 20
const MAX_DATA_SOURCES = 20
const MAX_ACTIONS = 20
const MAX_STEPS = 10
/** 单数据源取数上限 */
const MAX_PAGE_SIZE = 100

/** 校验上下文：应用内表名 → 字段名集合；pages = 同应用内经 code 集合（display rowLink 校验用） */
export interface PageSchemaContext {
  tables: Map<string, Set<string>>
  /** 同应用内页 code 集合（可选：admin 页校验不需要） */
  pages?: Set<string>
}

function fail(path: string, message: string): never {
  throw new BusinessException(ErrorCode.AppPageSchemaInvalid, `页面模式校验失败（${path}）：${message}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertField(ctx: PageSchemaContext, table: string, field: string, path: string): void {
  // `rowId` 是行内置主键（非 app_field 定义列），渲染器与下拉候选数据源都要用 → 放行
  if (field === 'rowId') {
    if (!ctx.tables.has(table)) fail(path, `表不存在：${table}`)
    return
  }
  const fields = ctx.tables.get(table)
  if (!fields) fail(path, `表不存在：${table}`)
  if (!fields.has(field)) fail(path, `字段不存在：${table}.${field}`)
}

/** 字段 DSL 解析结果（`字段[:修饰符…]`） */
export interface FieldDsl {
  raw: string
  /** 基础字段名 */
  field: string
  /** 修饰符（按出现顺序；不含字段自身） */
  modifiers: string[]
}

/**
 * 解析字段 DSL（P11 起沿用：`title:contains` / `tag_ids:expand:tag` / `cover:attachment` /
 * `tag_ids:ref:tag:multiple`）。纯函数零依赖；是否严校由调用方按页类型决定
 * （admin 沿用 P11 宽松口径，display 按 R102 严校）。
 */
export function parseFieldDsl(raw: string): FieldDsl {
  const parts = raw.split(':')
  const field = (parts.shift() ?? '').trim()
  return { raw, field, modifiers: parts.map((part) => part.trim()).filter((part) => part.length > 0) }
}

/** 取 DSL 中被引用的目标表（expand / ref 后紧跟的非修饰符 token；无则 null） */
export function dslTargetTable(dsl: FieldDsl): string | null {
  const index = dsl.modifiers.findIndex((modifier) => modifier === 'expand' || modifier === 'ref')
  if (index < 0) return null
  const target = dsl.modifiers[index + 1]
  if (!target || (DSL_MODIFIERS as readonly string[]).includes(target)) return null
  return target
}

/** display 字段 DSL 严校（R102）：语法白名单 + 基础字段存在 + expand/ref 目标表存在 */
function assertFieldDsl(ctx: PageSchemaContext, table: string, raw: unknown, path: string): void {
  if (typeof raw !== 'string' || raw.trim().length === 0) fail(path, '字段 DSL 必须是非空字符串')
  const dsl = parseFieldDsl(raw)
  if (!dsl.field) fail(path, '字段 DSL 缺少字段名')
  for (const modifier of dsl.modifiers) {
    if (!(DSL_MODIFIERS as readonly string[]).includes(modifier)) fail(path, `未知 DSL 修饰符：${modifier}`)
  }
  assertField(ctx, table, dsl.field, path)
  const target = dslTargetTable(dsl)
  if (target && !ctx.tables.has(target)) fail(path, `目标表不存在：${target}`)
}

/** 取区块字段列表（columns / fields 两类命名，display 逐一严校） */
function blockFieldLists(
  block: Record<string, unknown>,
  path: string,
): Array<{ key: string; list: unknown[] }> {
  const out: Array<{ key: string; list: unknown[] }> = []
  for (const key of ['columns', 'fields'] as const) {
    const value = block[key]
    if (value === undefined) continue
    if (!Array.isArray(value)) fail(`${path}.${key}`, '必须是数组')
    out.push({ key, list: value })
  }
  return out
}

/**
 * 校验功能页 schema；通过返回规范化对象，失败抛 50004（带路径）。
 * kind=admin 走 P11 规则；kind=display 追加 R102 只读约束（见文件头注释）。
 */
export function validatePageSchema(schema: unknown, ctx: PageSchemaContext): Record<string, unknown> {
  if (!isRecord(schema)) fail('schema', '必须是对象')
  const kind = schema.kind
  if (kind !== 'admin' && kind !== 'display') {
    fail('schema.kind', `kind 仅允许 ${PAGE_KINDS.join(' / ')}`)
  }
  const isDisplay = kind === 'display'
  const dataOps: readonly string[] = isDisplay ? DISPLAY_DATA_OPS : PAGE_DATA_OPS

  const dataSources = schema.dataSources
  if (!isRecord(dataSources)) fail('dataSources', '必须是对象')
  const dsNames = Object.keys(dataSources)
  if (dsNames.length === 0) fail('dataSources', '至少 1 个数据源')
  if (dsNames.length > MAX_DATA_SOURCES) fail('dataSources', `数据源不能超过 ${MAX_DATA_SOURCES} 个`)

  for (const name of dsNames) {
    const path = `dataSources.${name}`
    const ds = dataSources[name]
    if (!isRecord(ds)) fail(path, '必须是对象')
    const op = ds.op
    if (typeof op !== 'string' || !dataOps.includes(op)) {
      fail(
        `${path}.op`,
        `op 仅允许 ${dataOps.join('/')}${isDisplay ? '（display 页禁 count，R102）' : ''}`,
      )
    }
    const table = ds.table
    if (typeof table !== 'string' || !ctx.tables.has(table)) {
      fail(`${path}.table`, `表不存在：${String(table)}`)
    }
    if (ds.size !== undefined) {
      if (typeof ds.size !== 'number' || !Number.isInteger(ds.size) || ds.size < 1 || ds.size > MAX_PAGE_SIZE) {
        fail(`${path}.size`, `size 需为 1~${MAX_PAGE_SIZE} 的整数`)
      }
    }
    if (ds.fields !== undefined) {
      if (!Array.isArray(ds.fields)) fail(`${path}.fields`, '必须是数组')
      for (const [index, field] of ds.fields.entries()) {
        if (typeof field !== 'string') fail(`${path}.fields[${index}]`, '必须是字符串')
        assertField(ctx, table as string, field as string, `${path}.fields[${index}]`)
      }
    }
    if (ds.filter !== undefined) {
      if (!Array.isArray(ds.filter)) fail(`${path}.filter`, '必须是数组')
      for (const [index, filter] of ds.filter.entries()) {
        const filterPath = `${path}.filter[${index}]`
        if (!isRecord(filter)) fail(filterPath, '必须是对象')
        if (typeof filter.f !== 'string') fail(`${filterPath}.f`, '必须是字段名')
        assertField(ctx, table as string, filter.f as string, `${filterPath}.f`)
        if (typeof filter.op !== 'string' || !(PAGE_FILTER_OPS as readonly string[]).includes(filter.op)) {
          fail(`${filterPath}.op`, `filter op 仅允许 ${PAGE_FILTER_OPS.join('/')}`)
        }
      }
    }
    if (ds.sort !== undefined) {
      if (!Array.isArray(ds.sort)) fail(`${path}.sort`, '必须是数组')
      for (const [index, sort] of ds.sort.entries()) {
        const sortPath = `${path}.sort[${index}]`
        if (!isRecord(sort)) fail(sortPath, '必须是对象')
        if (typeof sort.f !== 'string') fail(`${sortPath}.f`, '必须是字段名')
        assertField(ctx, table as string, sort.f as string, `${sortPath}.f`)
        if (sort.dir !== 'asc' && sort.dir !== 'desc') fail(`${sortPath}.dir`, "仅允许 'asc'/'desc'")
      }
    }
    if (ds.expand !== undefined) {
      if (!Array.isArray(ds.expand)) fail(`${path}.expand`, '必须是数组')
      for (const [index, expand] of ds.expand.entries()) {
        const expandPath = `${path}.expand[${index}]`
        if (!isRecord(expand)) fail(expandPath, '必须是对象')
        if (typeof expand.f !== 'string') fail(`${expandPath}.f`, '必须是字段名')
        assertField(ctx, table as string, expand.f as string, `${expandPath}.f`)
        if (expand.fields !== undefined) {
          if (!Array.isArray(expand.fields)) fail(`${expandPath}.fields`, '必须是数组')
          for (const [fieldIndex, field] of expand.fields.entries()) {
            if (typeof field !== 'string') fail(`${expandPath}.fields[${fieldIndex}]`, '必须是字符串')
          }
        }
      }
    }
  }

  const actions = schema.actions ?? {}
  if (!isRecord(actions)) fail('actions', '必须是对象')
  const actionNames = Object.keys(actions)
  if (isDisplay && actionNames.length > 0) fail('actions', 'display 页不允许定义动作（R102）')
  if (actionNames.length > MAX_ACTIONS) fail('actions', `动作不能超过 ${MAX_ACTIONS} 个`)
  for (const name of actionNames) {
    const path = `actions.${name}`
    const action = actions[name]
    if (!isRecord(action)) fail(path, '必须是对象')
    if (action.tx !== undefined && typeof action.tx !== 'boolean') fail(`${path}.tx`, '必须是布尔值')
    if (!Array.isArray(action.steps) || action.steps.length === 0) {
      fail(`${path}.steps`, 'steps 必须是非空数组')
    }
    if (action.steps.length > MAX_STEPS) fail(`${path}.steps`, `步骤不能超过 ${MAX_STEPS} 个`)
    for (const [index, step] of action.steps.entries()) {
      const stepPath = `${path}.steps[${index}]`
      if (!isRecord(step)) fail(stepPath, '必须是对象')
      if (typeof step.op !== 'string' || !(PAGE_STEP_OPS as readonly string[]).includes(step.op)) {
        fail(`${stepPath}.op`, `op 仅允许 ${PAGE_STEP_OPS.join('/')}`)
      }
      if (typeof step.table !== 'string' || !ctx.tables.has(step.table)) {
        fail(`${stepPath}.table`, `表不存在：${String(step.table)}`)
      }
    }
  }

  const layout = schema.layout
  if (!Array.isArray(layout) || layout.length === 0) fail('layout', 'layout 必须是非空数组')
  if (layout.length > MAX_BLOCKS) fail('layout', `区块不能超过 ${MAX_BLOCKS} 个`)
  for (const [index, block] of layout.entries()) {
    const path = `layout[${index}]`
    if (!isRecord(block)) fail(path, '必须是对象')
    if (typeof block.type !== 'string' || !(PAGE_BLOCK_TYPES as readonly string[]).includes(block.type)) {
      fail(`${path}.type`, `区块类型仅允许 ${PAGE_BLOCK_TYPES.join('/')}`)
    }
    if (isDisplay && !(DISPLAY_BLOCK_TYPES as readonly string[]).includes(block.type)) {
      fail(`${path}.type`, `display 页区块类型仅允许 ${DISPLAY_BLOCK_TYPES.join('/')}（禁 form，R102）`)
    }
    if (typeof block.bind !== 'string' || block.bind.length === 0) {
      fail(`${path}.bind`, 'bind 必须是非空字符串')
    }
    // form 区块展示形态（2026-09-30 新增）：inline = 内嵌区块；dialog = 表头「新建」弹窗（缺省）
    if (block.placement !== undefined) {
      if (block.type !== 'form') fail(`${path}.placement`, 'placement 仅 form 区块可用')
      if (block.placement !== 'inline' && block.placement !== 'dialog') {
        fail(`${path}.placement`, 'placement 仅允许 inline / dialog')
      }
    }
    if (block.type === 'form') {
      if (!actionNames.includes(block.bind)) fail(`${path}.bind`, `动作不存在：${block.bind}`)
    } else if (!dsNames.includes(block.bind)) {
      fail(`${path}.bind`, `数据源不存在：${block.bind}`)
    }

    if (!isDisplay) continue

    // ===== display 专属（R102）=====
    const boundDs = dataSources[block.bind]
    const boundTable = isRecord(boundDs) && typeof boundDs.table === 'string' ? boundDs.table : null
    if (block.type === 'table') {
      if (block.rowActions !== undefined) fail(`${path}.rowActions`, 'display 页表格不允许行内动作（R102）')
      if (block.rowLink !== undefined) {
        if (!isRecord(block.rowLink)) fail(`${path}.rowLink`, '必须是对象')
        const target = block.rowLink.page
        if (typeof target !== 'string' || target.length === 0) {
          fail(`${path}.rowLink.page`, '必须指定目标页 code')
        }
        if (ctx.pages && !ctx.pages.has(target as string)) {
          fail(`${path}.rowLink.page`, `目标页不存在：${target}`)
        }
        const rowIdParam = block.rowLink.rowIdParam
        if (rowIdParam !== undefined && (typeof rowIdParam !== 'string' || rowIdParam.length === 0)) {
          fail(`${path}.rowLink.rowIdParam`, '必须是非空字符串')
        }
      }
    }
    if (block.type === 'detail') {
      if (!boundTable || !isRecord(boundDs) || boundDs.op !== 'get') {
        fail(`${path}.bind`, 'detail 区块必须绑定 op=get 的数据源（R102）')
      }
    }
    if (boundTable) {
      for (const { key, list } of blockFieldLists(block, path)) {
        for (const [fieldIndex, field] of list.entries()) {
          assertFieldDsl(ctx, boundTable, field, `${path}.${key}[${fieldIndex}]`)
        }
      }
    }
  }

  return schema
}
