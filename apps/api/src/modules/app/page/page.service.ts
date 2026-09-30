import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { AppDef, AppPage, Prisma } from '@prisma/client'
import { ErrorCode } from '../../../common/constants/error-code'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import { RedisService } from '../../../infra/redis/redis.service'
import { AdminService } from '../admin/admin.service'
import { DataService } from '../data/data.service'
import { invalidateAppSchema } from '../schema/schema.cache'
import { SchemaService } from '../schema/schema.service'
import type { ResolvedTable } from '../schema/schema.types'
import { buildAdminPageSchema, pickMainTable } from './page.builder'
import { validatePageSchema, type PageSchemaContext } from './page.schema'
import type { CreatePageDto, PageActionDto, UpdatePageDto } from './dto/page.dto'

/** 页面 code 唯一后缀最大尝试 */
const CODE_SUFFIX_MAX = 100

/** 页类型常量（P14 R126：kind 收缩为仅 admin，display 展示页已废弃并清理） */
export const PAGE_KIND_ADMIN = 'admin'

/**
 * 由已过校验的 schema.kind 判定落库页类型（单一事实来源：schema 说了算，
 * 避免 DTO 与 schema 双写不一致造成脏数据）。P14：校验器只放行 admin，故恒 admin。
 */
function resolvePageKind(_schema: Record<string, unknown>): string {
  return PAGE_KIND_ADMIN
}
/** 单动作步骤上限（与校验器一致） */
const MAX_STEPS = 10

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 名称 → code（小写字母开头；中文名退化为 'page'，唯一性靠后缀） */
function toCode(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return /^[a-z]/.test(base) ? base : `page${base ? `-${base}` : ''}`
}

/**
 * 功能页引擎（P11 T104，API-P11 §1.3 + §1.4 action）：
 * page schema 存取 + 校验（R94，失败 50004）+ 动作执行（R90：多表写整体事务，任一步失败整体回滚）。
 * 另供 AI 工具 gen_admin_page / adjust_page 调用（门面投影）。
 */
@Injectable()
export class PageService {
  private readonly logger = new Logger(PageService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly adminService: AdminService,
    private readonly schemaService: SchemaService,
    private readonly dataService: DataService,
  ) {}

  // ==================== 页面 CRUD ====================

  /** 功能页列表 */
  async list(userId: bigint, appCode: string) {
    const app = await this.adminService.assertOwned(userId, appCode)
    const pages = await this.prisma.appPage.findMany({
      where: { appId: app.id, deletedAt: null },
      orderBy: [{ sort: 'asc' }, { id: 'asc' }],
    })
    return pages.map((page) => ({
      id: page.id.toString(),
      code: page.code,
      name: page.name,
      route: page.route,
      kind: page.kind,
      genBy: page.genBy,
      sort: page.sort,
      updatedAt: page.updatedAt,
    }))
  }

  /** 新建功能页（schema 过校验；route 重复 50007；超 50 页 50002） */
  async create(userId: bigint, appCode: string, dto: CreatePageDto) {
    const app = await this.adminService.assertOwned(userId, appCode)
    const ctx = await this.buildContext(app.id)
    validatePageSchema(dto.schema, ctx)
    await this.assertPageQuota(app.id)
    await this.assertRouteFree(app.id, dto.route)
    const code = await this.uniquePageCode(app.id, dto.name)
    const page = await this.prisma.appPage.create({
      data: {
        appId: app.id,
        kind: resolvePageKind(dto.schema),
        code,
        name: dto.name.trim(),
        route: dto.route,
        schema: dto.schema as Prisma.InputJsonValue,
        genBy: dto.genBy ?? 'manual',
      },
    })
    await invalidateAppSchema(this.redis, app.id)
    return {
      ok: true,
      pageCode: page.code,
      route: page.route,
      blocks: Array.isArray(dto.schema.layout) ? dto.schema.layout.length : 0,
    }
  }

