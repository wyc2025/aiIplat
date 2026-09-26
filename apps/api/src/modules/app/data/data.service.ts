import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { AppDef, AppRecord, Prisma } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { ErrorCode } from '../../../common/constants/error-code'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import { CloudFacade } from '../../cloud/facade/cloud-facade.service'
import { AdminService } from '../admin/admin.service'
import { REL_FROM_FIELD, REL_TO_FIELD } from '../schema/schema.constants'
import { SchemaService } from '../schema/schema.service'
import type { ResolvedTable } from '../schema/schema.types'
import type {
  DataQueryDto,
  QueryExpandDto,
  QueryFilterDto,
  QuerySortDto,
  RecordQueryDto,
} from './dto/data.dto'

/** 事务客户端或普通客户端（动作多步写共用） */
export type Db = Prisma.TransactionClient

/** 行视图（对外：rowId + data + 时间；expanded 为 ref 展开结果） */
export interface DataRowView {
  rowId: string
  data: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
  expanded?: Record<string, unknown>
}

/** 非索引过滤内存路径的硬上限（超出 50009，R99） */
const MEMORY_FILTER_CAP = 10_000
/** 默认分页 */
const DEFAULT_PAGE_SIZE = 20
/** DB 路径可下推的 filter op（范围比较统一走内存路径保证数值/日期语义正确） */
const DB_FILTER_OPS = new Set(['eq', 'ne', 'in', 'contains'])

interface NormalizedWrite {
  data: Record<string, unknown>
  multiRefs: Map<string, string[]>
  attachments: Map<string, string | null>
}

/**
 * 沙箱数据服务（P11 T103，R90/R95/R99 —— **唯一数据入口**）：
 * - 写路径：按字段定义校验（类型/必填/枚举/ref 存在性/attachment 权属）→ 组装 data JSON +
 *   维护 r_cN 生成列 → prisma 事务落库；attachment 同步维护 app_attachment_ref；n:n 多值经中间表差量写。
 * - 查询：白名单 DSL（list/get/count + eq/ne/gt/gte/lt/lte/contains/in + 多字段排序 + 分页），
 *   ref 展开 ≤1 层；禁止任意 JOIN / 裸 SQL；非索引过滤内存路径硬上限 1 万行（50009）。
 *
 * 纪律：任何控制器/工具不得绕开本服务直接写 app_record。
 */
@Injectable()
export class DataService {
  private readonly logger = new Logger(DataService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly schemaService: SchemaService,
    private readonly adminService: AdminService,
    private readonly cloudFacade: CloudFacade,
  ) {}

  // ==================== 查询（R95） ====================

  /** 查询入口（list/count 走同一过滤链；get 按 rowId） */
  async query(userId: bigint, dto: DataQueryDto) {
    const app = await this.adminService.assertOwned(userId, dto.appCode)
    const table = await this.schemaService.resolveTableByName(app.id, dto.table)
    const started = Date.now()

    if (dto.op === 'get') {
      const row = await this.findRow(table, dto.rowId ?? '')
      if (!row) {
        throw new BusinessException(ErrorCode.AppNotFound, '数据行不存在或无权')
      }
      const view = await this.toView(app, table, row)
      await this.assertNotTimeout(started)
      return { op: 'get', row: view }
    }

    const shape = await this.queryRows(app, table, dto)
    await this.assertNotTimeout(started)
    if (dto.op === 'count') {
      return { op: 'count', total: shape.total }
    }
    const page = dto.page ?? 1
    const size = dto.size ?? DEFAULT_PAGE_SIZE
    return {
      op: 'list',
      list: shape.rows.slice((page - 1) * size, (page - 1) * size + size),
      total: shape.total,
      page,
      size,
    }
  }

  /** get 语义糖（GET /app/data/record） */
  async getRecord(userId: bigint, dto: RecordQueryDto) {
    return this.query(userId, { appCode: dto.appCode, op: 'get', table: dto.table, rowId: dto.rowId })
  }

