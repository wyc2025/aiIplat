import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { AppDef } from '@prisma/client'
import { ErrorCode } from '../../../common/constants/error-code'
import { RedisKey } from '../../../common/constants/redis-key'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import { RedisService } from '../../../infra/redis/redis.service'
import { CloudFacade, type AppAttachmentStream } from '../../cloud/facade/cloud-facade.service'
import { DataService, type DataRowView } from '../data/data.service'
import type { QueryExpandDto, QueryFilterDto, QuerySortDto } from '../data/dto/data.dto'
import { SchemaService } from '../schema/schema.service'
import type { ResolvedTable } from '../schema/schema.types'

/**
 * 授权取数数据服务（P12 T110 建 → P14 D115 改造：匿名公开面退役，改为「授权取数面」）。
 *
 * 定位口径：调用方（site 域开放层）已解析站点并经 `DisplayFacade.assertCanRead` 校验授权，
 * 本服务再按 **属主 + 应用 code** 定位（同名 code 属不同用户互不串台；P12 的 pub_code 全局
 * 唯一定位不再需要），`is_public=1` 为「可被授权读取的总开关」（D115 语义切换）。
 *
 * 分工：本服务只做**取数面语义**——应用定位与 is_public 闸门 + 暴露校验 + R104 参数白名单 +
 * R101 投影白名单 + 缓存；真正的取数复用 A 侧执行器（`DataService.queryForPublic`，铁律 5），
 * 因此双路径（r_cN 下推 / 内存 1 万行护栏）与 2s 超时（50009）与 A 侧完全一致。
 *
 * 防探测（D100 口径沿用）：资源类失败（应用不存在 / 未公开 / 表未暴露 / 行不存在 / 文件无引用）
 * 一律 **40400**，与「不存在」不可区分；参数越界 **40001** 为例外。
 */

/** R101 内置三件套：永远输出（不受字段暴露影响；内部列永不输出） */
const BUILTIN_FIELDS = new Set(['rowId', 'createdAt', 'updatedAt'])
/** R104 filter op 白名单（contains 限 text/enum） */
const PUBLIC_FILTER_OPS = ['eq', 'contains'] as const
/** contains 允许的字段类型（R104） */
const CONTAINS_TYPES = new Set(['text', 'enum'])
/** 公开列表默认 size（R104：上限走配置 app.pubListMaxSize，默认 50） */
const DEFAULT_PUB_SIZE = 20

/** 有效暴露集合（R100：应用公开 ∧ 表暴露 ∧ 字段暴露；R101 投影白名单来源） */
interface ExposureSet {
  /** 可输出字段名 */
  allowed: Set<string>
  /** ref 字段 → 目标表名 */
  refTargets: Map<string, string>
  /** ref 字段 → 目标表可输出字段（目标表未暴露则无此键 → expand 越界 40001） */
  expandAllowed: Map<string, Set<string>>
}

/** R104 固定参数解析结果 */
interface PublicPlan {
  page: number
  size: number
  /** 原始排序（本地排序用，含内置三件套） */
  sort: QuerySortDto[]
  /** 下推给执行器的排序（仅真实字段；含内置字段时为空，改本地排序） */
  executorSort: QuerySortDto[]
  /** 是否本地排序（排序键含内置字段 → r_cN 下推不认内置列，改在结果集上稳定排序） */
  localSort: boolean
  filter: QueryFilterDto[]
  expand: QueryExpandDto[]
  /** expand 字段 → 请求的字段子集（null = 未指定，按白名单全量） */
  expandFields: Map<string, string[] | null>
  /** 数据缓存键后缀 */
  cacheKey: string
}

/** 取数面列表响应 */
export interface PublicListPayload {
  list: Array<Record<string, unknown>>
  total: number
  pageNo: number
  pageSize: number
}

/** 取数面暴露表结构响应（P14 `/schema` 端点；含枚举选项与 ref 目标表名，供展示页渲染与拼参） */
export interface PublicSchemaPayload {
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

@Injectable()
export class PubDataService {
  private readonly logger = new Logger(PubDataService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly schemaService: SchemaService,
    private readonly dataService: DataService,
    private readonly cloudFacade: CloudFacade,
  ) {}

  // ==================== 限流（R106） ====================

