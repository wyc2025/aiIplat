import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { AppDef, AppField, AppTable, Prisma } from '@prisma/client'
import { ErrorCode } from '../../../common/constants/error-code'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import { RedisService } from '../../../infra/redis/redis.service'
import { AdminService } from '../admin/admin.service'
import {
  APP_FIELD_TYPES,
  REL_FROM_FIELD,
  REL_TO_FIELD,
  isAppFieldType,
  type AppFieldType,
} from './schema.constants'
import { APP_SCHEMA_CACHE_TTL_SEC, invalidateAppSchema } from './schema.cache'
import type {
  AppEnumOption,
  AppFieldView,
  AppPageView,
  AppRelationView,
  AppSchemaBundle,
  AppTableView,
  ResolvedTable,
} from './schema.types'
import type {
  CreateFieldDto,
  CreateRelationDto,
  CreateTableDto,
  FieldDefDto,
  ShrinkFieldDto,
  UpdateFieldDto,
  UpdateTableDto,
} from './dto/schema.dto'

/** 枚举选项 JSON → 规范化数组（容错：非数组/非法项一律忽略） */
function normalizeEnumOptions(value: unknown): AppEnumOption[] | null {
  if (!Array.isArray(value)) return null
  const options: AppEnumOption[] = []
  for (const item of value) {
    if (item && typeof item === 'object' && 'value' in item) {
      const option = item as { value?: unknown; label?: unknown }
      if (typeof option.value === 'string') {
        options.push({
          value: option.value,
          label: typeof option.label === 'string' ? option.label : option.value,
        })
      }
    }
  }
  return options.length > 0 ? options : null
}

/**
 * 结构管理服务（P11 T102，API-P11 §1.2 / ARCHITECTURE-P11 §4）：
 * 表/字段/关系 CRUD + n:n 中间表自动生成（R89）+ 结构变更规则（D95）+ schema 全量打包与缓存（R99）。
 *
 * 结构变更软着陆（D95）：删表/删字段 = 软删（数据保留）；类型收窄先跑存量校验（50003 带违规 rowId）；
 * 加字段/加表随时允许；不做物理删列。软删时释放唯一槽（name → __deleted_{id}，用户不可见）。
 */
@Injectable()
export class SchemaService {
  private readonly logger = new Logger(SchemaService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly adminService: AdminService,
  ) {}

  // ==================== schema 全量打包 ====================

  /** GET /app/:code/schema：def + tables(含 fields) + relations + pages，Redis 缓存（R99） */
  async getSchema(userId: bigint, code: string): Promise<AppSchemaBundle> {
    const app = await this.adminService.assertOwned(userId, code)
    const cacheKey = `app:schema:${app.id.toString()}`
    const cached = await this.redis.client.get(cacheKey).catch(() => null)
    if (cached) {
      try {
        return JSON.parse(cached) as AppSchemaBundle
      } catch {
        // 缓存损坏：忽略，回源
      }
    }
    const bundle = await this.buildSchema(app)
    await this.redis.client
      .set(cacheKey, JSON.stringify(bundle), 'EX', APP_SCHEMA_CACHE_TTL_SEC)
      .catch(() => undefined)
    return bundle
  }