  /**
   * 公开面执行入口（P12 T110，铁律 5 复用 A 侧双路径执行器与护栏）。
   *
   * 调用方（PubDataService）已完成「应用已公开 + 表已暴露 + R104 参数白名单 + 字段白名单」校验，
   * 本方法只负责执行与护栏（50009），返回**未裁剪**行视图（含 n:n 多值与 expand），
   * 由调用方按 R101 白名单投影后输出。
   * - op=get：行不存在 → **40400**（公开面统一防探测码，D100；A 侧保持 50001 语义不变）；
   * - op=list：返回排序后的全量行与 total，分页由调用方切片。
   */
  async queryForPublic(
    app: AppDef,
    table: ResolvedTable,
    plan: {
      op: 'list' | 'get'
      rowId?: string
      filter?: QueryFilterDto[]
      sort?: QuerySortDto[]
      expand?: QueryExpandDto[]
    },
  ): Promise<{ rows: DataRowView[]; total: number }> {
    const started = Date.now()
    if (plan.op === 'get') {
      const row = plan.rowId ? await this.findRow(table, plan.rowId) : null
      if (!row) {
        throw new BusinessException(ErrorCode.NotFound, '资源不存在')
      }
      const views = await this.toViews(app, table, [row], plan.expand)
      await this.assertNotTimeout(started)
      return { rows: views, total: views.length }
    }
    const shape = await this.queryRows(app, table, {
      appCode: app.code,
      op: 'list',
      table: table.name,
      filter: plan.filter,
      sort: plan.sort,
      expand: plan.expand,
    })
    await this.assertNotTimeout(started)
    return shape
  }

  /**
   * 导出用全量拉取（CSV）：按 id 升序游标分批（1000/批），逐批附着多值 ref；
   * 达到 cap 即截断（truncated=true，导出尾注释行说明）。
   */
  async fetchAllRows(
    app: AppDef,
    table: ResolvedTable,
    cap: number,
  ): Promise<{ views: DataRowView[]; truncated: boolean }> {
    const views: DataRowView[] = []
    let cursor: bigint | undefined
    let truncated = false
    const BATCH = 1000
    for (;;) {
      const rows = await this.prisma.appRecord.findMany({
        where: { tableId: table.id, deletedAt: null },
        orderBy: { id: 'asc' },
        take: BATCH,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      })
      if (rows.length === 0) break
      cursor = rows[rows.length - 1].id
      const remain = cap - views.length
      const slice = rows.length > remain ? rows.slice(0, remain) : rows
      if (rows.length > remain) truncated = true
      views.push(...(await this.toViews(app, table, slice)))
      if (truncated) break
    }
    return { views, truncated }
  }

  /**
   * P13 R118：市场提交时读取演示数据（≤cap 行/表，超出即 truncated=true 由调用方 50015 拒绝）。
   * - 经 toViews 附着多值 ref（n:n 以 rowId[] 形式返回，供复制方按旧→新 rowId 重映射）；
   * - attachment 类型字段值**强制置 null**（文件不随复制迁移，R118）；
   * - 行本身就是「原样 JSON」，不做白名单裁剪（复制方仍经 DataService 写路径写入）。
   */
  async snapshotRows(
    app: AppDef,
    table: ResolvedTable,
    cap: number,
  ): Promise<{ rows: Array<{ rowId: string; data: Record<string, unknown> }>; truncated: boolean }> {
    const records = await this.prisma.appRecord.findMany({
      where: { tableId: table.id, deletedAt: null },
      orderBy: { id: 'asc' },
      take: cap + 1,
    })
    const truncated = records.length > cap
    const slice = truncated ? records.slice(0, cap) : records
    const views = await this.toViews(app, table, slice)
    const attachmentFields = new Set(
      table.fields.filter((field) => field.type === 'attachment').map((field) => field.name),
    )
    return {
      truncated,
      rows: views.map((view) => {
        const data: Record<string, unknown> = { ...view.data }
        for (const name of attachmentFields) {
          if (Object.prototype.hasOwnProperty.call(data, name)) data[name] = null
        }
        return { rowId: view.rowId, data }
      }),
    }
  }

