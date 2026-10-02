import { Injectable } from '@nestjs/common'
import { EXT_DEFAULT_PAGE_SIZE } from '../../../common/constants/credential.constant'
import { ErrorCode } from '../../../common/constants/error-code'
import { BusinessException } from '../../../common/exceptions/business.exception'
import type { CredentialScope } from '../credential/credential.util'

/** 对外字段形态（v1 冻结；与 app 域内部形状解耦，D124） */
export interface ExtFieldSchema {
  name: string
  label: string
  type: string
  required?: boolean
  options?: unknown
  refTable?: string | null
  multiple?: boolean
}

/** 对外表形态（v1 冻结） */
export interface ExtTableSchema {
  name: string
  label: string
  fields: ExtFieldSchema[]
}

/** 对外 schema envelope 的 data 段（`{ code, data: { app, tables } }`） */
export interface ExtSchemaPayload {
  app: { name: string; description: string | null }
  tables: ExtTableSchema[]
}

/** 排序键（契约层规范化后，恒含强制追加的 `rowId` tiebreaker，R136） */
export interface ExtSortKey {
  field: string
  desc: boolean
}

/** 游标载荷（base64url(JSON)；调用方不得解析，仅回传） */
interface ExtCursorPayload {
  v: 1
  sort: string[]
  last: Array<string | number | boolean | null>
}

/** 列表页结果（envelope 的 data + paging 两段） */
export interface ExtListPage {
  data: Array<Record<string, unknown>>
  nextCursor: string | null
  size: number
}

/** 对外 schema 投影输入（与 AppFacade.publicSchema 返回结构兼容；不 import app 域内部类型，铁律 6） */
interface SchemaPayloadLike {
  app: { name: string; description: string | null }
  tables: Array<{
    name: string
    label: string
    fields: Array<{
      name: string
      label: string
      type: string
      required: boolean
      options?: unknown
      refTable?: string | null
      multiple?: boolean
    }>
  }>
}

/** 行数据恒留字段（公开投影内置三件套；scope 只收窄用户字段） */
const BUILTIN_ROW_FIELDS = ['rowId', 'createdAt', 'updatedAt'] as const

/** 对外契约最大页大小（沿用 R104 的 size ≤ 50） */
const EXT_MAX_PAGE_SIZE = 50

/**
 * 对外契约冻结层（P15 T135，D124/R136 / ARCHITECTURE-P15 §4）。
 *
 * **独立成服务**：对外端点不直接透传 AppFacade 的返回值形状，统一经本层改写——内部响应形状
 * 变更（如 `{list,total,pageNo,pageSize}`）不会漂移到 v1。本层负责：
 *
 * - envelope 组装（`{ data, paging: { nextCursor, size } }`，**无 total**）；
 * - 游标编解码（`base64url(JSON({v,sort,last}))`，含「与本次 sort 一致」校验）；
 * - keyset 分页（内存按排序键比较定位，含 `rowId` tiebreaker → 边拉边写不重不漏）；
 * - scope ∩ 暴露投影（表 / 字段收窄，越权即不可见）。
 */
@Injectable()
export class ExtContractService {
  /** 页大小（缺省 20；1~50，越界 40001） */
  resolveSize(raw: unknown): number {
    if (raw === undefined || raw === '') return EXT_DEFAULT_PAGE_SIZE
    const size = Number(raw)
    if (!Number.isInteger(size) || size < 1 || size > EXT_MAX_PAGE_SIZE) {
      throw new BusinessException(ErrorCode.ParamInvalid, `size 需为 1~${EXT_MAX_PAGE_SIZE} 的整数`)
    }
    return size
  }

  /**
   * 排序键规范化（R136）：请求排序 + **强制追加 `rowId ASC`** tiebreaker。
   * `signature` 用于游标一致性校验（cursor 与当前 sort 必须匹配，否则 40001）。
   */
  resolveSort(sort: Array<{ f: string; dir: 'asc' | 'desc' }>): {
    keys: ExtSortKey[]
    signature: string[]
  } {
    const keys: ExtSortKey[] = sort.map((item) => ({ field: item.f, desc: item.dir === 'desc' }))
    if (!keys.some((key) => key.field === 'rowId')) {
      keys.push({ field: 'rowId', desc: false })
    }
    return { keys, signature: keys.map((key) => `${key.field}:${key.desc ? 'desc' : 'asc'}`) }
  }

