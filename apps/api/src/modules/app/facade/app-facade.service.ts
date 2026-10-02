import { Injectable } from '@nestjs/common'
import { AdminService } from '../admin/admin.service'
import { DataService } from '../data/data.service'
import { PageService } from '../page/page.service'
import type { AppAttachmentStream } from '../../cloud/facade/cloud-facade.service'
import { RedisService } from '../../../infra/redis/redis.service'
import { invalidatePubAll } from '../pub/pub.cache'
import { PubDataService } from '../pub/pub-data.service'
import type { PublicListPayload, PublicSchemaPayload } from '../pub/pub-data.service'
import { resolveAppPubMime } from '../pub/pub-mime'
import { SchemaService } from '../schema/schema.service'
import type { FieldDefDto } from '../schema/dto/schema.dto'
import type { ResolvedTable } from '../schema/schema.types'
import { ErrorCode } from '../../../common/constants/error-code'
import { BusinessException } from '../../../common/exceptions/business.exception'

/** AI 工具建表入参（工具契约 API-P11 §4 的域内投影） */
export interface AppTableDefInput {
  table: string
  label: string
  fields: FieldDefDto[]
}

/** 演示数据行（R118：含源行 rowId 供复制方重映射引用） */
export interface DemoRow {
  rowId: string
  data: Record<string, unknown>
}

/** 结构快照的 app 域投影（P13 R117；market 域组装后传入，app 域不反向依赖 market） */
export interface MarketSnapshotInput {
  version: number
  tables: Array<{
    name: string
    label: string
    fields: Array<{
      name: string
      label: string
      type: string
      required?: boolean
      default?: unknown
      enumOptions?: Array<{ value: string; label: string }> | null
      refTable?: string | null
      refMultiple?: boolean
    }>
  }>
  rels: Array<{ fromTable: string; fromField: string; toTable: string }>
  pages: Array<{ name: string; route: string; schema: Record<string, unknown>; genBy?: string }>
}

/** 复制物化结果（R119；P14 起附 appId 供 market 域续做展示应用 bundle 物化） */
export interface MaterializeResult {
  ok: true
  appId: string
  appCode: string
  tableCount: number
  pageCount: number
  rowCount: number
  skippedRows: number
}

/**
 * app 域门面（P11，D96/铁律 3/6）：AI 工具与其它域经本门面调用 app 域能力，
 * 禁止绕过门面直连 app 的 Service/表。
 *
 * 拓扑（防环）：
 * - ai 域（工具 handler）→ AppFacade（createAppDraft / addTable / addFields / setRelation / …）
 * - cloud 域（删除预检）→ AppRefService（app-ref.module，最小模块，防环）
 * - app 域（附件上传）→ CloudFacade.uploadForApp
 *
 * 本类只依赖 app 域导出的 Service（AdminService / SchemaService / PageService / DataService），
 * 不 import 其它业务模块的内部实现。T101 落应用创建/确认，T102 落结构管理，T103/T104 续接。
 */
@Injectable()
export class AppFacade {
  constructor(
    private readonly adminService: AdminService,
    private readonly schemaService: SchemaService,
    private readonly pageService: PageService,
    private readonly dataService: DataService,
    private readonly pubDataService: PubDataService,
    private readonly redis: RedisService,
  ) {}

  /** AI 创建应用草稿（工具 create_data_app；draft 不占 active 额度，限 3 个） */
  async createAppDraft(
    userId: bigint,
    name: string,
    description?: string,
  ): Promise<{ ok: true; appCode: string; status: string }> {
    const result = await this.adminService.create(userId, {
      name,
      description,
      mode: 'draft',
    })
    return { ok: true, appCode: result.appCode, status: result.status }
  }

  /** AI 确认应用入册（工具 confirm_data_app；draft → active，查配额） */
  async confirmDataApp(
    userId: bigint,
    appCode: string,
  ): Promise<{ ok: true; status: string; menuHint: string }> {
    const result = await this.adminService.confirm(userId, appCode)
    return { ok: true, status: result.status, menuHint: result.menuHint }
  }