  /** 公开端点限流：60 次/分/IP，超限 42900（Redis 不可用时降级放行，不阻断阅读） */
  async assertRateLimit(ip: string): Promise<void> {
    const limit = this.config.get<number>('app.pubRateLimitPerMinute', 60)
    const key = RedisKey.appPubRate(ip)
    let count = 0
    try {
      count = await this.redis.client.incr(key)
      if (count === 1) await this.redis.client.expire(key, 60)
    } catch {
      return
    }
    if (count > limit) {
      throw new BusinessException(ErrorCode.TooManyRequests, '请求过于频繁，请稍后再试')
    }
  }

  // ==================== 应用定位（D115：属主 + code + is_public 总开关） ====================

  /**
   * 属主 + 应用 code → 可被授权读取的应用：不存在 / 未公开 / 已软删 一律 40400（不可区分）。
   * D115 语义切换：is_public 由「公开发布开关」变为「可被授权读取的总开关」（授权命中后仍须为 1）。
   */
  async resolvePublicApp(ownerId: bigint, appCode: string): Promise<AppDef> {
    const app = await this.prisma.appDef.findFirst({
      where: { ownerId, code: appCode, isPublic: 1, deletedAt: null },
    })
    if (!app) {
      throw new BusinessException(ErrorCode.NotFound, '资源不存在')
    }
    return app
  }

  // ==================== 暴露表结构（R105：TTL 600s） ====================

  /**
   * 暴露表结构（P14 取数面 `/schema` 端点）：仅暴露表 + 暴露字段（含枚举选项与 ref 目标表名）。
   * 缓存 600s（授权增删 / 暴露变更 / 结构变更即 DEL）；无暴露表时 tables 为空数组（不是错误）。
   */
  async schema(ownerId: bigint, appCode: string): Promise<PublicSchemaPayload> {
    const app = await this.resolvePublicApp(ownerId, appCode)
    const key = RedisKey.appPubSchema(app.id.toString())
    const cached = await this.readCache<PublicSchemaPayload>(key)
    if (cached) return cached

    const tables = await this.prisma.appTable.findMany({
      where: { appId: app.id, deletedAt: null, isSystem: 0, isExposed: 1 },
      orderBy: { id: 'asc' },
      select: { id: true, name: true, label: true },
    })
    const fields = tables.length
      ? await this.prisma.appField.findMany({
          where: { tableId: { in: tables.map((table) => table.id) }, isDeleted: 0, isExposed: 1 },
          orderBy: [{ sort: 'asc' }, { id: 'asc' }],
          select: {
            tableId: true,
            name: true,
            label: true,
            type: true,
            required: true,
            enumOptions: true,
            refTableId: true,
            refMultiple: true,
          },
        })
      : []
    const refNames = await this.refTableNames(fields)

    const payload: PublicSchemaPayload = {
      app: { name: app.name, description: app.description },
      tables: tables.map((table) => ({
        name: table.name,
        label: table.label,
        fields: fields
          .filter((field) => field.tableId === table.id)
          .map((field) => ({
            name: field.name,
            label: field.label,
            type: field.type,
            required: field.required === 1,
            ...(field.enumOptions ? { options: field.enumOptions } : {}),
            ...(field.refTableId
              ? { refTable: refNames.get(field.refTableId.toString()) ?? null }
              : {}),
            ...(field.refMultiple === 1 ? { multiple: true } : {}),
          })),
      })),
    }
    await this.writeCache(key, payload, 'app.pubManifestCacheTtlSeconds', 600)
    return payload
  }

  // ==================== 公开列表 / 详情（R101 + R104 + R105） ====================

  /** 取数面列表：R104 参数白名单 → 复用执行器 → R101 投影 → 60s 缓存 */
  async listRows(
    ownerId: bigint,
    appCode: string,
    tableName: string,
    query: Record<string, unknown>,
  ): Promise<PublicListPayload> {
    const app = await this.resolvePublicApp(ownerId, appCode)
    const { table, tableId } = await this.resolveExposedTable(app.id, tableName)
    const exposure = await this.computeExposure(app.id, table, tableId)
    const plan = this.parseListParams(query, table, exposure)

    const cacheKey = `${RedisKey.appPubDataPrefix(app.id.toString())}${plan.cacheKey}`
    const cached = await this.readCache<PublicListPayload>(cacheKey)
    if (cached) return cached

    const { rows } = await this.dataService.queryForPublic(app, table, {
      op: 'list',
      filter: plan.filter,
      sort: plan.executorSort,
      expand: plan.expand,
    })
    if (plan.localSort) this.sortViews(rows, plan.sort, table)

    const start = (plan.page - 1) * plan.size
    const payload: PublicListPayload = {
      list: rows.slice(start, start + plan.size).map((view) => this.project(view, exposure, plan)),
      total: rows.length,
      pageNo: plan.page,
      pageSize: plan.size,
    }
    await this.writeCache(cacheKey, payload, 'app.pubDataCacheTtlSeconds', 60)
    return payload
  }