  /** 更新功能页（schema/name/sort） */
  async update(userId: bigint, appCode: string, pageId: bigint, dto: UpdatePageDto) {
    const app = await this.adminService.assertOwned(userId, appCode)
    const page = await this.requirePage(app.id, pageId)
    const data: Prisma.AppPageUpdateInput = {}
    if (dto.name !== undefined) data.name = dto.name.trim()
    if (dto.sort !== undefined) data.sort = dto.sort
    if (dto.schema !== undefined) {
      const ctx = await this.buildContext(app.id)
      validatePageSchema(dto.schema, ctx)
      const nextKind = resolvePageKind(dto.schema)
      data.schema = dto.schema as Prisma.InputJsonValue
      data.kind = nextKind
      // P14：页公开标记退役（管理页恒不可公开），存量值就地归零
      if (page.isPublic === 1) data.isPublic = 0
    }
    if (Object.keys(data).length === 0) {
      throw new BusinessException(ErrorCode.ParamInvalid, '没有需要更新的字段')
    }
    await this.prisma.appPage.update({ where: { id: page.id }, data })
    await invalidateAppSchema(this.redis, app.id)
    return { ok: true, pageCode: page.code }
  }

  /** 删除功能页（软删） */
  async remove(userId: bigint, appCode: string, pageId: bigint) {
    const app = await this.adminService.assertOwned(userId, appCode)
    const page = await this.requirePage(app.id, pageId)
    await this.prisma.appPage.update({
      where: { id: page.id },
      data: { deletedAt: new Date() },
    })
    await invalidateAppSchema(this.redis, app.id)
    return { ok: true, pageCode: page.code }
  }

  // ==================== AI 工具投影（T105） ====================

  /** 生成标准管理页（gen_admin_page）：按 purpose 选主表，生成 filterBar+table+form 三区块 */
  async genAdminPage(userId: bigint, appCode: string, name: string, purpose: string) {
    const app = await this.adminService.assertOwned(userId, appCode)
    const tables = await this.schemaService.listResolvedTables(app.id)
    const main = pickMainTable(purpose, tables)
    if (!main) {
      throw new BusinessException(ErrorCode.AppDataInvalid, '应用还没有逻辑表，请先建表再生成页面')
    }
    const schema = buildAdminPageSchema(tables, main, name)
    const ctx = await this.buildContext(app.id)
    validatePageSchema(schema, ctx)
    await this.assertPageQuota(app.id)
    const code = await this.uniquePageCode(app.id, name)
    const route = await this.uniquePageRoute(app.id, code)
    const page = await this.prisma.appPage.create({
      data: {
        appId: app.id,
        kind: 'admin',
        code,
        name: name.trim() || `${main.label}管理`,
        route,
        schema: schema as Prisma.InputJsonValue,
        genBy: 'ai',
      },
    })
    await invalidateAppSchema(this.redis, app.id)
    return {
      ok: true,
      pageCode: page.code,
      route: page.route,
      blocks: Array.isArray(schema.layout) ? schema.layout.length : 0,
    }
  }

  /**
   * 调整功能页（adjust_page）：本期落为**按当前表结构重建区块**（R97 的可视化编辑为精细调整入口；
   * 工具侧 instruction 为自由文本，不解析为结构化指令——避免「猜」出错误改动）。
   */
  async adjustPage(userId: bigint, appCode: string, pageCode: string, instruction: string) {
    const app = await this.adminService.assertOwned(userId, appCode)
    const page = await this.prisma.appPage.findFirst({
      where: { appId: app.id, code: pageCode, deletedAt: null },
    })
    if (!page) throw new BusinessException(ErrorCode.AppActionMismatch, '功能页不存在')
    const tables = await this.schemaService.listResolvedTables(app.id)
    const main = this.inferMainTable(page, tables)
    if (!main) throw new BusinessException(ErrorCode.AppDataInvalid, '无法从页面模式定位主表')
    const schema = buildAdminPageSchema(tables, main, page.name)
    const ctx = await this.buildContext(app.id)
    validatePageSchema(schema, ctx)
    await this.prisma.appPage.update({
      where: { id: page.id },
      data: { schema: schema as Prisma.InputJsonValue },
    })
    await invalidateAppSchema(this.redis, app.id)
    const blocks = Array.isArray(schema.layout) ? schema.layout.length : 0
    const form = (schema.layout as Array<Record<string, unknown>>).find((block) => block.type === 'form')
    const formFields = Array.isArray(form?.fields) ? form.fields.length : 0
    return {
      ok: true,
      changed: `已按当前表结构刷新「${page.name}」：${blocks} 个区块 / ${main.name} 主表 / 表单 ${formFields} 字段（说明：${instruction.slice(0, 50)}）`,
    }
  }

