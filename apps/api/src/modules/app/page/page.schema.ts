import { ErrorCode } from '../../../common/constants/error-code'
import { BusinessException } from '../../../common/exceptions/business.exception'

/**
 * 功能页模式校验（P11 T104，R94 / ARCHITECTURE-P11 §5）。
 *
 * 校验双道中的后端一道：AI 生成或人工提交的 schema 落库前必须过校验，不过即 50004
 * （message 带路径），绝不静默丢弃。
 *
 * 实现说明（对增补文档的一处偏差）：文档写「zod/class-validator」，但 zod 非现有依赖，
 * 铁律 7 禁止新增依赖 → 这里用**手写结构校验**（纯函数、零依赖），能力等价：
 * 类型/必填/枚举/引用存在性 + 路径化错误信息。
 */

/** 区块四型 */
export const PAGE_BLOCK_TYPES = ['filterBar', 'table', 'form', 'detail'] as const
export type PageBlockType = (typeof PAGE_BLOCK_TYPES)[number]

/** 数据源 op 白名单 */
export const PAGE_DATA_OPS = ['list', 'get', 'count'] as const
/** 动作步骤 op 白名单 */
export const PAGE_STEP_OPS = ['create', 'update', 'delete'] as const
/** filter op 白名单（与 DataService 一致） */
export const PAGE_FILTER_OPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'in'] as const
/** 单页区块 / 数据源 / 动作上限（防爆） */
const MAX_BLOCKS = 20
const MAX_DATA_SOURCES = 20
const MAX_ACTIONS = 20
const MAX_STEPS = 10
/** 单数据源取数上限 */
const MAX_PAGE_SIZE = 100

/** 校验上下文：应用内表名 → 字段名集合 */
export interface PageSchemaContext {
  tables: Map<string, Set<string>>
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

/**
 * 校验功能页 schema；通过返回规范化对象，失败抛 50004（带路径）。
 */
export function validatePageSchema(schema: unknown, ctx: PageSchemaContext): Record<string, unknown> {
  if (!isRecord(schema)) fail('schema', '必须是对象')
  if (schema.kind !== 'admin') fail('schema.kind', "本期仅支持 'admin'")

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
    if (typeof op !== 'string' || !(PAGE_DATA_OPS as readonly string[]).includes(op)) {
      fail(`${path}.op`, `op 仅允许 ${PAGE_DATA_OPS.join('/')}`)
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
  }

  const actions = schema.actions ?? {}
  if (!isRecord(actions)) fail('actions', '必须是对象')
  const actionNames = Object.keys(actions)
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
    if (typeof block.bind !== 'string' || block.bind.length === 0) {
      fail(`${path}.bind`, 'bind 必须是非空字符串')
    }
    if (block.type === 'form') {
      if (!actionNames.includes(block.bind)) fail(`${path}.bind`, `动作不存在：${block.bind}`)
    } else if (!dsNames.includes(block.bind)) {
      fail(`${path}.bind`, `数据源不存在：${block.bind}`)
    }
  }

  return schema
}