  /** 取数面单行（行不存在 → 40400；支持 expand） */
  async getRow(
    ownerId: bigint,
    appCode: string,
    tableName: string,
    rowId: string,
    query: Record<string, unknown>,
  ) {
    const app = await this.resolvePublicApp(ownerId, appCode)
    const { table, tableId } = await this.resolveExposedTable(app.id, tableName)
    const exposure = await this.computeExposure(app.id, table, tableId)
    const { expand, expandFields } = this.parseExpand(
      this.strList(query.expand, 'expand'),
      table,
      exposure,
    )
    const plan: PublicPlan = {
      page: 1,
      size: 1,
      sort: [],
      executorSort: [],
      localSort: false,
      filter: [],
      expand,
      expandFields,
      cacheKey: '',
    }
    const { rows } = await this.dataService.queryForPublic(app, table, {
      op: 'get',
      rowId,
      expand,
    })
    return { op: 'get', row: this.project(rows[0], exposure, plan) }
  }

  // ==================== 公开附件流（D104，三道闸） ====================

  /**
   * 公开附件流：① `app_attachment_ref` 有引用（deleted_at 过滤）② 所属表·字段有效暴露
   * ③ MIME 口径由控制器按 R26 输出。任一失败 → 40400（防探测）。
   */
  async attachmentStream(
    ownerId: bigint,
    appCode: string,
    fileId: string,
    range?: { start: number; end: number },
  ): Promise<AppAttachmentStream> {
    const app = await this.resolvePublicApp(ownerId, appCode)
    let id: bigint
    try {
      id = BigInt(fileId)
    } catch {
      throw new BusinessException(ErrorCode.NotFound, '资源不存在')
    }
    const refs = await this.prisma.appAttachmentRef.findMany({
      where: { fileId: id, deletedAt: null, appId: app.id },
      select: { tableId: true, fieldName: true },
    })
    if (refs.length === 0) {
      throw new BusinessException(ErrorCode.NotFound, '资源不存在')
    }
    let exposed = false
    for (const ref of refs) {
      const table = await this.prisma.appTable.findFirst({
        where: { id: ref.tableId, appId: app.id, deletedAt: null, isSystem: 0, isExposed: 1 },
        select: { id: true },
      })
      if (!table) continue
      const field = await this.prisma.appField.findFirst({
        where: { tableId: table.id, name: ref.fieldName, isDeleted: 0, isExposed: 1 },
        select: { id: true },
      })
      if (field) {
        exposed = true
        break
      }
    }
    if (!exposed) {
      throw new BusinessException(ErrorCode.NotFound, '资源不存在')
    }
    // 行已删/目录 → CloudFacade 抛 40400（与公开面统一码一致）
    return this.cloudFacade.getAppAttachmentStream(id, range)
  }

  // ==================== 内部：暴露集合与投影（R100/R101） ====================

  /** 解析已暴露表（未暴露 / 系统表 / 不存在 → 40400），返回解析后的表定义 */
  private async resolveExposedTable(
    appId: bigint,
    tableName: string,
  ): Promise<{ table: ResolvedTable; tableId: bigint }> {
    const row = await this.prisma.appTable.findFirst({
      where: { appId, name: tableName, deletedAt: null, isSystem: 0, isExposed: 1 },
      select: { id: true },
    })
    if (!row) {
      throw new BusinessException(ErrorCode.NotFound, '资源不存在')
    }
    const table = await this.schemaService.resolveTableByName(appId, tableName)
    return { table, tableId: row.id }
  }