  /** 组装 schema 全量打包（不含缓存读写） */
  async buildSchema(app: AppDef): Promise<AppSchemaBundle> {
    const [tables, rels, pages] = await Promise.all([
      this.prisma.appTable.findMany({
        where: { appId: app.id, deletedAt: null },
        orderBy: { id: 'asc' },
      }),
      this.prisma.appRel.findMany({ where: { appId: app.id, deletedAt: null } }),
      this.prisma.appPage.findMany({
        where: { appId: app.id, deletedAt: null },
        orderBy: [{ sort: 'asc' }, { id: 'asc' }],
      }),
    ])
    const tableIds = tables.map((table) => table.id)
    const fields = tableIds.length
      ? await this.prisma.appField.findMany({
          where: { tableId: { in: tableIds }, isDeleted: 0 },
          orderBy: [{ sort: 'asc' }, { id: 'asc' }],
        })
      : []
    const nameOfTable = new Map(tables.map((table) => [table.id.toString(), table.name]))
    const tableViews: AppTableView[] = tables.map((table) => ({
      id: table.id.toString(),
      name: table.name,
      label: table.label,
      isSystem: table.isSystem === 1,
      fields: fields
        .filter((field) => field.tableId === table.id)
        .map((field) => this.toFieldView(field, nameOfTable)),
    }))
    const relationViews: AppRelationView[] = rels.map((rel) => ({
      id: rel.id.toString(),
      type: rel.type,
      fromTable: nameOfTable.get(rel.fromTableId.toString()) ?? '',
      fromField: fields.find((field) => field.id === rel.fromFieldId)?.name ?? '',
      toTable: nameOfTable.get(rel.toTableId.toString()) ?? '',
      throughTable: nameOfTable.get(rel.throughTableId.toString()) ?? '',
    }))
    const pageViews: AppPageView[] = pages.map((page) => ({
      id: page.id.toString(),
      code: page.code,
      name: page.name,
      route: page.route,
      kind: page.kind,
      genBy: page.genBy,
      sort: page.sort,
      schema: page.schema,
    }))
    return {
      app: {
        appCode: app.code,
        pubCode: app.pubCode,
        name: app.name,
        description: app.description,
        status: app.status,
      },
      tables: tableViews,
      relations: relationViews,
      pages: pageViews,
    }
  }

  /**
   * 解析逻辑表为写入/查询用的 ResolvedTable（DataService 唯一入口用）。
   * 含字段定义、软删过滤、r_cN 索引槽位（按 sort 取前 N 个）。
   */
  async resolveTableByName(appId: bigint, tableName: string): Promise<ResolvedTable> {
    const table = await this.prisma.appTable.findFirst({
      where: { appId, name: tableName, deletedAt: null },
    })
    if (!table) throw new BusinessException(ErrorCode.AppNotFound, `逻辑表不存在：${tableName}`)
    return this.resolveTable(table, appId)
  }

  /** 列出应用全部逻辑表（含系统中间表；按 id 升序）——功能页生成/校验用 */
  async listResolvedTables(appId: bigint): Promise<ResolvedTable[]> {
    const tables = await this.prisma.appTable.findMany({
      where: { appId, deletedAt: null },
      orderBy: { id: 'asc' },
    })
    const resolved: ResolvedTable[] = []
    for (const table of tables) {
      resolved.push(await this.resolveTable(table, appId))
    }
    return resolved
  }

  /** 按 id 解析逻辑表（须属该应用） */
  async resolveTableById(appId: bigint, tableId: bigint): Promise<ResolvedTable> {
    const table = await this.prisma.appTable.findFirst({
      where: { id: tableId, appId, deletedAt: null },
    })
    if (!table) throw new BusinessException(ErrorCode.AppNotFound, '逻辑表不存在')
    return this.resolveTable(table, appId)
  }