  /** 游标解码（非法 / 长度不符 / 与本次 sort 不一致 → 40001） */
  decodeCursor(raw: string, signature: string[]): ExtCursorPayload | null {
    if (!raw) return null
    let parsed: unknown
    try {
      parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    } catch {
      throw new BusinessException(ErrorCode.ParamInvalid, 'after 游标非法')
    }
    const cursor = parsed as Partial<ExtCursorPayload>
    if (cursor.v !== 1 || !Array.isArray(cursor.sort) || !Array.isArray(cursor.last)) {
      throw new BusinessException(ErrorCode.ParamInvalid, 'after 游标非法')
    }
    if (cursor.sort.join(',') !== signature.join(',')) {
      throw new BusinessException(
        ErrorCode.ParamInvalid,
        'after 游标与本次 sort 不一致，请从首页重新拉取',
      )
    }
    if (cursor.last.length !== signature.length) {
      throw new BusinessException(ErrorCode.ParamInvalid, 'after 游标非法')
    }
    return {
      v: 1,
      sort: cursor.sort,
      last: cursor.last as Array<string | number | boolean | null>,
    }
  }

  /**
   * keyset 分页（R136）：内存按排序键排序（含 `rowId` tiebreaker）→ 依游标值定位起点 → 切片
   * → 依末行生成下一页游标。
   *
   * 与 offset 分页的区别：定位基于**排序键的值**而非行序号，故「边拉边写」不会重复或漏行
   * （默认 `rowId ASC` 下新行恒在末尾；游标行被删除也不影响定位正确性）。
   */
  paginate(
    rows: Array<Record<string, unknown>>,
    keys: ExtSortKey[],
    signature: string[],
    cursor: ExtCursorPayload | null,
    size: number,
  ): ExtListPage {
    const sorted = [...rows].sort((left, right) => this.compareRows(left, right, keys))
    let start = 0
    if (cursor) {
      const anchor: Record<string, unknown> = {}
      keys.forEach((key, index) => {
        anchor[key.field] = cursor.last[index]
      })
      const found = sorted.findIndex((row) => this.compareRows(row, anchor, keys) > 0)
      start = found < 0 ? sorted.length : found
    }
    const data = sorted.slice(start, start + size)
    const hasMore = start + data.length < sorted.length
    const nextCursor =
      hasMore && data.length > 0
        ? this.encodeCursor({
            v: 1,
            sort: signature,
            // 游标值规范化（Date → ISO 串）：JSON 往返后类型须与库内值可比（时间字段排序的典型坑）
            last: keys.map((key) => this.cursorValue(data[data.length - 1][key.field])),
          })
        : null
    return { data, nextCursor, size }
  }

  /** schema 投影（R132 第 4 步）：只输出 `scope.tables` 内的表；表若有 `scope.fields` 只输出其内字段 */
  projectSchema(payload: SchemaPayloadLike, scope: CredentialScope): ExtSchemaPayload {
    const tables = payload.tables
      .filter((table) => scope.tables.includes(table.name))
      .map((table) => {
        const picked = scope.fields?.[table.name]
        const fields =
          picked && picked.length > 0
            ? table.fields.filter((field) => picked.includes(field.name))
            : table.fields
        return {
          name: table.name,
          label: table.label,
          fields: fields.map((field) => ({
            name: field.name,
            label: field.label,
            type: field.type,
            required: field.required,
            ...(field.options !== undefined ? { options: field.options } : {}),
            ...(field.refTable !== undefined ? { refTable: field.refTable } : {}),
            ...(field.multiple !== undefined ? { multiple: field.multiple } : {}),
          })),
        }
      })
    return { app: payload.app, tables }
  }

  /** 表必须在 `scope.tables` 内（否则 40400：越权表与不存在不可区分，R132 第 4 步） */
  assertTableInScope(table: string, scope: CredentialScope): void {
    if (!scope.tables.includes(table)) {
      throw new BusinessException(ErrorCode.NotFound, '资源不存在')
    }
  }