  /** 有效暴露集合：暴露字段 + ref 目标表/目标字段（expand 白名单） */
  private async computeExposure(
    appId: bigint,
    table: ResolvedTable,
    tableId: bigint,
  ): Promise<ExposureSet> {
    const fields = await this.prisma.appField.findMany({
      where: { tableId, isDeleted: 0, isExposed: 1 },
      select: { name: true },
    })
    const allowed = new Set(fields.map((field) => field.name))
    const refTargets = new Map<string, string>()
    for (const field of table.fields) {
      if (field.refTableName && allowed.has(field.name)) {
        refTargets.set(field.name, field.refTableName)
      }
    }
    const expandAllowed = new Map<string, Set<string>>()
    const targetNames = [...new Set(refTargets.values())]
    if (targetNames.length > 0) {
      const targetTables = await this.prisma.appTable.findMany({
        where: { appId, name: { in: targetNames }, deletedAt: null, isExposed: 1 },
        select: { id: true, name: true },
      })
      const targetIds = targetTables.map((item) => item.id)
      const targetFields = targetIds.length
        ? await this.prisma.appField.findMany({
            where: { tableId: { in: targetIds }, isDeleted: 0, isExposed: 1 },
            select: { tableId: true, name: true },
          })
        : []
      const byTableId = new Map<string, Set<string>>()
      for (const field of targetFields) {
        const key = field.tableId.toString()
        const set = byTableId.get(key) ?? new Set<string>()
        set.add(field.name)
        byTableId.set(key, set)
      }
      for (const [refField, targetName] of refTargets) {
        const hit = targetTables.find((item) => item.name === targetName)
        if (!hit) continue
        expandAllowed.set(refField, byTableId.get(hit.id.toString()) ?? new Set<string>())
      }
    }
    return { allowed, refTargets, expandAllowed }
  }

  /** R101 投影：暴露字段 + 内置三件套；expand 结果按目标表白名单裁剪 */
  private project(
    view: DataRowView,
    exposure: ExposureSet,
    plan: PublicPlan,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {
      rowId: view.rowId,
      createdAt: view.createdAt,
      updatedAt: view.updatedAt,
    }
    for (const [key, value] of Object.entries(view.data)) {
      if (exposure.allowed.has(key)) out[key] = value
    }
    if (view.expanded) {
      const expanded: Record<string, unknown> = {}
      for (const [field, value] of Object.entries(view.expanded)) {
        const allowed = exposure.expandAllowed.get(field)
        if (!allowed) continue
        const requested = plan.expandFields.get(field) ?? null
        expanded[field] = Array.isArray(value)
          ? value.map((item) => this.pickExpanded(item, allowed, requested))
          : this.pickExpanded(value, allowed, requested)
      }
      if (Object.keys(expanded).length > 0) out.expanded = expanded
    }
    return out
  }

  /** 展开对象裁剪：rowId 恒留，其余仅暴露字段（有请求子集时再取交集） */
  private pickExpanded(
    item: unknown,
    allowed: Set<string>,
    requested: string[] | null,
  ): unknown {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return item
    const record = item as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(record)) {
      if (key === 'rowId') {
        out[key] = value
        continue
      }
      if (!allowed.has(key)) continue
      if (requested && !requested.includes(key)) continue
      out[key] = value
    }
    return out
  }

  // ==================== 内部：R104 参数解析 ====================