  private async resolveTable(table: AppTable, appId: bigint): Promise<ResolvedTable> {
    const fields = await this.prisma.appField.findMany({
      where: { tableId: table.id, isDeleted: 0 },
      orderBy: [{ sort: 'asc' }, { id: 'asc' }],
    })
    const refTableIds = fields
      .map((field) => field.refTableId)
      .filter((id): id is bigint => id !== null)
    const refTables = refTableIds.length
      ? await this.prisma.appTable.findMany({
          where: { id: { in: refTableIds } },
          select: { id: true, name: true },
        })
      : []
    const nameOfTable = new Map(refTables.map((row) => [row.id.toString(), row.name]))
    const maxSlots = this.config.get<number>('app.hotIndexFieldsPerTable', 5)
    const indexSlots = new Map<string, number>()
    fields.slice(0, maxSlots).forEach((field, index) => {
      indexSlots.set(field.name, index + 1)
    })
    const resolvedFields = fields.map((field) => ({
      id: field.id,
      name: field.name,
      label: field.label,
      type: field.type as AppFieldType,
      required: field.required === 1,
      defaultVal: field.defaultVal as unknown,
      enumOptions: normalizeEnumOptions(field.enumOptions),
      refTableId: field.refTableId,
      refTableName: field.refTableId ? (nameOfTable.get(field.refTableId.toString()) ?? null) : null,
      refMultiple: field.refMultiple === 1,
      sort: field.sort,
    }))
    return {
      id: table.id,
      appId,
      name: table.name,
      label: table.label,
      isSystem: table.isSystem === 1,
      fields: resolvedFields,
      fieldMap: new Map(resolvedFields.map((field) => [field.name, field])),
      indexSlots,
    }
  }

  // ==================== 表 ====================

  /** 建表（含初始字段）；超 20 表 50002；字段类型非法 50005 */
  async createTable(userId: bigint, code: string, dto: CreateTableDto) {
    const app = await this.adminService.assertOwned(userId, code)
    const count = await this.prisma.appTable.count({
      where: { appId: app.id, isSystem: 0, deletedAt: null },
    })
    const maxTables = this.config.get<number>('app.maxTablesPerApp', 20)
    if (count >= maxTables) {
      throw new BusinessException(ErrorCode.AppQuotaExceeded, `逻辑表数量已达上限（${maxTables} 个）`)
    }
    await this.assertTableNameFree(app.id, dto.name)
    const fields = dto.fields ?? []
    this.assertFieldsValid(fields)
    await this.assertFieldNamesUnique(fields.map((field) => field.name))

    const table = await this.prisma.appTable.create({
      data: { appId: app.id, name: dto.name, label: dto.label, isSystem: 0 },
    })
    try {
      if (fields.length > 0) {
        await this.insertFields(app, table, fields)
      }
    } catch (error) {
      // 建表失败：物理回滚刚建的表（无数据、无外键，直接物理删）
      await this.prisma.appTable.delete({ where: { id: table.id } }).catch(() => undefined)
      throw error
    }
    await invalidateAppSchema(this.redis, app.id)
    return { ok: true, table: table.name, created: fields.map((field) => field.name) }
  }

  /** 改表（v1 仅 label） */
  async updateTable(userId: bigint, code: string, tableId: bigint, dto: UpdateTableDto) {
    const app = await this.adminService.assertOwned(userId, code)
    const table = await this.requireTable(app.id, tableId)
    await this.prisma.appTable.update({ where: { id: table.id }, data: { label: dto.label } })
    await invalidateAppSchema(this.redis, app.id)
    return { ok: true, table: table.name, label: dto.label }
  }

  /** 删表（软删；系统表 50001；被引用阻断 50003 并列出引用方） */
  async deleteTable(userId: bigint, code: string, tableId: bigint) {
    const app = await this.adminService.assertOwned(userId, code)
    const table = await this.requireTable(app.id, tableId)
    if (table.isSystem === 1) {
      throw new BusinessException(ErrorCode.AppNotFound, '系统表不可删除')
    }
    // 引用检查：其它表的 ref 字段指向它 / n:n 关系涉及它
    const refFields = await this.prisma.appField.findMany({
      where: { refTableId: table.id, isDeleted: 0, tableId: { not: table.id } },
    })
    const involvedTables = refFields.length
      ? await this.prisma.appTable.findMany({
          where: { id: { in: refFields.map((field) => field.tableId) } },
          select: { name: true },
        })
      : []
    const refTableNames = involvedTables.map((row) => row.name)
    if (refTableNames.length > 0) {
      throw new BusinessException(
        ErrorCode.AppSchemaShrinkInvalid,
        `表「${table.name}」被以下表引用，请先处理引用：${refTableNames.join('、')}`,
      )
    }
    await this.softDeleteTable(app, table)
    await invalidateAppSchema(this.redis, app.id)
    return { ok: true, table: table.name }
  }