  /**
   * 过滤 + 排序（返回已排序的全量行，分页由调用方切片）。
   * DB 路径（可全下推）走 where/orderBy；否则内存路径（硬上限 1 万行，超出 50009）。
   */
  private async queryRows(
    app: AppDef,
    table: ResolvedTable,
    dto: DataQueryDto,
  ): Promise<{ rows: DataRowView[]; total: number }> {
    const filters = dto.filter ?? []
    for (const filter of filters) {
      if (!table.fieldMap.has(filter.f)) {
        throw new BusinessException(ErrorCode.AppDataInvalid, `过滤字段不存在：${filter.f}`)
      }
    }
    const sorts = dto.sort ?? []
    for (const sort of sorts) {
      if (!table.fieldMap.has(sort.f)) {
        throw new BusinessException(ErrorCode.AppDataInvalid, `排序字段不存在：${sort.f}`)
      }
    }

    const dbEligible =
      filters.every((filter) => this.isDbFilter(table, filter)) &&
      sorts.every((sort) => this.isDbSort(table, sort))
    if (dbEligible) {
      const where = this.buildDbWhere(table, filters)
      const orderBy = sorts.length
        ? sorts.map((sort) => ({
            [this.indexColumn(table, sort.f)]: sort.dir,
          }))
        : [{ createdAt: 'desc' as const }]
      const [rows, total] = await Promise.all([
        this.prisma.appRecord.findMany({ where, orderBy, take: MEMORY_FILTER_CAP + 1 }),
        this.prisma.appRecord.count({ where }),
      ])
      if (rows.length > MEMORY_FILTER_CAP) {
        throw new BusinessException(ErrorCode.AppQueryGuardExceeded, '结果集过大，请增加筛选条件')
      }
      const views = await this.toViews(app, table, rows, dto.expand)
      return { rows: views, total }
    }

    // 内存路径：按索引拉取有界候选（createdAt desc 兜底），超上限即 50009
    const candidates = await this.prisma.appRecord.findMany({
      where: { tableId: table.id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: MEMORY_FILTER_CAP + 1,
    })
    if (candidates.length > MEMORY_FILTER_CAP) {
      throw new BusinessException(
        ErrorCode.AppQueryGuardExceeded,
        `非索引过滤命中数据过多（>${MEMORY_FILTER_CAP} 行），请增加筛选条件或缩小范围`,
      )
    }
    const filtered = candidates.filter((row) =>
      filters.every((filter) => this.matchFilter(table, row.data, filter)),
    )
    filtered.sort((a, b) => this.compareRows(table, a, b, sorts))
    const views = await this.toViews(app, table, filtered, dto.expand)
    return { rows: views, total: filtered.length }
  }

  // ==================== 写路径（R90，唯一入口） ====================

  /** 新建行（db 可为事务客户端） */
  async createRow(
    db: Db,
    app: AppDef,
    table: ResolvedTable,
    values: Record<string, unknown>,
    userId: bigint,
  ): Promise<{ id: bigint; rowId: string }> {
    const normalized = await this.normalizeValues(db, app, table, values, null, userId)
    const rowId = randomUUID()
    const row = await db.appRecord.create({
      data: {
        appId: app.id,
        tableId: table.id,
        rowId,
        data: normalized.data as Prisma.InputJsonValue,
        ...this.buildIndexColumns(table, normalized.data),
        createdBy: userId,
      },
    })
    await this.writeMultiRefs(db, app, table, row.id, normalized.multiRefs)
    await this.syncAttachments(db, app, table, row.id, normalized.attachments)
    return { id: row.id, rowId }
  }

  /**
   * P13 R119：单行独立事务写入（市场复制演示数据用）——错误行跳过由调用方 try/catch 承担，
   * 事务边界在此收口（照 ImportService 逐行事务先例）。
   */
  async createRowStandalone(
    app: AppDef,
    table: ResolvedTable,
    values: Record<string, unknown>,
    userId: bigint,
  ): Promise<{ id: bigint; rowId: string }> {
    return this.prisma.$transaction((tx) => this.createRow(tx, app, table, values, userId))
  }

  /** 更新行（部分字段；未提供字段保持原值） */  async updateRow(
    db: Db,
    app: AppDef,
    table: ResolvedTable,
    rowId: string,
    values: Record<string, unknown>,
    userId: bigint,
  ): Promise<{ id: bigint; rowId: string }> {
    const row = await db.appRecord.findFirst({
      where: { tableId: table.id, rowId, deletedAt: null },
    })
    if (!row) throw new BusinessException(ErrorCode.AppNotFound, '数据行不存在或无权')
    const existing = row.data as Record<string, unknown>
    const normalized = await this.normalizeValues(db, app, table, values, existing, userId)
    await db.appRecord.update({
      where: { id: row.id },
      data: {
        data: normalized.data as Prisma.InputJsonValue,
        ...this.buildIndexColumns(table, normalized.data),
      },
    })
    await this.writeMultiRefs(db, app, table, row.id, normalized.multiRefs)
    await this.syncAttachments(db, app, table, row.id, normalized.attachments)
    return { id: row.id, rowId }
  }

  /** 软删行（连带清附件引用与多值中间行） */
  async removeRow(
    db: Db,
    app: AppDef,
    table: ResolvedTable,
    rowId: string,
  ): Promise<{ id: bigint; rowId: string }> {
    const row = await db.appRecord.findFirst({
      where: { tableId: table.id, rowId, deletedAt: null },
    })
    if (!row) throw new BusinessException(ErrorCode.AppNotFound, '数据行不存在或无权')
    await db.appRecord.update({ where: { id: row.id }, data: { deletedAt: new Date() } })
    await db.appAttachmentRef.deleteMany({
      where: { appId: app.id, tableId: table.id, recordId: row.id },
    })
    await this.clearMultiRefs(db, app, table, row.id)
    return { id: row.id, rowId }
  }

  // ==================== 值校验与索引列 ====================

  /** 逐字段校验/归一（required/enum/ref/attachment 权属） */
  private async normalizeValues(
    db: Db,
    app: AppDef,
    table: ResolvedTable,
    values: Record<string, unknown>,
    existing: Record<string, unknown> | null,
    userId: bigint,
  ): Promise<NormalizedWrite> {
    const data: Record<string, unknown> = existing ? { ...existing } : {}
    const multiRefs = new Map<string, string[]>()
    const attachments = new Map<string, string | null>()
    const attachmentIds: string[] = []

    for (const field of table.fields) {
      const provided = Object.prototype.hasOwnProperty.call(values, field.name)
      let raw: unknown = provided ? values[field.name] : undefined
      if (!provided) {
        if (existing) raw = existing[field.name]
        else if (field.defaultVal !== null && field.defaultVal !== undefined) raw = field.defaultVal
      }

      const empty = raw === undefined || raw === null || raw === ''
      if (empty) {
        if (field.required && !(field.type === 'bool' && raw === false)) {
          throw new BusinessException(ErrorCode.AppDataInvalid, `字段「${field.label}」为必填`)
        }
        if (field.refMultiple) {
          multiRefs.set(field.name, [])
          continue
        }
        if (field.type === 'attachment') {
          attachments.set(field.name, null)
          data[field.name] = null
          continue
        }
        data[field.name] = null
        continue
      }

      if (field.refMultiple) {
        const ids = this.asRowIdArray(raw, field.label)
        await this.assertRefRows(db, app, field.refTableName, ids, field.label)
        multiRefs.set(field.name, ids)
        continue
      }

      switch (field.type) {
        case 'text':
          if (typeof raw !== 'string') {
            throw new BusinessException(ErrorCode.AppDataInvalid, `字段「${field.label}」应为文本`)
          }
          data[field.name] = raw
          break
        case 'number':
          if (typeof raw !== 'number' || !Number.isFinite(raw)) {
            throw new BusinessException(ErrorCode.AppDataInvalid, `字段「${field.label}」应为数字`)
          }
          data[field.name] = raw
          break
        case 'bool':
          if (typeof raw !== 'boolean') {
            throw new BusinessException(ErrorCode.AppDataInvalid, `字段「${field.label}」应为布尔值`)
          }
          data[field.name] = raw
          break
        case 'datetime': {
          if (typeof raw !== 'string' || Number.isNaN(Date.parse(raw))) {
            throw new BusinessException(ErrorCode.AppDataInvalid, `字段「${field.label}」应为合法日期时间`)
          }
          data[field.name] = new Date(raw).toISOString()
          break
        }
        case 'enum': {
          const allowed = new Set((field.enumOptions ?? []).map((option) => option.value))
          if (!allowed.has(String(raw))) {
            throw new BusinessException(ErrorCode.AppDataInvalid, `字段「${field.label}」取值不在枚举内`)
          }
          data[field.name] = String(raw)
          break
        }
        case 'attachment': {
          const fileId = this.asFileId(raw, field.label)
          attachmentIds.push(fileId)
          attachments.set(field.name, fileId)
          data[field.name] = fileId
          break
        }
        case 'ref': {
          const rowId = this.asRowId(raw, field.label)
          await this.assertRefRows(db, app, field.refTableName, [rowId], field.label)
          data[field.name] = rowId
          break
        }
        default:
          throw new BusinessException(ErrorCode.AppDataInvalid, `字段「${field.label}」类型不支持`)
      }
    }

    // 附件权属校验（批量一次，走 CloudFacade：文件必须属于当前用户且未删）
    if (attachmentIds.length > 0) {
      const alive = await this.cloudFacade.filterAliveFileIds(
        userId,
        attachmentIds.map((id) => BigInt(id)),
      )
      for (const fileId of attachmentIds) {
        if (!alive.has(fileId)) {
          throw new BusinessException(ErrorCode.AppDataInvalid, '附件文件不存在或无权访问')
        }
      }
    }

    return { data, multiRefs, attachments }
  }

  /** 生成 r_cN 冗余列（字段名 → 槽位按 sort 前 N 个） */
  private buildIndexColumns(
    table: ResolvedTable,
    data: Record<string, unknown>,
  ): Record<string, string | null> {
    const columns: Record<string, string | null> = {}
    for (const [name, slot] of table.indexSlots) {
      columns[`rC${slot}`] = this.toIndexString(data[name])
    }
    return columns
  }

  private toIndexString(value: unknown): string | null {
    if (value === null || value === undefined) return null
    const text = typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value)
    return text.length > 191 ? text.slice(0, 191) : text
  }