  // ==================== 动作执行（R90 事务） ====================

  /**
   * 执行页面动作：schema.actions[action] 解析 → 全部步骤包在 `$transaction`，
   * 任一步失败整体回滚（50005）；action 未声明 50010。
   * 参数形态：`params[表名]`（每步取本表子对象）优先，否则用平铺 params。
   */
  async executeAction(userId: bigint, dto: PageActionDto) {
    const app = await this.adminService.assertOwned(userId, dto.appCode)
    const page = await this.prisma.appPage.findFirst({
      where: { appId: app.id, code: dto.pageCode, deletedAt: null },
    })
    if (!page) throw new BusinessException(ErrorCode.AppActionMismatch, '功能页不存在')
    const schema = page.schema as Record<string, unknown>
    const actions = isRecord(schema.actions) ? schema.actions : {}
    const action = actions[dto.action]
    if (!isRecord(action)) {
      throw new BusinessException(ErrorCode.AppActionMismatch, `动作未在页面声明：${dto.action}`)
    }
    const steps = Array.isArray(action.steps) ? action.steps : []
    if (steps.length === 0 || steps.length > MAX_STEPS) {
      throw new BusinessException(ErrorCode.AppActionMismatch, '动作步骤定义非法')
    }
    const params = dto.params ?? {}
    const results = await this.prisma.$transaction(async (tx) => {
      const stepResults: Array<{ op: string; table: string; rowId: string }> = []
      for (const rawStep of steps) {
        if (!isRecord(rawStep)) throw new BusinessException(ErrorCode.AppActionMismatch, '动作步骤非法')
        const op = String(rawStep.op)
        const tableName = String(rawStep.table)
        const table = await this.schemaService.resolveTableByName(app.id, tableName)
        if (table.isSystem) {
          throw new BusinessException(ErrorCode.AppDataInvalid, '动作不允许写系统表')
        }
        const stepValues = this.stepValues(tableName, params)
        if (op === 'create') {
          const created = await this.dataService.createRow(tx, app, table, stepValues.values, userId)
          stepResults.push({ op, table: tableName, rowId: created.rowId })
        } else if (op === 'update') {
          const rowId = stepValues.rowId
          if (!rowId) throw new BusinessException(ErrorCode.AppDataInvalid, `动作「${dto.action}」更新步骤缺少 rowId`)
          const updated = await this.dataService.updateRow(tx, app, table, rowId, stepValues.values, userId)
          stepResults.push({ op, table: tableName, rowId: updated.rowId })
        } else if (op === 'delete') {
          const rowId = stepValues.rowId
          if (!rowId) throw new BusinessException(ErrorCode.AppDataInvalid, `动作「${dto.action}」删除步骤缺少 rowId`)
          const removed = await this.dataService.removeRow(tx, app, table, rowId)
          stepResults.push({ op, table: tableName, rowId: removed.rowId })
        } else {
          throw new BusinessException(ErrorCode.AppActionMismatch, `不支持的步骤 op：${op}`)
        }
      }
      return stepResults
    })
    // R105 写后失效：事务提交后 DEL 该应用公开数据缓存（公开端即时可见）
    await this.adminService.invalidatePubCache(app.id)
    return { ok: true, results }
  }

  // ==================== 内部 ====================

  /** 依页面 schema 推断主表：优先第一个 list 数据源的非系统表，否则首个 create 步骤的表 */
  private inferMainTable(page: AppPage, tables: ResolvedTable[]): ResolvedTable | null {
    const schema = page.schema as Record<string, unknown>
    const dataSources = isRecord(schema.dataSources) ? schema.dataSources : {}
    for (const value of Object.values(dataSources)) {
      if (isRecord(value) && value.op === 'list' && typeof value.table === 'string') {
        const hit = tables.find((table) => table.name === value.table && !table.isSystem)
        if (hit) return hit
      }
    }
    const actions = isRecord(schema.actions) ? schema.actions : {}
    for (const value of Object.values(actions)) {
      if (isRecord(value) && Array.isArray(value.steps)) {
        for (const step of value.steps) {
          if (isRecord(step) && typeof step.table === 'string') {
            const hit = tables.find((table) => table.name === step.table && !table.isSystem)
            if (hit) return hit
          }
        }
      }
    }
    const first = tables.find((table) => !table.isSystem)
    return first ?? null
  }