  private parseListParams(
    query: Record<string, unknown>,
    table: ResolvedTable,
    exposure: ExposureSet,
  ): PublicPlan {
    const maxSize = this.config.get<number>('app.pubListMaxSize', 50)
    const maxSort = this.config.get<number>('app.pubSortMaxFields', 2)
    const maxFilter = this.config.get<number>('app.pubFilterMaxGroups', 3)

    const page = this.intParam(query.page, 1, 'page')
    if (page < 1) this.paramInvalid('page 必须 ≥ 1')
    const rawSize = query.size
    const size =
      rawSize === undefined || rawSize === ''
        ? DEFAULT_PUB_SIZE
        : this.intParam(rawSize, 0, 'size')
    if (size < 1 || size > maxSize) {
      this.paramInvalid(`size 需为 1~${maxSize} 的整数`)
    }

    const sortRaws = this.strList(query.sort, 'sort')
    if (sortRaws.length > maxSort) this.paramInvalid(`sort 最多 ${maxSort} 组`)
    const filterRaws = this.strList(query.filter, 'filter')
    if (filterRaws.length > maxFilter) this.paramInvalid(`filter 最多 ${maxFilter} 组`)

    const sort: QuerySortDto[] = []
    const executorSort: QuerySortDto[] = []
    let localSort = false
    for (const raw of sortRaws) {
      const [field, dir] = raw.split(':')
      if (!field || (dir !== 'asc' && dir !== 'desc')) {
        this.paramInvalid(`sort 需为「字段:asc|desc」：${raw}`)
      }
      this.assertPublicField(field, table, exposure, '排序')
      const item: QuerySortDto = { f: field, dir: dir as 'asc' | 'desc' }
      sort.push(item)
      if (BUILTIN_FIELDS.has(field)) localSort = true
      else executorSort.push(item)
    }

    const filter: QueryFilterDto[] = []
    for (const raw of filterRaws) {
      const first = raw.indexOf(':')
      const second = first >= 0 ? raw.indexOf(':', first + 1) : -1
      if (first < 0 || second < 0) this.paramInvalid(`filter 需为「字段:op:值」：${raw}`)
      const field = raw.slice(0, first)
      const op = raw.slice(first + 1, second)
      const value = raw.slice(second + 1)
      if (!(PUBLIC_FILTER_OPS as readonly string[]).includes(op)) {
        this.paramInvalid(`filter op 仅允许 ${PUBLIC_FILTER_OPS.join('/')}`)
      }
      this.assertPublicField(field, table, exposure, '过滤')
      const definition = table.fieldMap.get(field)
      if (op === 'contains' && (!definition || !CONTAINS_TYPES.has(definition.type))) {
        this.paramInvalid(`contains 仅支持文本/枚举字段：${field}`)
      }
      filter.push({
        f: field,
        op: op as 'eq' | 'contains',
        v: this.coerceFilterValue(definition?.type, value),
      })
    }

    const { expand, expandFields } = this.parseExpand(
      this.strList(query.expand, 'expand'),
      table,
      exposure,
    )

    return {
      page,
      size,
      sort,
      executorSort: localSort ? [] : executorSort,
      localSort,
      filter,
      expand,
      expandFields,
      cacheKey: this.buildCacheKey(table.name, page, size, sort, filter, expandFields),
    }
  }

  /** expand（≤1 层，限 ref 字段且目标表已暴露；可指定字段子集，服务端仍按白名单裁剪） */
  private parseExpand(
    raws: string[],
    table: ResolvedTable,
    exposure: ExposureSet,
  ): { expand: QueryExpandDto[]; expandFields: Map<string, string[] | null> } {
    if (raws.length > 1) this.paramInvalid('expand 最多 1 组')
    const expand: QueryExpandDto[] = []
    const expandFields = new Map<string, string[] | null>()
    for (const raw of raws) {
      const [field, fieldsRaw] = raw.split(':', 2)
      if (!field) this.paramInvalid(`expand 需为「ref 字段[:f1,f2]」：${raw}`)
      const targetName = exposure.refTargets.get(field)
      const definition = table.fieldMap.get(field)
      if (!definition || !definition.refTableId || !targetName) {
        this.paramInvalid(`expand 仅支持引用字段：${field}`)
      }
      const allowed = exposure.expandAllowed.get(field)
      if (!allowed) this.paramInvalid(`expand 目标表未暴露：${targetName}`)
      const requested = fieldsRaw
        ? fieldsRaw
            .split(',')
            .map((item) => item.trim())
            .filter((item) => item.length > 0)
        : null
      if (requested) {
        for (const item of requested) {
          if (!allowed.has(item)) this.paramInvalid(`expand 字段未暴露：${targetName}.${item}`)
        }
      }
      expand.push(requested ? { f: field, fields: requested } : { f: field })
      expandFields.set(field, requested)
    }
    return { expand, expandFields }
  }

