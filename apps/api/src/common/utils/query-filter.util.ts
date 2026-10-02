/**
 * R104 查询过滤语法（**单一实现**；P17 T152 从 app 域抽到 common）。
 *
 * 三处共用同一份解析（R147「复用同一解析器」）：
 * 1. 开放层 / 对外取数面的请求参数 `filter`（`PubDataService.parseListParams`，违例 40001）；
 * 2. 凭证 `scope.rowFilter` 的**运行期注入**（同处强制过滤通道，引用失效判拒 40400，R149）；
 * 3. 凭证 `scope.rowFilter` 的**管理侧校验**（`CredentialService.buildScope`，越界 50021）。
 *
 * 抽到公共层的动机：access 域不得 import app 域内部实现（铁律 6），若各写一份，
 * 语法一旦漂移就会出现「管理侧放行、运行期拒绝」的裂缝——这正是 R147 要防的问题。
 */

/** 对外取数面允许的过滤算子（D104 口径；`ne` / `in` 等仍为 A 侧内部能力，不对外） */
export const PUBLIC_FILTER_OPS = ['eq', 'contains'] as const

/** `contains` 仅适用于该集合内的字段类型 */
export const CONTAINS_TYPES = new Set(['text', 'enum'])

export type FilterOp = (typeof PUBLIC_FILTER_OPS)[number]

/** 条件串形态解析结果（值与字段类型归一另见 `coerceFilterValue`） */
export interface ParsedFilterRaw {
  field: string
  op: FilterOp
  /** 原始值串（尚未按字段类型归一） */
  value: string
}

/** 解析结果（成功 / 失败携带原因，由调用方决定错误码） */
export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

/** 条件串形态解析：`"字段:op:值"`（值可含冒号 —— 只切前两段） */
export function parseFilterRaw(raw: string): ParseResult<ParsedFilterRaw> {
  const first = raw.indexOf(':')
  const second = first >= 0 ? raw.indexOf(':', first + 1) : -1
  if (first < 0 || second < 0) {
    return { ok: false, error: `filter 需为「字段:op:值」：${raw}` }
  }
  const field = raw.slice(0, first)
  const op = raw.slice(first + 1, second)
  if (!(PUBLIC_FILTER_OPS as readonly string[]).includes(op)) {
    return { ok: false, error: `filter op 仅允许 ${PUBLIC_FILTER_OPS.join('/')}：${raw}` }
  }
  return { ok: true, value: { field, op: op as FilterOp, value: raw.slice(second + 1) } }
}

/** `contains` 的字段类型准入（文本 / 枚举） */
export function supportsContains(type: string | undefined): boolean {
  return type !== undefined && CONTAINS_TYPES.has(type)
}

/** 过滤值按字段类型归一（number → 数值；bool → 布尔；其余原样） */
export function coerceFilterValue(type: string | undefined, raw: string): ParseResult<unknown> {
  if (type === 'number') {
    const num = Number(raw)
    if (!Number.isFinite(num)) return { ok: false, error: `数值字段过滤值非法：${raw}` }
    return { ok: true, value: num }
  }
  if (type === 'bool') return { ok: true, value: raw === 'true' || raw === '1' }
  return { ok: true, value: raw }
}