  /** AI 建表（工具 add_table；含初始字段，refTable 自动建 1n 关联字段） */
  async addTable(
    userId: bigint,
    appCode: string,
    input: AppTableDefInput,
  ): Promise<{ ok: true; table: string; created: string[] }> {
    const result = await this.schemaService.createTable(userId, appCode, {
      name: input.table,
      label: input.label,
      fields: input.fields,
    })
    return { ok: true, table: result.table, created: result.created }
  }

  /** AI 加字段（工具 add_fields） */
  async addFields(
    userId: bigint,
    appCode: string,
    table: string,
    fields: FieldDefDto[],
  ): Promise<{ ok: true; table: string; created: string[] }> {
    const resolved = await this.schemaService.resolveTableByName(
      (await this.adminService.assertOwned(userId, appCode)).id,
      table,
    )
    const created: string[] = []
    for (const field of fields) {
      const result = await this.schemaService.addField(userId, appCode, resolved.id, field)
      created.push(result.field)
    }
    return { ok: true, table, created }
  }

  /** AI 建 n:n 关系（工具 set_relation；幂等） */
  async setRelation(
    userId: bigint,
    appCode: string,
    fromTable: string,
    fromField: string,
    toTable: string,
  ): Promise<{ ok: true; relation: string; throughTable: string }> {
    const result = await this.schemaService.createRelation(userId, appCode, {
      fromTable,
      fromField,
      toTable,
    })
    return { ok: true, relation: result.relation, throughTable: result.throughTable }
  }

  /** AI 生成管理页（工具 gen_admin_page；按 purpose 选主表，生成三区块标准页） */
  async genAdminPage(
    userId: bigint,
    appCode: string,
    name: string,
    purpose: string,
  ): Promise<{ ok: true; pageCode: string; route: string; blocks: number }> {
    const result = await this.pageService.genAdminPage(userId, appCode, name, purpose)
    return { ok: true, pageCode: result.pageCode, route: result.route, blocks: result.blocks }
  }

  /** AI 调整功能页（工具 adjust_page；本期为按当前表结构刷新区块） */
  async adjustPage(
    userId: bigint,
    appCode: string,
    pageCode: string,
    instruction: string,
  ): Promise<{ ok: true; changed: string }> {
    const result = await this.pageService.adjustPage(userId, appCode, pageCode, instruction)
    return { ok: true, changed: result.changed }
  }

  /**
   * R114（P12-PATCH2 T116 建 / P14 T126 修订）：AI 列应用与可读取状态（工具 `list_data_apps`）——
   * 返回 appCode / name / status / isPublic（可被授权读取的总开关，D115）/ missing（发布缺项）。
   * P14：不再返回 pubCode / pubUrl（匿名公开链接退役）；展示侧改由「展示应用 + 授权」承担，
   * 授权关系由 ai 域工具另经 `DisplayFacade` 组装（本门面不依赖 display 域，防模块环）。
   * **只读**：发布与暴露开关的写工具归 P13，本方法不代发布。
   */
  async listDataApps(userId: bigint): Promise<{
    ok: true
    apps: Array<{
      appCode: string
      name: string
      status: string
      isPublic: number
      missing: string[]
    }>
  }> {
    return { ok: true, apps: await this.adminService.listWithPubState(userId) }
  }

  // ==================== P13：应用市场（快照导出 / 公开开关 / 复制物化） ====================

  /**
   * P13 R117：导出结构快照源数据（**只读**，market 域据此物化快照）。
   * 返回 schema 全量打包（表含字段全量、n:n 关系、功能页 schema 原样）+ 应用元数据；
   * 供 market 域组装快照并落 `market_listing.snapshot`。
   */
  async exportStructure(
    userId: bigint,
    appCode: string,
  ): Promise<{
    ok: true
    appId: string
    name: string
    description: string | null
    status: string
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
        sort: number
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
  }> {
    const app = await this.adminService.assertOwned(userId, appCode)
    const bundle = await this.schemaService.getSchema(userId, appCode)
    return {
      ok: true,
      appId: app.id.toString(),
      name: app.name,
      description: app.description,
      status: app.status,
      tables: bundle.tables
        .filter((table) => !table.isSystem)
        .map((table) => ({
          name: table.name,
          label: table.label,
          fields: table.fields.map((field) => ({
            name: field.name,
            label: field.label,
            type: field.type,
            required: field.required,
            defaultVal: field.defaultVal ?? null,
            enumOptions: field.enumOptions,
            refTableName: field.refTableName,
            refMultiple: field.refMultiple,
            sort: field.sort,
          })),
        })),
      rels: bundle.relations.map((rel) => ({
        fromTable: rel.fromTable,
        fromField: rel.fromField,
        toTable: rel.toTable,
      })),
      pages: bundle.pages.map((page) => ({
        name: page.name,
        route: page.route,
        kind: page.kind,
        genBy: page.genBy,
        sort: page.sort,
        schema: (page.schema ?? {}) as Record<string, unknown>,
      })),
    }
  }