  private indexColumn(table: ResolvedTable, fieldName: string): string {
    const slot = table.indexSlots.get(fieldName)
    if (!slot) {
      throw new BusinessException(ErrorCode.AppQueryGuardExceeded, `字段「${fieldName}」非索引字段`)
    }
    return `rC${slot}`
  }

  private isDbFilter(table: ResolvedTable, filter: QueryFilterDto): boolean {
    if (!DB_FILTER_OPS.has(filter.op)) return false
    const field = table.fieldMap.get(filter.f)
    if (!field) return false
    // 数值字段的字符串比较语义不对 → 走内存
    if (field.type === 'number' && filter.op !== 'eq' && filter.op !== 'ne') return false
    return table.indexSlots.has(filter.f)
  }

  private isDbSort(table: ResolvedTable, sort: { f: string }): boolean {
    const field = table.fieldMap.get(sort.f)
    if (!field) return false
    if (field.type === 'number') return false
    return table.indexSlots.has(sort.f)
  }

  private buildDbWhere(
    table: ResolvedTable,
    filters: QueryFilterDto[],
  ): Prisma.AppRecordWhereInput {
    const where: Prisma.AppRecordWhereInput = { tableId: table.id, deletedAt: null }
    for (const filter of filters) {
      const column = this.indexColumn(table, filter.f)
      if (filter.op === 'eq') {
        Object.assign(where, { [column]: String(filter.v) })
      } else if (filter.op === 'ne') {
        Object.assign(where, { [column]: { not: String(filter.v) } })
      } else if (filter.op === 'contains') {
        Object.assign(where, { [column]: { contains: String(filter.v) } })
      } else if (filter.op === 'in') {
        const list = Array.isArray(filter.v) ? filter.v.map((item) => String(item)) : []
        Object.assign(where, { [column]: { in: list } })
      }
    }
    return where
  }