  // ==================== 字段 ====================

  /** 加字段（字段名表内唯一） */
  async addField(userId: bigint, code: string, tableId: bigint, dto: CreateFieldDto) {
    const app = await this.adminService.assertOwned(userId, code)
    const table = await this.requireTable(app.id, tableId)
    if (table.isSystem === 1) {
      throw new BusinessException(ErrorCode.AppNotFound, '系统表不可修改字段')
    }
    await this.assertFieldNameFree(table.id, dto.name)
    this.assertFieldValid(dto)
    await this.assertRefTarget(app.id, dto)
    const field = await this.insertField(app, table, dto)
    await invalidateAppSchema(this.redis, app.id)
    return { ok: true, field: field.name, created: [field.name] }
  }

  /** 改字段（label/必填/默认值/枚举选项） */
  async updateField(userId: bigint, code: string, fieldId: bigint, dto: UpdateFieldDto) {
    const app = await this.adminService.assertOwned(userId, code)
    const field = await this.requireField(app.id, fieldId)
    const data: Prisma.AppFieldUpdateInput = {}
    if (dto.label !== undefined) data.label = dto.label
    if (dto.required !== undefined) data.required = dto.required
    if (dto.enumOptions !== undefined) {
      if (field.type !== 'enum') {
        throw new BusinessException(ErrorCode.AppDataInvalid, '仅 enum 字段可改枚举选项')
      }
      data.enumOptions = dto.enumOptions as unknown as Prisma.InputJsonValue
    }
    if (dto.default !== undefined) {
      this.assertDefaultValid(field.type as AppFieldType, dto.default, normalizeEnumOptions(field.enumOptions))
      data.defaultVal = (dto.default ?? null) as Prisma.InputJsonValue
    }
    if (Object.keys(data).length === 0) {
      throw new BusinessException(ErrorCode.ParamInvalid, '没有需要更新的字段')
    }
    await this.prisma.appField.update({ where: { id: field.id }, data })
    await invalidateAppSchema(this.redis, app.id)
    return { ok: true, field: field.name }
  }

  /** 删字段（软删 D95：is_deleted=1，数据保留；释放唯一槽） */
  async deleteField(userId: bigint, code: string, fieldId: bigint) {
    const app = await this.adminService.assertOwned(userId, code)
    const field = await this.requireField(app.id, fieldId)
    const table = await this.prisma.appTable.findFirst({ where: { id: field.tableId } })
    if (table?.isSystem === 1 && field.name !== REL_FROM_FIELD && field.name !== REL_TO_FIELD) {
      throw new BusinessException(ErrorCode.AppNotFound, '系统表字段不可删除')
    }
    await this.prisma.appField.update({
      where: { id: field.id },
      data: {
        isDeleted: 1,
        deletedAt: new Date(),
        // 释放唯一槽（用户不可见；保留 label 便于回溯）
        name: `__deleted_${field.id.toString()}`,
      },
    })
    await invalidateAppSchema(this.redis, app.id)
    return { ok: true, field: field.name }
  }