  /** ref 目标表 id → 表名（暴露表结构输出用；目标表未暴露照实给表名，取数时另有暴露闸门） */
  private async refTableNames(
    fields: Array<{ refTableId: bigint | null }>,
  ): Promise<Map<string, string>> {
    const ids = [
      ...new Set(fields.map((field) => field.refTableId).filter((id): id is bigint => id !== null)),
    ]
    if (ids.length === 0) return new Map()
    const rows = await this.prisma.appTable.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    })
    return new Map(rows.map((row) => [row.id.toString(), row.name]))
  }

  private assertPublicField(
    field: string,
    table: ResolvedTable,
    exposure: ExposureSet,
    usage: string,
  ): void {
    if (BUILTIN_FIELDS.has(field)) return
    if (!table.fieldMap.has(field)) this.paramInvalid(`${usage}字段不存在：${field}`)
    if (!exposure.allowed.has(field)) this.paramInvalid(`${usage}字段未暴露：${field}`)
  }

  /** 过滤值按字段类型归一（number → 数值；bool → 布尔；其余原样） */
  private coerceFilterValue(type: string | undefined, raw: string): unknown {
    if (type === 'number') {
      const num = Number(raw)
      if (!Number.isFinite(num)) this.paramInvalid(`数值字段过滤值非法：${raw}`)
      return num
    }
    if (type === 'bool') return raw === 'true' || raw === '1'
    return raw
  }

  private intParam(value: unknown, fallback: number, name: string): number {
    if (value === undefined || value === '') return fallback
    const num = Number(value)
    if (!Number.isInteger(num)) this.paramInvalid(`${name} 必须是整数`)
    return num
  }

  /** query 里的重复参数（Express 解析为 string 或 string[]） */
  private strList(value: unknown, name: string): string[] {
    if (value === undefined || value === '') return []
    if (typeof value === 'string') return [value]
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item !== 'string') this.paramInvalid(`${name} 参数格式非法`)
      }
      return value as string[]
    }
    this.paramInvalid(`${name} 参数格式非法`)
  }

  private paramInvalid(message: string): never {
    throw new BusinessException(ErrorCode.ParamInvalid, message)
  }

  // ==================== 内部：本地排序与缓存 ====================

  /** 本地排序（排序键含内置三件套时；r_cN 下推不认内置列） */
  private sortViews(views: DataRowView[], sort: QuerySortDto[], table: ResolvedTable): void {
    if (sort.length === 0) return
    views.sort((left, right) => {
      for (const item of sort) {
        const cmp = this.compareValue(
          this.sortValue(left, item.f, table),
          this.sortValue(right, item.f, table),
          item.dir,
        )
        if (cmp !== 0) return cmp
      }
      return 0
    })
  }

  private sortValue(view: DataRowView, field: string, table: ResolvedTable): unknown {
    if (field === 'rowId') return view.rowId
    if (field === 'createdAt') return view.createdAt
    if (field === 'updatedAt') return view.updatedAt
    const definition = table.fieldMap.get(field)
    if (definition?.type === 'number') {
      const raw = view.data[field]
      const num = typeof raw === 'number' ? raw : Number(raw)
      return Number.isFinite(num) ? num : null
    }
    return view.data[field]
  }

  private compareValue(left: unknown, right: unknown, dir: 'asc' | 'desc'): number {
    const order = dir === 'desc' ? -1 : 1
    if (left === right) return 0
    if (left === null || left === undefined) return -1 * order
    if (right === null || right === undefined) return 1 * order
    const a = left instanceof Date ? left.getTime() : typeof left === 'number' ? left : String(left)
    const b = right instanceof Date ? right.getTime() : typeof right === 'number' ? right : String(right)
    if (typeof a === 'number' && typeof b === 'number') return (a - b) * order
    return String(a).localeCompare(String(b)) * order
  }

  private buildCacheKey(
    tableName: string,
    page: number,
    size: number,
    sort: QuerySortDto[],
    filter: QueryFilterDto[],
    expandFields: Map<string, string[] | null>,
  ): string {
    const parts = [`t=${tableName}`, `p=${page}`, `s=${size}`]
    if (sort.length > 0) parts.push(`o=${sort.map((item) => `${item.f}:${item.dir}`).join(',')}`)
    if (filter.length > 0) {
      parts.push(`f=${filter.map((item) => `${item.f}:${item.op}:${String(item.v)}`).join(',')}`)
    }
    if (expandFields.size > 0) {
      parts.push(
        `e=${[...expandFields.entries()]
          .map(([field, fields]) => `${field}:${(fields ?? []).join('|')}`)
          .join(',')}`,
      )
    }
    return parts.join('&')
  }

  private async readCache<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.client.get(key)
      return raw ? (JSON.parse(raw) as T) : null
    } catch {
      return null
    }
  }

  private async writeCache(
    key: string,
    value: unknown,
    configKey: string,
    fallbackSeconds: number,
  ): Promise<void> {
    const ttl = this.config.get<number>(configKey, fallbackSeconds)
    await this.redis.client.set(key, JSON.stringify(value), 'EX', ttl).catch(() => undefined)
  }
}