  /**
   * P13 R118：读取演示数据（每表 ≤cap 行；超限由 market 域 50015 拒绝，不静默截断）。
   * attachment 字段值经 DataService 置 null；多值 ref 以源 rowId[] 返回（复制时重映射）。
   */
  async readDemoRows(
    userId: bigint,
    appCode: string,
    cap: number,
  ): Promise<{
    ok: true
    tables: Array<{ table: string; rows: DemoRow[]; truncated: boolean }>
  }> {
    const app = await this.adminService.assertOwned(userId, appCode)
    const tables = await this.schemaService.listResolvedTables(app.id)
    const result: Array<{ table: string; rows: DemoRow[]; truncated: boolean }> = []
    for (const table of tables) {
      if (table.isSystem) continue
      const snapshot = await this.dataService.snapshotRows(app, table, cap)
      result.push({ table: table.name, rows: snapshot.rows, truncated: snapshot.truncated })
    }
    return { ok: true, tables: result }
  }

  /**
   * P13 R122 / D110：公开总开关（AI 工具 `publish_data_app`）。
   * 开启未过 R103 时**不抛错**，返回 `ok:false + missing[]` 供模型按缺项引导用户先 expose。
   */
  async setPublic(
    userId: bigint,
    appCode: string,
    isPublic: number,
  ): Promise<{
    ok: boolean
    isPublic: number
    missing?: string[]
  }> {
    try {
      const result = await this.adminService.publish(userId, appCode, isPublic)
      return { ok: true, isPublic: result.isPublic }
    } catch (error) {
      if (error instanceof BusinessException && error.code === ErrorCode.AppPublishInvalid) {
        const config = await this.adminService.pubConfig(userId, appCode)
        return { ok: false, isPublic: 0, missing: config.missing }
      }
      throw error
    }
  }

  /**
   * P13 R122 / D110：粒度暴露开关（AI 工具 `expose_data_app`）。
   * - target=table：按表名解析；
   * - target=field：name 支持 `表.字段` 或应用内唯一字段名。
   *
   * P14 D113/T126：`target=page` 档**退役**——display 展示页整体废弃（kind 收缩为仅 admin）；
   * 数据应用的对外可读性只由「is_public 总开关 + 表·字段暴露」决定（D115），展示改由展示应用承担。
   */
  async setExposure(
    userId: bigint,
    appCode: string,
    target: 'table' | 'field',
    name: string,
    isExposed: number,
  ): Promise<{ ok: true; target: string; name: string; isExposed: number }> {
    const flag = isExposed === 1 ? 1 : 0
    const key = name.trim()
    if (!key) {
      throw new BusinessException(ErrorCode.ParamInvalid, 'name 不能为空')
    }

    if (target === 'table') {
      const app = await this.adminService.assertOwned(userId, appCode)
      const table = await this.schemaService.resolveTableByName(app.id, key)
      const result = await this.adminService.setTableExpose(userId, appCode, table.id, flag)
      return { ok: true, target, name: result.tableCode, isExposed: result.isExposed }
    }

    if (target === 'field') {
      const config = await this.adminService.pubConfig(userId, appCode)
      const found = this.locateField(config.tables, key)
      if (!found) {
        throw new BusinessException(ErrorCode.AppNotFound, `字段不存在或无权：${key}`)
      }
      const result = await this.adminService.setFieldExpose(userId, appCode, BigInt(found.id), flag)
      return { ok: true, target, name: result.field, isExposed: result.isExposed }
    }

    throw new BusinessException(
      ErrorCode.ParamInvalid,
      'target 仅支持 table / field（P14：display 展示页已废弃，page 档退役）',
    )
  }