  /** 类型收窄（text/number → enum）：先跑存量校验，不合规 50003（带前 10 个 rowId） */
  async shrinkField(userId: bigint, code: string, fieldId: bigint, dto: ShrinkFieldDto) {
    const app = await this.adminService.assertOwned(userId, code)
    const field = await this.requireField(app.id, fieldId)
    if (field.type !== 'text' && field.type !== 'number') {
      throw new BusinessException(ErrorCode.AppDataInvalid, '仅 text/number 字段支持收窄为 enum')
    }
    const allowed = new Set(dto.enumOptions.map((option) => option.value))
    const violations: string[] = []
    const BATCH = 500
    let cursor: bigint | undefined
    for (;;) {
      const rows = await this.prisma.appRecord.findMany({
        where: { tableId: field.tableId, deletedAt: null },
        select: { id: true, rowId: true, data: true },
        orderBy: { id: 'asc' },
        take: BATCH,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      })
      if (rows.length === 0) break
      cursor = rows[rows.length - 1].id
      for (const row of rows) {
        const value = (row.data as Record<string, unknown>)[field.name]
        if (value === null || value === undefined || value === '') continue
        if (!allowed.has(String(value))) {
          violations.push(row.rowId)
          if (violations.length >= 10) break
        }
      }
      if (violations.length >= 10) break
    }
    if (violations.length > 0) {
      throw new BusinessException(
        ErrorCode.AppSchemaShrinkInvalid,
        `存量数据不符合枚举取值，前 ${violations.length} 条违规行：${violations.join('、')}`,
      )
    }
    this.assertDefaultValid('enum', field.defaultVal as unknown, dto.enumOptions)
    await this.prisma.appField.update({
      where: { id: field.id },
      data: {
        type: 'enum',
        enumOptions: dto.enumOptions as unknown as Prisma.InputJsonValue,
      },
    })
    await invalidateAppSchema(this.redis, app.id)
    return { ok: true, field: field.name, type: 'enum' }
  }

  // ==================== 关系（n:n） ====================

  /** 建 n:n（自动生成中间表 isSystem；幂等：重复建返回现存） */
  async createRelation(userId: bigint, code: string, dto: CreateRelationDto) {
    const app = await this.adminService.assertOwned(userId, code)
    const fromTable = await this.requireTableByName(app.id, dto.fromTable)
    const toTable = await this.requireTableByName(app.id, dto.toTable)
    if (fromTable.id === toTable.id) {
      throw new BusinessException(ErrorCode.AppDataInvalid, '不支持自关联（fromTable 与 toTable 相同）')
    }
    // 解析/创建源表上的多值 ref 字段
    let fromField = await this.prisma.appField.findFirst({
      where: { tableId: fromTable.id, name: dto.fromField, isDeleted: 0 },
    })
    if (fromField) {
      if (fromField.type !== 'ref' || fromField.refTableId !== toTable.id) {
        throw new BusinessException(
          ErrorCode.AppDataInvalid,
          `字段「${dto.fromField}」已存在且不是指向「${toTable.name}」的 ref 字段`,
        )
      }
    }
    // 幂等：同 (fromTable,fromField,toTable) 关系已存在 → 直接返回
    if (fromField) {
      const existing = await this.prisma.appRel.findFirst({
        where: {
          appId: app.id,
          fromTableId: fromTable.id,
          fromFieldId: fromField.id,
          toTableId: toTable.id,
          deletedAt: null,
        },
      })
      if (existing) {
        const through = await this.prisma.appTable.findFirst({
          where: { id: existing.throughTableId },
        })
        return { ok: true, relation: existing.type, throughTable: through?.name ?? '' }
      }
    }

    // 中间表：rel_{from}_{to}（唯一名，冲突加序号）
    const throughName = await this.uniqueRelationTableName(
      app.id,
      `rel_${fromTable.name}_${toTable.name}`,
    )
    const through = await this.prisma.appTable.create({
      data: {
        appId: app.id,
        name: throughName,
        label: `${fromTable.label}↔${toTable.label}`,
        isSystem: 1,
      },
    })
    try {
      await this.prisma.appField.createMany({
        data: [
          {
            tableId: through.id,
            name: REL_FROM_FIELD,
            label: `${fromTable.label}ID`,
            type: 'ref',
            refTableId: fromTable.id,
            refMultiple: 0,
            sort: 1,
          },
          {
            tableId: through.id,
            name: REL_TO_FIELD,
            label: `${toTable.label}ID`,
            type: 'ref',
            refTableId: toTable.id,
            refMultiple: 0,
            sort: 2,
          },
        ],
      })
      if (fromField) {
        await this.prisma.appField.update({
          where: { id: fromField.id },
          data: { refMultiple: 1 },
        })
      } else {
        const sortMax = await this.prisma.appField.aggregate({
          where: { tableId: fromTable.id, isDeleted: 0 },
          _max: { sort: true },
        })
        fromField = await this.prisma.appField.create({
          data: {
            tableId: fromTable.id,
            name: dto.fromField,
            label: dto.fromField,
            type: 'ref',
            refTableId: toTable.id,
            refMultiple: 1,
            sort: (sortMax._max.sort ?? 0) + 1,
          },
        })
      }
      await this.prisma.appRel.create({
        data: {
          appId: app.id,
          fromTableId: fromTable.id,
          fromFieldId: fromField.id,
          toTableId: toTable.id,
          type: 'nm',
          throughTableId: through.id,
        },
      })
    } catch (error) {
      await this.prisma.appTable.delete({ where: { id: through.id } }).catch(() => undefined)
      throw error
    }
    await invalidateAppSchema(this.redis, app.id)
    return { ok: true, relation: 'nm', throughTable: through.name }
  }

