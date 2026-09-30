/**
 * 市场结构快照（P13 R117 / D107，ARCHITECTURE §29.2）。
 *
 * 纯函数与类型定义（零 Nest 依赖，可核查）：
 * - 提交时由 AppFacade 导出的结构源（schema 全量打包）物化为快照；
 * - 快照**不含暴露三开关、不含数据**（演示数据另存 demo_data，见 R118）；
 * - 快照是审核与复制的唯一依据：源应用后续变更不影响在架版本（D107）。
 */

/** 快照版本（版本不符 → 50015 语义拒绝，不静默修补，ARCH §29.3） */
export const SNAPSHOT_VERSION = 1

/** 表名 / 字段名正则（域边界纪律：app 域 NAME_PATTERN 的本地副本，不跨域 import） */
export const NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/
/** 应用 code 正则（app 域 APP_CODE_PATTERN 的本地副本：slug 化名称，可能带 "(n)" 冲突后缀） */
export const APP_CODE_PATTERN = /^[a-z0-9][a-z0-9-]{0,40}(\(\d{1,3}\))?$/

/** 字段类型白名单（与 app 域 R88 七类一致；域边界纪律：本地副本，不 import app 域常量） */
export const SNAPSHOT_FIELD_TYPES: readonly string[] = [
  'text',
  'number',
  'datetime',
  'bool',
  'enum',
  'attachment',
  'ref',
]

/** 快照字段（R117：类型/必填/默认/枚举/引用全量） */
export interface SnapshotField {
  name: string
  label: string
  type: string
  required: boolean
  default: unknown
  enumOptions: Array<{ value: string; label: string }> | null
  /** ref 目标表名（type=ref） */
  refTable: string | null
  /** true = n:n 多值（由 rels 重建中间表，物化方不直接建该字段） */
  refMultiple: boolean
}

/** 快照逻辑表（n:n 中间表不入快照，由物化方按 rels 重建） */
export interface SnapshotTable {
  name: string
  label: string
  fields: SnapshotField[]
}

/** 快照 n:n 关系（R117） */
export interface SnapshotRel {
  fromTable: string
  fromField: string
  toTable: string
}

/** 快照功能页（admin 与 display 全含，schema 原样；isPublic 不随快照走） */
export interface SnapshotPage {
  name: string
  route: string
  kind: string
  genBy: string
  sort: number
  schema: Record<string, unknown>
}

/**
 * 快照内展示应用（P14 D117 bundle 化）：名称 + 文本文件清单（path 为展示应用目录内相对路径）。
 * 仅文本（HTML/CSS/JS/JSON 等）；二进制素材不随复制（R128：断链自担）。
 */
export interface SnapshotDisplay {
  name: string
  files: Array<{ path: string; content: string }>
}

/**
 * 快照内授权边（P14 D117）：数据应用即本快照所属应用，故只需 `displayName` 指向 `displays[]`；
 * 复制时在**副本之间**重建（授权双方均为接收方实体），且只带出边闭包（不反向）。
 */
export interface SnapshotGrant {
  displayName: string
}

/** 结构快照（market_listing.snapshot 的列结构） */
export interface AppSnapshot {
  version: number
  tables: SnapshotTable[]
  rels: SnapshotRel[]
  pages: SnapshotPage[]
  /** P14 D117：随包展示应用（旧快照无此字段 → 解析时归一为空数组，向后兼容） */
  displays: SnapshotDisplay[]
  /** P14 D117：随包授权边（同上兼容） */
  grants: SnapshotGrant[]
}

/** 装配快照的结构源（= AppFacade.exportStructure 的返回体，域边界经门面） */
export interface SnapshotSource {
  tables: Array<{
    name: string
    label: string
    fields: Array<{
      name: string
      label: string
      type: string
      required: boolean
      defaultVal: unknown
      enumOptions: Array<{ value: string; label: string }> | null
      refTableName: string | null
      refMultiple: boolean
    }>
  }>
  rels: Array<{ fromTable: string; fromField: string; toTable: string }>
  pages: Array<{
    name: string
    route: string
    kind: string
    genBy: string
    sort: number
    schema: Record<string, unknown>
  }>
  /** P14 D117：随包展示应用（market 域经 DisplayFacade 取出边闭包后传入；缺省 = 无 bundle） */
  displays?: Array<{ name: string; files: Array<{ path: string; content: string }> }>
  /** P14 D117：随包授权边（displayName 指向 displays[]） */
  grants?: Array<{ displayName: string }>
}

/** 结构源 → 快照（物化；不含暴露开关与数据，R117；P14 D117 起含展示应用 bundle） */
export function buildSnapshot(source: SnapshotSource): AppSnapshot {
  return {
    version: SNAPSHOT_VERSION,
    tables: source.tables.map((table) => ({
      name: table.name,
      label: table.label,
      fields: table.fields.map((field) => ({
        name: field.name,
        label: field.label,
        type: field.type,
        required: field.required,
        default: field.defaultVal ?? null,
        enumOptions: field.enumOptions ?? null,
        refTable: field.refTableName ?? null,
        refMultiple: field.refMultiple,
      })),
    })),
    rels: source.rels.map((rel) => ({
      fromTable: rel.fromTable,
      fromField: rel.fromField,
      toTable: rel.toTable,
    })),
    pages: source.pages.map((page) => ({
      name: page.name,
      route: page.route,
      kind: page.kind,
      genBy: page.genBy,
      sort: page.sort,
      schema: page.schema,
    })),
    displays: (source.displays ?? []).map((display) => ({
      name: display.name,
      files: display.files.map((file) => ({ path: file.path, content: file.content })),
    })),
    grants: (source.grants ?? []).map((grant) => ({ displayName: grant.displayName })),
  }
}