  // ==================== P14 §30.4：授权取数面（经 R125 校验链后由 site 域开放层调用） ====================

  /**
   * 展示应用授权用：属主 + code → 应用标识（不存在/无权 → 50001；属主校验单点在域内）。
   * display 域经本方法取 appId 落 `disp_grant.app_id`，不直读 app_def（铁律 6）。
   */
  async appIdByCode(
    userId: bigint,
    appCode: string,
  ): Promise<{ appId: string; appCode: string; name: string; isPublic: number }> {
    const app = await this.adminService.assertOwned(userId, appCode)
    return { appId: app.id.toString(), appCode: app.code, name: app.name, isPublic: app.isPublic }
  }

  /**
   * 暴露清单（P15 T134 / R133）：access 域校验凭证 `scope` 只能收窄暴露三开关并集。
   * 属主 + 未软删校验在域内单点完成；不要求 `is_public=1`（凭证可在发布前创建，R131）。
   */
  async exposedSchemaOf(userId: bigint, appCode: string) {
    return this.adminService.exposedSchema(userId, appCode)
  }

  /** 属主批量应用摘要（P15 T134：凭证列表回填 appCode / 应用名；已删应用不在结果中） */
  async appBriefByIds(
    userId: bigint,
    ids: bigint[],
  ): Promise<Array<{ id: string; code: string; name: string; isPublic: number }>> {
    return this.adminService.appBriefByIds(userId, ids)
  }

  /** 授权增删后失效取数面缓存（display 域经此调用，避免跨域 import app 内部缓存工具，铁律 6） */
  async invalidatePublicCache(appId: bigint): Promise<void> {
    await invalidatePubAll(this.redis, appId)
  }

  /**
   * 取数面定位（R125 第 ③ 步）：属主 + 应用 code + `is_public=1` 总开关，返回可读应用标识；
   * 不存在 / 未公开 / 已软删一律 40400（防探测，不暴露存在性差异）。
   */
  async resolveGrantedApp(
    ownerId: bigint,
    appCode: string,
  ): Promise<{ appId: string; appCode: string; name: string; description: string | null }> {
    const app = await this.pubDataService.resolvePublicApp(ownerId, appCode)
    return {
      appId: app.id.toString(),
      appCode: app.code,
      name: app.name,
      description: app.description,
    }
  }

  /** 取数面暴露表结构（§30.4 `/schema`；缓存 600s） */
  async publicSchema(ownerId: bigint, appCode: string): Promise<PublicSchemaPayload> {
    return this.pubDataService.schema(ownerId, appCode)
  }

  /** 取数面列表（§30.4 `/tables/:table/records`；R104 固定参数口径沿用） */
  async publicList(
    ownerId: bigint,
    appCode: string,
    table: string,
    query: Record<string, unknown>,
  ): Promise<PublicListPayload> {
    return this.pubDataService.listRows(ownerId, appCode, table, query)
  }

  /**
   * 取数面全量投影（P15 T135）：对外 `/api/ext/v1/**` 的 cursor 分页数据源。
   * 不切片、不缓存——切片与游标编解码在 access 域契约层（契约冻结层独立，R136）；
   * 取数仍走同一 `DataService.queryForPublic`（铁律 5）。
   */
  async publicListAll(
    ownerId: bigint,
    appCode: string,
    table: string,
    query: Record<string, unknown>,
    mandatoryFilters: string[] = [],
  ): Promise<{
    rows: Array<Record<string, unknown>>
    sort: Array<{ f: string; dir: 'asc' | 'desc' }>
  }> {
    return this.pubDataService.listAll(ownerId, appCode, table, query, mandatoryFilters)
  }

  /** 取数面单行（§30.4 `/tables/:table/records/:rowId`）；返回 `{ op, row }`（取数执行器语义） */
  async publicDetail(
    ownerId: bigint,
    appCode: string,
    table: string,
    rowId: string,
    query: Record<string, unknown>,
    mandatoryFilters: string[] = [],
  ): Promise<{ op: string; row: Record<string, unknown> }> {
    return this.pubDataService.getRow(ownerId, appCode, table, rowId, query, mandatoryFilters)
  }