  // ==================== 内部：校验与写入 ====================

  /** 字段定义数组校验（建表内嵌） */
  private assertFieldsValid(fields: FieldDefDto[]): void {
    for (const field of fields) this.assertFieldValid(field)
  }

  /** 单字段定义校验（类型白名单/enum 选项/ref 目标），非法统一 50005 */
  private assertFieldValid(field: FieldDefDto): void {
    if (!isAppFieldType(field.type)) {
      throw new BusinessException(
        ErrorCode.AppDataInvalid,
        `字段「${field.name}」类型不在白名单内：${field.type}（允许 ${APP_FIELD_TYPES.join('/')}）`,
      )
    }
    if (field.type === 'enum' && (!field.enumOptions || field.enumOptions.length === 0)) {
      throw new BusinessException(ErrorCode.AppDataInvalid, `枚举字段「${field.name}」必须提供 enumOptions`)
    }
    if (field.type === 'ref' && !field.refTable) {
      throw new BusinessException(ErrorCode.AppDataInvalid, `关联字段「${field.name}」必须提供 refTable`)
    }
    if (field.type !== 'ref' && field.refTable) {
      throw new BusinessException(ErrorCode.AppDataInvalid, `字段「${field.name}」非 ref 类型，不接受 refTable`)
    }
    if (field.type === 'ref' && field.refMultiple === 1) {
      // 多值 ref 必须由 set_relation 建立（需中间表），此处拒绝避免半成品
      throw new BusinessException(
        ErrorCode.AppDataInvalid,
        `多值关联字段「${field.name}」请改用「新建关系」创建（自动生成中间表）`,
      )
    }
    if (field.default !== undefined && field.default !== null) {
      this.assertDefaultValid(field.type as AppFieldType, field.default, field.enumOptions ?? null)
    }
  }

  /** 字段名在一个请求内不重复 */
  private async assertFieldNamesUnique(names: string[]): Promise<void> {
    const seen = new Set<string>()
    for (const name of names) {
      if (seen.has(name)) {
        throw new BusinessException(ErrorCode.AppDataInvalid, `字段名重复：${name}`)
      }
      seen.add(name)
    }
  }