  /**
   * 该表的强制过滤条件串（P17 R148/R150）：`scope.rowFilter[表]`，缺省 → 空数组（不过滤）。
   *
   * REST 取数面（records / detail）与 MCP 三件套**共用此入口**，保证 rowFilter 在两条协议上
   * 同源生效（R150 透明继承）；条件串的语法校验 / 求值全部由 app 域同一解析器完成（R147）。
   */
  mandatoryFilters(table: string, scope: CredentialScope): string[] {
    const conditions = scope.rowFilter?.[table]
    return Array.isArray(conditions) ? conditions : []
  }

  /** 行数据按 scope 字段收窄（`rowId / createdAt / updatedAt` 恒留；未限定字段时原样返回） */
  projectRow(
    row: Record<string, unknown>,
    table: string,
    scope: CredentialScope,
  ): Record<string, unknown> {
    const picked = scope.fields?.[table]
    if (!picked || picked.length === 0) return row
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(row)) {
      if (BUILTIN_ROW_FIELDS.includes(key as (typeof BUILTIN_ROW_FIELDS)[number])) {
        out[key] = value
        continue
      }
      if (key === 'expanded' && value && typeof value === 'object' && !Array.isArray(value)) {
        out.expanded = this.projectExpanded(value as Record<string, unknown>, picked)
        continue
      }
      if (!picked.includes(key)) continue
      out[key] = value
    }
    return out
  }

  // ==================== 内部 ====================

  private encodeCursor(payload: ExtCursorPayload): string {
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  }

  /** 展开对象按 scope 字段收窄（rowId 恒留） */
  private projectExpanded(
    expanded: Record<string, unknown>,
    picked: string[],
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(expanded)) {
      const items = Array.isArray(value) ? value : [value]
      const trimmed = items.map((item) => {
        if (typeof item !== 'object' || item === null) return item
        const record = item as Record<string, unknown>
        const next: Record<string, unknown> = {}
        for (const [fieldKey, fieldValue] of Object.entries(record)) {
          if (fieldKey === 'rowId' || picked.includes(fieldKey)) next[fieldKey] = fieldValue
        }
        return next
      })
      if (trimmed.length > 0) {
        // 保持「数组恒数组、单对象恒对象」的原形态（与公开投影一致）
        out[key] = Array.isArray(value) ? trimmed : trimmed[0]
      }
    }
    return out
  }

  private compareRows(
    left: Record<string, unknown>,
    right: Record<string, unknown>,
    keys: ExtSortKey[],
  ): number {
    for (const key of keys) {
      const result = this.compareValues(left[key.field], right[key.field])
      if (result !== 0) return key.desc ? -result : result
    }
    return 0
  }

  /**
   * 值比较：数值（含数字字符串，如 rowId）按数值比，其余按字符串比；`null/undefined` 最小。
   * 契约层独立实现，不依赖 app 域内部投影细节（D124）。
   */
  private compareValues(left: unknown, right: unknown): number {
    const leftValue = this.cursorValue(left)
    const rightValue = this.cursorValue(right)
    if (leftValue === rightValue) return 0
    if (leftValue === null) return -1
    if (rightValue === null) return 1
    const leftNum = this.toNumber(leftValue)
    const rightNum = this.toNumber(rightValue)
    if (leftNum !== null && rightNum !== null) {
      if (leftNum === rightNum) return 0
      return leftNum < rightNum ? -1 : 1
    }
    const leftText = String(leftValue)
    const rightText = String(rightValue)
    if (leftText === rightText) return 0
    return leftText < rightText ? -1 : 1
  }

  /**
   * 游标值规范化：`Date → ISO 字符串`。
   *
   * 必要性：游标经 base64url(JSON) 往返后，`Date` 会变成 ISO 串；若比较时一侧是 `Date`、
   * 另一侧是串，keyset 定位必然错位（**时间字段排序 + 翻页的典型坑**，冒烟用例实测发现）。
   * 其余标量原样返回，复杂值退化为字符串（保证可 JSON 化）。
   */
  private cursorValue(value: unknown): string | number | boolean | null {
    if (value === null || value === undefined) return null
    if (value instanceof Date) return value.toISOString()
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return value
    }
    return String(value)
  }

  /** 数值化（布尔与空白串不参与数值比较，避免 true→1 / ''→0 的误判） */
  private toNumber(value: unknown): number | null {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null
    if (typeof value === 'string' && value.trim() !== '') {
      const num = Number(value)
      return Number.isFinite(num) ? num : null
    }
    return null
  }
}