  /**
   * 取数面附件流（§30.4 `/files/:fileId/stream`）：三道闸（引用索引 / 表·字段暴露 / R26 MIME）
   * 全在 app 域内完成，MIME 结果随流一并出域，site 域开放层不做 app 专属 MIME 判定（铁律 6）。
   */
  async publicAttachment(
    ownerId: bigint,
    appCode: string,
    fileId: string,
    range?: { start: number; end: number },
    refFilter?: (table: string, field: string) => boolean,
  ): Promise<AppAttachmentStream & { contentType: string; inline: boolean }> {
    const meta = await this.pubDataService.attachmentStream(
      ownerId,
      appCode,
      fileId,
      range,
      refFilter,
    )
    const resolved = resolveAppPubMime(meta.ext)
    return { ...meta, contentType: resolved.contentType, inline: resolved.inline }
  }

  /**
   * P13 R119 / ARCH §29.3：市场复制物化（market 域编排，app 域内完成）。
   *
   * 流程：建 active 应用（50002 配额；source_app_id 记谱系）→ 按依赖拓扑重建表/字段 →
   * 重建 n:n 关系（中间表由 SchemaService 生成）→ 重建功能页（schema 原样，全私有）→
   * 演示数据逐行独立事务写入（引用按旧→新 rowId 重映射，错误行跳过并计数）。
   * 结构阶段任一步失败 = 整体回滚（软删刚建的应用）；数据阶段失败只计数不中断（R119）。
   */
  async materializeListing(
    userId: bigint,
    input: {
      name: string
      description?: string | null
      sourceAppId: bigint
      snapshot: MarketSnapshotInput
      demoData?: Record<string, DemoRow[]> | null
    },
  ): Promise<MaterializeResult> {
    const app = await this.adminService.createMaterialized(
      userId,
      input.name,
      input.description ?? null,
      input.sourceAppId,
    )
    let tableCount = 0
    let pageCount = 0
    let rowCount = 0
    let skippedRows = 0
    try {
      const order = this.orderSnapshotTables(input.snapshot)
      for (const tableName of order) {
        const table = input.snapshot.tables.find((item) => item.name === tableName)
        if (!table) continue
        // 多值 ref 字段由 createRelation 连同中间表一起重建（R117），此处跳过
        const fields: FieldDefDto[] = table.fields
          .filter((field) => !field.refMultiple)
          .map((field) => ({
            name: field.name,
            label: field.label,
            type: field.type,
            required: field.required ? 1 : 0,
            default: field.default ?? undefined,
            enumOptions: field.enumOptions?.length ? field.enumOptions : undefined,
            refTable: field.refTable ?? undefined,
          }))
        await this.schemaService.createTable(userId, app.code, {
          name: table.name,
          label: table.label,
          fields,
        })
        tableCount++
      }

      for (const rel of input.snapshot.rels) {
        await this.schemaService.createRelation(userId, app.code, {
          fromTable: rel.fromTable,
          fromField: rel.fromField,
          toTable: rel.toTable,
        })
      }

      for (const page of input.snapshot.pages) {
        await this.pageService.create(userId, app.code, {
          name: page.name,
          route: page.route,
          schema: page.schema,
          genBy: page.genBy === 'ai' ? 'ai' : 'manual',
        })
        pageCount++
      }

      const demoData = input.demoData ?? null
      if (demoData) {
        const rowIdMap = new Map<string, string>()
        for (const tableName of order) {
          const rows = demoData[tableName]
          if (!rows || rows.length === 0) continue
          const table = await this.schemaService.resolveTableByName(app.id, tableName)
          for (const row of rows) {
            const values = this.remapRowValues(table, row.data, rowIdMap)
            try {
              const created = await this.dataService.createRowStandalone(app, table, values, userId)
              rowIdMap.set(row.rowId, created.rowId)
              rowCount++
            } catch (error) {
              // 演示数据逐行独立事务：业务校验失败只跳过并计数（R119），非业务异常上抛
              if (!(error instanceof BusinessException)) throw error
              skippedRows++
            }
          }
        }
      }
    } catch (error) {
      await this.adminService.remove(userId, app.code).catch(() => undefined)
      throw error
    }

    return {
      ok: true,
      appId: app.id.toString(),
      appCode: app.code,
      tableCount,
      pageCount,
      rowCount,
      skippedRows,
    }
  }