  /** 步骤参数：优先 params[表名] 子对象，否则平铺 params；拆出 rowId */
  private stepValues(
    tableName: string,
    params: Record<string, unknown>,
  ): { values: Record<string, unknown>; rowId: string | null } {
    const scoped = isRecord(params[tableName]) ? (params[tableName] as Record<string, unknown>) : params
    const { rowId, ...values } = scoped
    return { values, rowId: typeof rowId === 'string' ? rowId : null }
  }

  // P14 R126：`setPublic`（display 页公开标记开关）随展示页整体废弃移除——管理页恒不可公开；
  // 数据应用的对外可读性由「is_public 总开关 + 表·字段暴露」承担（D115），展示改由展示应用承担。

  /** 校验上下文：非系统表 → 字段名集合 + 同应用页 code 集合（页面只允许引用用户表；display rowLink 校验用） */
  private async buildContext(appId: bigint): Promise<PageSchemaContext> {
    const tables = await this.schemaService.listResolvedTables(appId)
    const map = new Map<string, Set<string>>()
    for (const table of tables) {
      if (table.isSystem) continue
      map.set(table.name, new Set(table.fields.map((field) => field.name)))
    }
    const pages = await this.prisma.appPage.findMany({
      where: { appId, deletedAt: null },
      select: { code: true },
    })
    return { tables: map, pages: new Set(pages.map((page) => page.code)) }
  }

  private async assertPageQuota(appId: bigint): Promise<void> {
    const count = await this.prisma.appPage.count({ where: { appId, deletedAt: null } })
    const max = this.config.get<number>('app.maxPagesPerApp', 50)
    if (count >= max) {
      throw new BusinessException(ErrorCode.AppQuotaExceeded, `功能页数量已达上限（${max} 个）`)
    }
  }

  private async assertRouteFree(appId: bigint, route: string): Promise<void> {
    const exists = await this.prisma.appPage.findFirst({ where: { appId, route } })
    if (exists) {
      throw new BusinessException(ErrorCode.AppPageRouteConflict, `功能页路由已存在：${route}`)
    }
  }

  private async uniquePageCode(appId: bigint, name: string): Promise<string> {
    const rows = await this.prisma.appPage.findMany({ where: { appId }, select: { code: true } })
    const taken = new Set(rows.map((row) => row.code))
    const base = toCode(name)
    if (!taken.has(base)) return base
    for (let i = 1; i <= CODE_SUFFIX_MAX; i++) {
      const candidate = `${base}-${i}`
      if (!taken.has(candidate)) return candidate
    }
    throw new BusinessException(ErrorCode.AppPageRouteConflict, '功能页标识生成失败，请更换名称')
  }

  private async uniquePageRoute(appId: bigint, base: string): Promise<string> {
    const rows = await this.prisma.appPage.findMany({ where: { appId }, select: { route: true } })
    const taken = new Set(rows.map((row) => row.route))
    if (!taken.has(base)) return base
    for (let i = 1; i <= CODE_SUFFIX_MAX; i++) {
      const candidate = `${base}-${i}`
      if (!taken.has(candidate)) return candidate
    }
    throw new BusinessException(ErrorCode.AppPageRouteConflict, '功能页路由生成失败，请更换名称')
  }

  private async requirePage(appId: bigint, pageId: bigint): Promise<AppPage> {
    const page = await this.prisma.appPage.findFirst({
      where: { id: pageId, appId, deletedAt: null },
    })
    if (!page) throw new BusinessException(ErrorCode.AppNotFound, '功能页不存在或无权')
    return page
  }

  /** 供 AppFacade 组合（保留 AppDef 上下文） */
  async assertOwnedApp(userId: bigint, appCode: string): Promise<AppDef> {
    return this.adminService.assertOwned(userId, appCode)
  }
}