  /** 内存路径过滤（数值按数字比较；日期字符串按 ISO 字典序；文本 contains） */
  private matchFilter(
    table: ResolvedTable,
    rawData: Prisma.JsonValue,
    filter: QueryFilterDto,
  ): boolean {
    const field = table.fieldMap.get(filter.f)
    const data = rawData as Record<string, unknown>
    const value = data[filter.f]
    const target = filter.v
    switch (filter.op) {
      case 'eq':
        return value === target || String(value) === String(target)
      case 'ne':
        return !(value === target || String(value) === String(target))
      case 'contains':
        return value !== null && value !== undefined && String(value).includes(String(target))
      case 'in':
        return Array.isArray(target) && target.some((item) => String(item) === String(value))
      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte': {
        if (value === null || value === undefined) return false
        const cmp =
          field?.type === 'number'
            ? Number(value) - Number(target)
            : String(value).localeCompare(String(target))
        if (filter.op === 'gt') return cmp > 0
        if (filter.op === 'gte') return cmp >= 0
        if (filter.op === 'lt') return cmp < 0
        return cmp <= 0
      }
      default:
        return true
    }
  }

  private compareRows(
    table: ResolvedTable,
    a: AppRecord,
    b: AppRecord,
    sorts: Array<{ f: string; dir: 'asc' | 'desc' }>,
  ): number {
    if (sorts.length === 0) {
      const diff = b.createdAt.getTime() - a.createdAt.getTime()
      return diff
    }
    for (const sort of sorts) {
      const field = table.fieldMap.get(sort.f)
      const av = (a.data as Record<string, unknown>)[sort.f] as unknown
      const bv = (b.data as Record<string, unknown>)[sort.f] as unknown
      let cmp: number
      if (field?.type === 'number') cmp = Number(av) - Number(bv)
      else cmp = String(av ?? '').localeCompare(String(bv ?? ''))
      if (cmp !== 0) return sort.dir === 'asc' ? cmp : -cmp
    }
    return 0
  }

  private async assertNotTimeout(started: number): Promise<void> {
    const timeoutMs = this.config.get<number>('app.queryTimeoutMs', 2000)
    if (Date.now() - started > timeoutMs) {
      throw new BusinessException(
        ErrorCode.AppQueryGuardExceeded,
        `查询耗时超过 ${timeoutMs}ms 护栏，请缩小范围`,
      )
    }
  }

  // ==================== 行渲染（多值 ref 附着 + expand） ====================

  private async toView(app: AppDef, table: ResolvedTable, row: AppRecord): Promise<DataRowView> {
    const [view] = await this.toViews(app, table, [row])
    return view
  }

  /** 批量渲染：先附着多值 ref（n:n 中间表），再做 ref 展开（≤1 层） */
  private async toViews(
    app: AppDef,
    table: ResolvedTable,
    rows: AppRecord[],
    expand?: DataQueryDto['expand'],
  ): Promise<DataRowView[]> {
    if (rows.length === 0) return []
    const views: DataRowView[] = rows.map((row) => ({
      rowId: row.rowId,
      data: { ...(row.data as Record<string, unknown>) },
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }))
    await this.attachMultiRefs(app, table, views)
    if (expand && expand.length > 0) {
      await this.applyExpand(app, table, views, expand)
    }
    return views
  }

  /** 多值 ref：从中间表回填 data[field] = rowId[] */
  private async attachMultiRefs(
    app: AppDef,
    table: ResolvedTable,
    views: DataRowView[],
  ): Promise<void> {
    const multiFields = table.fields.filter((field) => field.refMultiple)
    if (multiFields.length === 0) return
    for (const field of multiFields) {
      const rel = await this.findRel(app.id, table.id, field.id)
      if (!rel) continue
      const parentIds = views.map((view) => view.rowId)
      const throughRows = await this.prisma.appRecord.findMany({
        where: { tableId: rel.throughTableId, deletedAt: null, rC1: { in: parentIds } },
        select: { rC1: true, rC2: true },
      })
      const map = new Map<string, string[]>()
      for (const through of throughRows) {
        if (!through.rC1 || !through.rC2) continue
        const list = map.get(through.rC1) ?? []
        list.push(through.rC2)
        map.set(through.rC1, list)
      }
      for (const view of views) {
        view.data[field.name] = map.get(view.rowId) ?? []
      }
    }
  }

  /** ref 展开（≤1 层）：单值 ref 出对象，多值出对象数组 */
  private async applyExpand(
    app: AppDef,
    table: ResolvedTable,
    views: DataRowView[],
    expand: NonNullable<DataQueryDto['expand']>,
  ): Promise<void> {
    for (const item of expand) {
      const field = table.fieldMap.get(item.f)
      if (!field || field.type !== 'ref' || !field.refTableName) continue
      const target = await this.schemaService.resolveTableByName(app.id, field.refTableName)
      if (field.refMultiple) {
        const ids = new Set<string>()
        for (const view of views) {
          const list = view.data[field.name]
          if (Array.isArray(list)) list.forEach((id) => typeof id === 'string' && ids.add(id))
        }
        const map = await this.loadRows(target, [...ids])
        for (const view of views) {
          const list = view.data[field.name]
          if (!Array.isArray(list)) continue
          view.expanded = view.expanded ?? {}
          view.expanded[field.name] = list
            .map((id) => map.get(String(id)))
            .filter((row): row is DataRowView => Boolean(row))
            .map((row) => this.projectFields(row, item.fields))
        }
      } else {
        const ids = new Set<string>()
        for (const view of views) {
          const id = view.data[field.name]
          if (typeof id === 'string' && id) ids.add(id)
        }
        const map = await this.loadRows(target, [...ids])
        for (const view of views) {
          const id = view.data[field.name]
          if (typeof id !== 'string') continue
          const row = map.get(id)
          if (!row) continue
          view.expanded = view.expanded ?? {}
          view.expanded[field.name] = this.projectFields(row, item.fields)
        }
      }
    }
  }

  private projectFields(row: DataRowView, fields?: string[]): Record<string, unknown> {
    if (!fields || fields.length === 0) return { rowId: row.rowId, ...row.data }
    const projected: Record<string, unknown> = { rowId: row.rowId }
    for (const name of fields) {
      projected[name] = name === 'rowId' ? row.rowId : row.data[name]
    }
    return projected
  }

  private async loadRows(table: ResolvedTable, rowIds: string[]): Promise<Map<string, DataRowView>> {
    if (rowIds.length === 0) return new Map()
    const rows = await this.prisma.appRecord.findMany({
      where: { tableId: table.id, rowId: { in: rowIds }, deletedAt: null },
    })
    const views = await this.toViewsRaw(rows)
    return new Map(views.map((view) => [view.rowId, view]))
  }

  /** 展开目标行不再递归展开（≤1 层） */
  private async toViewsRaw(rows: AppRecord[]): Promise<DataRowView[]> {
    return rows.map((row) => ({
      rowId: row.rowId,
      data: { ...(row.data as Record<string, unknown>) },
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }))
  }

  // ==================== 多值 ref / 附件引用维护 ====================

  private async findRel(appId: bigint, fromTableId: bigint, fromFieldId: bigint) {
    return this.prisma.appRel.findFirst({
      where: { appId, fromTableId, fromFieldId, deletedAt: null },
    })
  }

  /** 差量重写多值 ref：删旧中间行 → 按当前值插新中间行 */
  private async writeMultiRefs(
    db: Db,
    app: AppDef,
    table: ResolvedTable,
    recordId: bigint,
    multiRefs: Map<string, string[]>,
  ): Promise<void> {
    for (const [fieldName, ids] of multiRefs) {
      const field = table.fieldMap.get(fieldName)
      if (!field || !field.refMultiple) continue
      const rel = await db.appRel.findFirst({
        where: { appId: app.id, fromTableId: table.id, fromFieldId: field.id, deletedAt: null },
      })
      if (!rel) {
        throw new BusinessException(ErrorCode.AppDataInvalid, `多值关联字段「${field.label}」缺少关系定义`)
      }
      const parent = await db.appRecord.findUnique({ where: { id: recordId } })
      if (!parent) continue
      await db.appRecord.deleteMany({
        where: { tableId: rel.throughTableId, rC1: parent.rowId },
      })
      for (const toRowId of ids) {
        await db.appRecord.create({
          data: {
            appId: app.id,
            tableId: rel.throughTableId,
            rowId: randomUUID(),
            data: { [REL_FROM_FIELD]: parent.rowId, [REL_TO_FIELD]: toRowId },
            rC1: parent.rowId,
            rC2: toRowId,
          },
        })
      }
    }
  }

  private async clearMultiRefs(
    db: Db,
    app: AppDef,
    table: ResolvedTable,
    recordId: bigint,
  ): Promise<void> {
    const row = await db.appRecord.findUnique({ where: { id: recordId } })
    if (!row) return
    for (const field of table.fields.filter((item) => item.refMultiple)) {
      const rel = await db.appRel.findFirst({
        where: { appId: app.id, fromTableId: table.id, fromFieldId: field.id, deletedAt: null },
      })
      if (!rel) continue
      await db.appRecord.deleteMany({ where: { tableId: rel.throughTableId, rC1: row.rowId } })
    }
  }

  /** 重写附件引用（差量：先清该行全部字段引用，再按最终值插入） */
  private async syncAttachments(
    db: Db,
    app: AppDef,
    table: ResolvedTable,
    recordId: bigint,
    attachments: Map<string, string | null>,
  ): Promise<void> {
    if (attachments.size === 0) return
    await db.appAttachmentRef.deleteMany({
      where: { appId: app.id, tableId: table.id, recordId },
    })
    for (const [fieldName, fileId] of attachments) {
      if (!fileId) continue
      await db.appAttachmentRef.create({
        data: {
          appId: app.id,
          tableId: table.id,
          recordId,
          fieldName,
          fileId: BigInt(fileId),
        },
      })
    }
  }

  // ==================== 小工具 ====================

  private async findRow(table: ResolvedTable, rowId: string): Promise<AppRecord | null> {
    if (!rowId) throw new BusinessException(ErrorCode.ParamInvalid, '缺少 rowId')
    return this.prisma.appRecord.findFirst({
      where: { tableId: table.id, rowId, deletedAt: null },
    })
  }

  private async assertRefRows(
    db: Db,
    app: AppDef,
    refTableName: string | null,
    rowIds: string[],
    label: string,
  ): Promise<void> {
    if (!refTableName) {
      throw new BusinessException(ErrorCode.AppDataInvalid, `字段「${label}」缺少关联目标`)
    }
    if (rowIds.length === 0) return
    const target = await this.schemaService.resolveTableByName(app.id, refTableName)
    const found = await db.appRecord.count({
      where: { tableId: target.id, rowId: { in: rowIds }, deletedAt: null },
    })
    if (found !== new Set(rowIds).size) {
      throw new BusinessException(ErrorCode.AppDataInvalid, `字段「${label}」关联的数据不存在`)
    }
  }

  private asRowId(raw: unknown, label: string): string {
    if (typeof raw !== 'string' || !raw.trim()) {
      throw new BusinessException(ErrorCode.AppDataInvalid, `字段「${label}」关联值非法`)
    }
    return raw.trim()
  }

  private asRowIdArray(raw: unknown, label: string): string[] {
    if (!Array.isArray(raw)) {
      throw new BusinessException(ErrorCode.AppDataInvalid, `字段「${label}」应为 rowId 数组`)
    }
    const ids = raw.map((item) => this.asRowId(item, label))
    return [...new Set(ids)]
  }

  private asFileId(raw: unknown, label: string): string {
    const text = typeof raw === 'number' ? String(raw) : raw
    if (typeof text !== 'string' || !/^\d+$/.test(text)) {
      throw new BusinessException(ErrorCode.AppDataInvalid, `字段「${label}」附件 fileId 非法`)
    }
    return text
  }
}