  /** 默认值按字段类型校验（不合规 50005） */
  private assertDefaultValid(
    type: AppFieldType,
    value: unknown,
    enumOptions: AppEnumOption[] | null,
  ): void {
    if (value === null || value === undefined) return
    switch (type) {
      case 'text':
        if (typeof value !== 'string') throw new BusinessException(ErrorCode.AppDataInvalid, '文本字段默认值必须是字符串')
        break
      case 'number':
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          throw new BusinessException(ErrorCode.AppDataInvalid, '数字字段默认值必须是数字')
        }
        break
      case 'bool':
        if (typeof value !== 'boolean') throw new BusinessException(ErrorCode.AppDataInvalid, '布尔字段默认值必须是 true/false')
        break
      case 'datetime':
        if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
          throw new BusinessException(ErrorCode.AppDataInvalid, '日期字段默认值必须是合法日期字符串')
        }
        break
      case 'enum': {
        const allowed = new Set((enumOptions ?? []).map((option) => option.value))
        if (!allowed.has(String(value))) {
          throw new BusinessException(ErrorCode.AppDataInvalid, '枚举字段默认值不在选项内')
        }
        break
      }
      default:
        throw new BusinessException(ErrorCode.AppDataInvalid, `${type} 类型字段不支持默认值`)
    }
  }

  private async assertRefTarget(appId: bigint, field: FieldDefDto): Promise<void> {
    if (field.type !== 'ref' || !field.refTable) return
    const target = await this.prisma.appTable.findFirst({
      where: { appId, name: field.refTable, deletedAt: null },
    })
    if (!target) {
      throw new BusinessException(ErrorCode.AppDataInvalid, `关联目标表不存在：${field.refTable}`)
    }
    if (target.isSystem === 1) {
      throw new BusinessException(ErrorCode.AppDataInvalid, '不允许关联系统表')
    }
  }

  private async insertFields(app: AppDef, table: AppTable, fields: FieldDefDto[]): Promise<void> {
    for (const field of fields) {
      await this.insertField(app, table, field)
    }
  }

  private async insertField(app: AppDef, table: AppTable, field: FieldDefDto): Promise<AppField> {
    await this.assertRefTarget(app.id, field)
    const sortMax = await this.prisma.appField.aggregate({
      where: { tableId: table.id, isDeleted: 0 },
      _max: { sort: true },
    })
    let refTableId: bigint | null = null
    if (field.type === 'ref' && field.refTable) {
      const target = await this.prisma.appTable.findFirst({
        where: { appId: app.id, name: field.refTable, deletedAt: null },
        select: { id: true },
      })
      refTableId = target?.id ?? null
    }
    return this.prisma.appField.create({
      data: {
        tableId: table.id,
        name: field.name,
        label: field.label,
        type: field.type,
        required: field.required ?? 0,
        defaultVal: (field.default ?? null) as Prisma.InputJsonValue,
        enumOptions: field.enumOptions
          ? (field.enumOptions as unknown as Prisma.InputJsonValue)
          : undefined,
        refTableId,
        refMultiple: 0,
        sort: (sortMax._max.sort ?? 0) + 1,
      },
    })
  }

  /** 表名释放/占用检查（含软删行，避免撞 DB 唯一索引） */
  private async assertTableNameFree(appId: bigint, name: string): Promise<void> {
    const exists = await this.prisma.appTable.findFirst({ where: { appId, name } })
    if (exists) {
      throw new BusinessException(ErrorCode.AppDataInvalid, `表名已存在：${name}`)
    }
  }

  private async assertFieldNameFree(tableId: bigint, name: string): Promise<void> {
    const exists = await this.prisma.appField.findFirst({ where: { tableId, name } })
    if (exists) {
      throw new BusinessException(ErrorCode.AppDataInvalid, `字段名已存在：${name}`)
    }
  }

  private async requireTable(appId: bigint, tableId: bigint): Promise<AppTable> {
    const table = await this.prisma.appTable.findFirst({
      where: { id: tableId, appId, deletedAt: null },
    })
    if (!table) throw new BusinessException(ErrorCode.AppNotFound, '逻辑表不存在或无权')
    return table
  }

  private async requireTableByName(appId: bigint, name: string): Promise<AppTable> {
    const table = await this.prisma.appTable.findFirst({
      where: { appId, name, deletedAt: null },
    })
    if (!table) throw new BusinessException(ErrorCode.AppNotFound, `逻辑表不存在：${name}`)
    return table
  }

  private async requireField(appId: bigint, fieldId: bigint): Promise<AppField> {
    const field = await this.prisma.appField.findFirst({
      where: { id: fieldId, isDeleted: 0 },
    })
    if (!field) throw new BusinessException(ErrorCode.AppNotFound, '字段不存在或无权')
    const table = await this.prisma.appTable.findFirst({
      where: { id: field.tableId, appId, deletedAt: null },
    })
    if (!table) throw new BusinessException(ErrorCode.AppNotFound, '字段不存在或无权')
    return field
  }

  /** 软删表：释放唯一槽 + 级联软删字段 + 摘除相关关系（含其自动中间表） */
  private async softDeleteTable(app: AppDef, table: AppTable): Promise<void> {
    const now = new Date()
    const rels = await this.prisma.appRel.findMany({
      where: {
        appId: app.id,
        deletedAt: null,
        OR: [{ fromTableId: table.id }, { toTableId: table.id }],
      },
    })
    const throughIds = rels.map((rel) => rel.throughTableId).filter((id) => id !== table.id)
    // 指向该表的 ref 字段一并软删（避免悬空引用）
    const refFields = await this.prisma.appField.findMany({
      where: { refTableId: table.id, isDeleted: 0 },
      select: { id: true },
    })
    await this.prisma.$transaction([
      this.prisma.appTable.update({
        where: { id: table.id },
        data: { deletedAt: now, name: `__deleted_${table.id.toString()}` },
      }),
      this.prisma.appField.updateMany({
        where: { tableId: table.id, isDeleted: 0 },
        data: { isDeleted: 1, deletedAt: now },
      }),
      this.prisma.appField.updateMany({
        where: { id: { in: refFields.map((field) => field.id) }, isDeleted: 0 },
        data: { isDeleted: 1, deletedAt: now },
      }),
      ...(rels.length
        ? [
            this.prisma.appRel.updateMany({
              where: { id: { in: rels.map((rel) => rel.id) } },
              data: { deletedAt: now },
            }),
          ]
        : []),
      ...(throughIds.length
        ? [
            this.prisma.appTable.updateMany({
              where: { id: { in: throughIds }, deletedAt: null },
              data: { deletedAt: now },
            }),
            this.prisma.appField.updateMany({
              where: { tableId: { in: throughIds }, isDeleted: 0 },
              data: { isDeleted: 1, deletedAt: now },
            }),
          ]
        : []),
    ])
  }

  /** 中间表唯一名（含软删行避免撞唯一索引） */
  private async uniqueRelationTableName(appId: bigint, base: string): Promise<string> {
    const rows = await this.prisma.appTable.findMany({
      where: { appId },
      select: { name: true },
    })
    const taken = new Set(rows.map((row) => row.name))
    const trimmed = base.slice(0, 60)
    if (!taken.has(trimmed)) return trimmed
    for (let i = 1; i <= 99; i++) {
      const candidate = `${trimmed}_${i}`
      if (!taken.has(candidate)) return candidate
    }
    throw new BusinessException(ErrorCode.AppDataInvalid, '中间表名生成失败，请重试')
  }

  private toFieldView(field: AppField, nameOfTable: Map<string, string>): AppFieldView {
    return {
      id: field.id.toString(),
      name: field.name,
      label: field.label,
      type: field.type as AppFieldType,
      required: field.required === 1,
      defaultVal: field.defaultVal as unknown,
      enumOptions: normalizeEnumOptions(field.enumOptions),
      refTableId: field.refTableId ? field.refTableId.toString() : null,
      refTableName: field.refTableId
        ? (nameOfTable.get(field.refTableId.toString()) ?? null)
        : null,
      refMultiple: field.refMultiple === 1,
      sort: field.sort,
    }
  }
}