  /** P13 R120：按 id 批量取应用 code（market 域「我的提交」回填 appCode；只读） */
  async appCodesByIds(userId: bigint, ids: bigint[]): Promise<Array<{ id: string; code: string }>> {
    return this.adminService.appCodesByIds(userId, ids)
  }

  /** R96：userinfo 菜单动态段（active 应用 ▸ 功能页），供 auth 域拼装菜单树 */
  async getAppMenuSegments(
    userId: bigint,
  ): Promise<
    Array<{ appCode: string; name: string; pages: Array<{ code: string; name: string }> }>
  > {
    return this.adminService.getAppMenuSegments(userId)
  }

  // ==================== P13 内部辅助 ====================

  /**
   * 表重建顺序（拓扑）：被引用的表先建（ref 字段的 refTable / n:n 关系的 toTable）。
   * 存在环时剩余按快照原顺序追加（环内引用由 DataService 写路径的运行期校验兜底）。
   */
  private orderSnapshotTables(snapshot: MarketSnapshotInput): string[] {
    const names = snapshot.tables.map((table) => table.name)
    const deps = new Map<string, Set<string>>(names.map((name) => [name, new Set<string>()]))
    for (const table of snapshot.tables) {
      const bag = deps.get(table.name)
      if (!bag) continue
      for (const field of table.fields) {
        if (field.refTable && field.refTable !== table.name && deps.has(field.refTable)) {
          bag.add(field.refTable)
        }
      }
    }
    for (const rel of snapshot.rels) {
      const bag = deps.get(rel.fromTable)
      if (bag && rel.fromTable !== rel.toTable && deps.has(rel.toTable)) bag.add(rel.toTable)
    }

    const ordered: string[] = []
    const resolved = new Set<string>()
    let progressed = true
    while (ordered.length < names.length && progressed) {
      progressed = false
      for (const name of names) {
        if (resolved.has(name)) continue
        const waiting = [...(deps.get(name) ?? [])].some((dep) => !resolved.has(dep))
        if (waiting) continue
        ordered.push(name)
        resolved.add(name)
        progressed = true
      }
    }
    for (const name of names) {
      if (!resolved.has(name)) ordered.push(name)
    }
    return ordered
  }

  /** 演示数据行引用重映射（旧 rowId → 新 rowId；未映射的引用（含跨表尚未创建/被跳过的行）置空） */
  private remapRowValues(
    table: ResolvedTable,
    data: Record<string, unknown>,
    rowIdMap: Map<string, string>,
  ): Record<string, unknown> {
    const values: Record<string, unknown> = {}
    for (const field of table.fields) {
      if (!Object.prototype.hasOwnProperty.call(data, field.name)) continue
      const raw = data[field.name]
      if (field.refMultiple) {
        const list = Array.isArray(raw) ? raw : []
        values[field.name] = list
          .map((item) => rowIdMap.get(String(item)))
          .filter((item): item is string => Boolean(item))
        continue
      }
      if (field.type === 'ref') {
        values[field.name] = typeof raw === 'string' ? (rowIdMap.get(raw) ?? null) : null
        continue
      }
      values[field.name] = raw
    }
    return values
  }

  /** 按 `表.字段` 或应用内唯一字段名定位字段（公开总览的字段清单内查找；歧义/未命中返回 null） */
  private locateField(
    tables: Array<{ tableCode: string; fields: Array<{ id: string; name: string }> }>,
    key: string,
  ): { id: string; name: string } | null {
    const dot = key.indexOf('.')
    if (dot > 0) {
      const tableCode = key.slice(0, dot)
      const fieldName = key.slice(dot + 1)
      const table = tables.find((item) => item.tableCode === tableCode)
      return table?.fields.find((field) => field.name === fieldName) ?? null
    }
    const hits = tables.flatMap((table) => table.fields.filter((field) => field.name === key))
    return hits.length === 1 ? hits[0] : null
  }
}
