import type { AppFieldType } from './schema.constants'

/** 枚举选项（enum 字段） */
export interface AppEnumOption {
  value: string
  label: string
}

/** 字段视图（schema 全量打包的字段项） */
export interface AppFieldView {
  id: string
  name: string
  label: string
  type: AppFieldType
  required: boolean
  defaultVal: unknown
  enumOptions: AppEnumOption[] | null
  refTableId: string | null
  refTableName: string | null
  refMultiple: boolean
  sort: number
}

/** 逻辑表视图（含字段；n:n 中间表 isSystem=true，前端折叠） */
export interface AppTableView {
  id: string
  name: string
  label: string
  isSystem: boolean
  fields: AppFieldView[]
}

/** 关系视图（仅 n:n 显式登记） */
export interface AppRelationView {
  id: string
  type: string
  fromTable: string
  fromField: string
  toTable: string
  throughTable: string
}

/** 功能页视图 */
export interface AppPageView {
  id: string
  code: string
  name: string
  route: string
  kind: string
  genBy: string
  sort: number
  schema: unknown
}

/** schema 全量打包（GET /app/:code/schema，前端首屏一次拉取） */
export interface AppSchemaBundle {
  app: {
    appCode: string
    pubCode: string
    name: string
    description: string | null
    status: string
  }
  tables: AppTableView[]
  relations: AppRelationView[]
  pages: AppPageView[]
}

/** 逻辑表定义（DataService 写路径/查询解析用） */
export interface ResolvedTable {
  id: bigint
  appId: bigint
  name: string
  label: string
  isSystem: boolean
  fields: Array<{
    id: bigint
    name: string
    label: string
    type: AppFieldType
    required: boolean
    defaultVal: unknown
    enumOptions: AppEnumOption[] | null
    refTableId: bigint | null
    refTableName: string | null
    refMultiple: boolean
    sort: number
  }>
  /** 字段名 → 定义（含软删字段不收录） */
  fieldMap: Map<string, ResolvedTable['fields'][number]>
  /** 字段名 → r_cN 槽位（1..5，按 sort 取前 N 个索引字段；R99） */
  indexSlots: Map<string, number>
}
