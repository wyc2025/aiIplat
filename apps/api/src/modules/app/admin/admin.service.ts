import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { AppDef, Prisma } from '@prisma/client'
import { randomInt } from 'node:crypto'
import { ErrorCode } from '../../../common/constants/error-code'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import { RedisService } from '../../../infra/redis/redis.service'
import { dslTargetTable, parseFieldDsl } from '../page/page.schema'
import { invalidatePubAll, invalidatePubData } from '../pub/pub.cache'
import { invalidateAppSchema } from '../schema/schema.cache'
import {
  cleanExpiredDraftsCore,
  purgeDeletedAppsCore,
  softDeleteApp,
} from './app-clean.core'
import type { CreateAppDto, ListAppQueryDto, UpdateAppDto } from './dto/admin.dto'

/** 应用状态：draft（AI 草稿，不占 active 额度）/ active（已入册） */
export const APP_STATUS_DRAFT = 'draft'
export const APP_STATUS_ACTIVE = 'active'

/** 页类型：display = 公开展示页（P12 R108；admin 页不可公开） */
export const PAGE_KIND_DISPLAY = 'display'

/** 判定普通对象（公开面 schema 结构遍历用） */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** pubCode 字母数字表（R93：12 位随机，全局唯一，P12 启用） */
const PUB_CODE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
const PUB_CODE_LENGTH = 12
/** code 冲突后缀最大尝试次数（R93 "(1)" 递增） */
const CODE_SUFFIX_MAX = 100

/** 应用名称 → code 基础片段（R93：slug 化；中文名退化为 'app'，唯一性靠后缀） */
function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return base || 'app'
}

/** 应用统计数字（列表/详情共用） */
export interface AppStats {
  tableCount: number
  rowCount: number
  pageCount: number
}

/**
 * 应用管理服务（P11 T101，API-P11 §1.1）：
 * 应用 CRUD + code/pub_code 生成（R93）+ 草稿生命周期（R91）+ 配额拦截（§4）+ 软删级联。
 * 属主自服务口径：全部按 ownerId 隔离，无权/不存在统一 50001（不暴露他人应用存在性）。
 */
@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  /** 属主校验：按 code 取本人未删应用，否则 50001 */
  async assertOwned(userId: bigint, code: string): Promise<AppDef> {
    const app = await this.prisma.appDef.findFirst({
      where: { ownerId: userId, code, deletedAt: null },
    })
    if (!app) {
      throw new BusinessException(ErrorCode.AppNotFound, '应用不存在或无权')
    }
    return app
  }

  /** 创建应用（blank = 直接 active；draft = AI 草稿，不占 active 额度但限 3 个） */
  async create(userId: bigint, dto: CreateAppDto) {
    const name = dto.name.trim()
    if (!name) {
      throw new BusinessException(ErrorCode.ParamInvalid, '应用名称不能为空')
    }
    const mode = dto.mode ?? 'blank'
    if (mode === 'draft') {
      const drafts = await this.prisma.appDef.count({
        where: { ownerId: userId, status: APP_STATUS_DRAFT, deletedAt: null },
      })
      const maxDrafts = this.config.get<number>('app.maxDraftsPerUser', 3)
      if (drafts >= maxDrafts) {
        throw new BusinessException(
          ErrorCode.AppQuotaExceeded,
          `草稿数量已达上限（${maxDrafts} 个），请先确认入册或删除草稿`,
        )
      }
    } else {
      await this.assertActiveQuota(userId)
    }

    const code = await this.uniqueCode(userId, name)
    const pubCode = await this.genPubCode()
    const app = await this.prisma.appDef.create({
      data: {
        code,
        pubCode,
        name,
        description: dto.description?.trim() || null,
        status: mode === 'draft' ? APP_STATUS_DRAFT : APP_STATUS_ACTIVE,
        ownerId: userId,
      },
    })
    return { appCode: app.code, pubCode: app.pubCode, status: app.status }
  }

  /** 我的应用列表（不分页；?status=draft 只看草稿），附统计数字（批量 groupBy，避免 N+1） */
  async list(userId: bigint, query: ListAppQueryDto) {
    const where: Prisma.AppDefWhereInput = { ownerId: userId, deletedAt: null }
    if (query.status) where.status = query.status
    const apps = await this.prisma.appDef.findMany({ where, orderBy: { updatedAt: 'desc' } })
    if (apps.length === 0) return []
    const appIds = apps.map((app) => app.id)

    const [tableCounts, rowCounts, pageCounts] = await Promise.all([
      this.prisma.appTable.groupBy({
        by: ['appId'],
        where: { appId: { in: appIds }, deletedAt: null, isSystem: 0 },
        _count: { _all: true },
      }),
      this.prisma.appRecord.groupBy({
        by: ['appId'],
        where: { appId: { in: appIds }, deletedAt: null },
        _count: { _all: true },
      }),
      this.prisma.appPage.groupBy({
        by: ['appId'],
        where: { appId: { in: appIds }, deletedAt: null },
        _count: { _all: true },
      }),
    ])
    const toMap = (rows: Array<{ appId: bigint; _count: { _all: number } }>) =>
      new Map(rows.map((row) => [row.appId.toString(), row._count._all]))
    const tMap = toMap(tableCounts)
    const rMap = toMap(rowCounts)
    const pMap = toMap(pageCounts)

    return apps.map((app) => {
      const key = app.id.toString()
      return {
        appCode: app.code,
        pubCode: app.pubCode,
        name: app.name,
        description: app.description,
        status: app.status,
        tableCount: tMap.get(key) ?? 0,
        rowCount: rMap.get(key) ?? 0,
        pageCount: pMap.get(key) ?? 0,
        updatedAt: app.updatedAt,
      }
    })
  }

  /** 应用详情（含统计数字） */
  async detail(userId: bigint, code: string) {
    const app = await this.assertOwned(userId, code)
    const stats = await this.stats(app.id)
    return {
      appCode: app.code,
      pubCode: app.pubCode,
      name: app.name,
      description: app.description,
      status: app.status,
      ...stats,
      createdAt: app.createdAt,
      updatedAt: app.updatedAt,
    }
  }

  /** 改名称/描述 */
  async update(userId: bigint, code: string, dto: UpdateAppDto) {
    const app = await this.assertOwned(userId, code)
    const data: Prisma.AppDefUpdateInput = {}
    if (dto.name !== undefined) {
      const name = dto.name.trim()
      if (!name) throw new BusinessException(ErrorCode.ParamInvalid, '应用名称不能为空')
      data.name = name
    }
    if (dto.description !== undefined) {
      data.description = dto.description.trim() || null
    }
    if (Object.keys(data).length === 0) {
      throw new BusinessException(ErrorCode.ParamInvalid, '没有需要更新的字段')
    }
    const updated = await this.prisma.appDef.update({ where: { id: app.id }, data })
    return { appCode: updated.code, name: updated.name, description: updated.description }
  }

  /**
   * 软删应用（级联软删表/字段/页/关系；app_record 数据保留 30 天后由清理任务物理删）。
   * 软删后立即 404（属主校验过滤 deletedAt）。
   */
  async remove(userId: bigint, code: string) {
    const app = await this.assertOwned(userId, code)
    await this.softDelete(app.id)
    return { success: true, appCode: app.code }
  }

  /**
   * draft → active（确认入册）：查配额；草稿过期/非草稿 50008。
   * 过期草稿顺手清理（软删），避免长期占用草稿额度。
   */
  async confirm(userId: bigint, code: string) {
    const app = await this.assertOwned(userId, code)
    if (app.status !== APP_STATUS_DRAFT) {
      throw new BusinessException(ErrorCode.AppDraftExpired, '草稿不存在或已确认')
    }
    const ttlDays = this.config.get<number>('app.draftTtlDays', 7)
    const expireAt = app.createdAt.getTime() + ttlDays * 24 * 60 * 60 * 1000
    if (Date.now() > expireAt) {
      await this.softDelete(app.id)
      throw new BusinessException(ErrorCode.AppDraftExpired, '草稿已过期，请重新创建')
    }
    await this.assertActiveQuota(userId)
    await this.prisma.appDef.update({
      where: { id: app.id },
      data: { status: APP_STATUS_ACTIVE },
    })
    return {
      appCode: app.code,
      status: APP_STATUS_ACTIVE,
      menuHint: '功能页已挂到应用中心菜单',
    }
  }

  // ===== P12 T109：公开面暴露管理（R100 / R103 / R108，API §19.1）=====

  /** 公开页前端路由（相对路径，前端拼域名；照站点分享先例） */
  private pubUrl(pubCode: string): string {
    return `/pub/app/${pubCode}`
  }

  /**
   * R103 发布校验（返回缺项清单，空数组 = 可发布）：
   * ① ≥1 张已暴露表；② ≥1 个已公开 display 页；
   * ③ 每个公开页的 dataSources（含 expand/ref 目标表）与区块字段 DSL 引用的表·字段全部已暴露。
   */
  private async collectPublishMissing(appId: bigint): Promise<string[]> {
    const missing: string[] = []
    const tables = await this.prisma.appTable.findMany({
      where: { appId, deletedAt: null, isSystem: 0 },
      select: { id: true, name: true, label: true, isExposed: true },
    })
    const tableById = new Map(tables.map((table) => [table.id.toString(), table]))
    const exposedTableByName = new Map(
      tables.filter((table) => table.isExposed === 1).map((table) => [table.name, table]),
    )
    if (exposedTableByName.size === 0) {
      missing.push('至少需要 1 张已暴露的表')
    }

    const fields = tables.length
      ? await this.prisma.appField.findMany({
          where: { tableId: { in: tables.map((table) => table.id) }, isDeleted: 0 },
          select: { tableId: true, name: true, isExposed: true, refTableId: true },
        })
      : []
    const exposedFieldsByTableId = new Map<string, Set<string>>()
    /** ref 字段 → 目标表名（"表.字段" → 目标表名），供 expand/ref 目标暴露校验 */
    const refTargetByField = new Map<string, string>()
    for (const field of fields) {
      const tableKey = field.tableId.toString()
      if (field.isExposed === 1) {
        const set = exposedFieldsByTableId.get(tableKey) ?? new Set<string>()
        set.add(field.name)
        exposedFieldsByTableId.set(tableKey, set)
      }
      if (field.refTableId) {
        const owner = tableById.get(tableKey)
        const target = tableById.get(field.refTableId.toString())
        if (owner && target) refTargetByField.set(`${owner.name}.${field.name}`, target.name)
      }
    }

    const publicPages = await this.prisma.appPage.findMany({
      where: { appId, deletedAt: null, kind: PAGE_KIND_DISPLAY, isPublic: 1 },
      select: { code: true, name: true, schema: true },
    })
    if (publicPages.length === 0) {
      missing.push('至少需要 1 个已公开的展示页（display）')
    }

    for (const page of publicPages) {
      const schema = page.schema
      if (!isPlainRecord(schema)) {
        missing.push(`展示页「${page.name}」模式非法`)
        continue
      }
      const dataSources = isPlainRecord(schema.dataSources) ? schema.dataSources : {}
      /** 数据源名 → 表名（区块 bind 反查表用） */
      const tableNameByDs = new Map<string, string>()
      for (const [dsName, ds] of Object.entries(dataSources)) {
        if (!isPlainRecord(ds) || typeof ds.table !== 'string') continue
        const tableName = ds.table
        tableNameByDs.set(dsName, tableName)
        const table = exposedTableByName.get(tableName)
        if (!table) {
          missing.push(`展示页「${page.name}」数据源 ${dsName} 引用的表未暴露：${tableName}`)
          continue
        }
        const allowed = exposedFieldsByTableId.get(table.id.toString()) ?? new Set<string>()
        const refs: string[] = []
        if (Array.isArray(ds.fields)) {
          refs.push(...ds.fields.filter((field): field is string => typeof field === 'string'))
        }
        for (const key of ['filter', 'sort', 'expand'] as const) {
          const list = ds[key]
          if (!Array.isArray(list)) continue
          for (const item of list) {
            if (isPlainRecord(item) && typeof item.f === 'string') refs.push(item.f)
          }
        }
        for (const ref of refs) {
          if (ref === 'rowId') continue
          if (!allowed.has(ref)) {
            missing.push(`展示页「${page.name}」数据源 ${dsName} 引用的字段未暴露：${tableName}.${ref}`)
            continue
          }
          const target = refTargetByField.get(`${tableName}.${ref}`)
          if (target && !exposedTableByName.has(target)) {
            missing.push(`展示页「${page.name}」字段 ${tableName}.${ref} 的目标表未暴露：${target}`)
          }
        }
      }

      const layout = Array.isArray(schema.layout) ? schema.layout : []
      layout.forEach((block, blockIndex) => {
        if (!isPlainRecord(block) || typeof block.bind !== 'string') return
        const tableName = tableNameByDs.get(block.bind)
        const table = tableName ? exposedTableByName.get(tableName) : undefined
        if (!tableName || !table) return
        const allowed = exposedFieldsByTableId.get(table.id.toString()) ?? new Set<string>()
        for (const key of ['columns', 'fields'] as const) {
          const list = block[key]
          if (!Array.isArray(list)) continue
          for (const raw of list) {
            if (typeof raw !== 'string') continue
            const dsl = parseFieldDsl(raw)
            if (dsl.field && dsl.field !== 'rowId' && !allowed.has(dsl.field)) {
              missing.push(`展示页「${page.name}」区块 ${blockIndex} 字段未暴露：${tableName}.${dsl.field}`)
            }
            const explicitTarget = dslTargetTable(dsl)
            const inferredTarget = dsl.field
              ? refTargetByField.get(`${tableName}.${dsl.field}`)
              : undefined
            const target = explicitTarget ?? inferredTarget
            if (target && !exposedTableByName.has(target)) {
              missing.push(`展示页「${page.name}」区块 ${blockIndex} 展开目标表未暴露：${target}`)
            }
          }
        }
      })
    }

    return missing
  }

  /** 发布 / 取消发布（R103：置 1 先校验，缺项 50012 带清单；置 0 即时失效公开端） */
  async publish(userId: bigint, code: string, isPublic: number) {
    const app = await this.assertOwned(userId, code)
    const flag = isPublic === 1 ? 1 : 0
    if (flag === 1) {
      const missing = await this.collectPublishMissing(app.id)
      if (missing.length > 0) {
        const head = missing.slice(0, 5).join('；')
        throw new BusinessException(
          ErrorCode.AppPublishInvalid,
          `发布校验未通过：${head}${missing.length > 5 ? `（共 ${missing.length} 项）` : ''}`,
        )
      }
    }
    await this.prisma.appDef.update({ where: { id: app.id }, data: { isPublic: flag } })
    await invalidatePubAll(this.redis, app.id)
    return { isPublic: flag, pubCode: app.pubCode, pubUrl: this.pubUrl(app.pubCode) }
  }

  /** 公开总览（前端引导用）：状态 + 链接 + 表/字段暴露明细 + 公开页 + 当前缺项清单 */
  async pubConfig(userId: bigint, code: string) {
    const app = await this.assertOwned(userId, code)
    const [tables, pages, missing] = await Promise.all([
      this.prisma.appTable.findMany({
        where: { appId: app.id, deletedAt: null, isSystem: 0 },
        select: { id: true, name: true, label: true, isExposed: true },
        orderBy: { id: 'asc' },
      }),
      this.prisma.appPage.findMany({
        where: { appId: app.id, deletedAt: null, kind: PAGE_KIND_DISPLAY },
        select: { id: true, code: true, name: true, route: true, isPublic: true },
        orderBy: { sort: 'asc' },
      }),
      this.collectPublishMissing(app.id),
    ])
    const fields = tables.length
      ? await this.prisma.appField.findMany({
          where: { tableId: { in: tables.map((table) => table.id) }, isDeleted: 0 },
          select: { id: true, tableId: true, name: true, label: true, type: true, isExposed: true },
          orderBy: [{ tableId: 'asc' }, { sort: 'asc' }],
        })
      : []
    const fieldsByTable = new Map<string, typeof fields>()
    for (const field of fields) {
      const key = field.tableId.toString()
      const list = fieldsByTable.get(key) ?? []
      list.push(field)
      fieldsByTable.set(key, list)
    }
    return {
      isPublic: app.isPublic,
      pubCode: app.pubCode,
      pubUrl: this.pubUrl(app.pubCode),
      exposedTables: tables
        .filter((table) => table.isExposed === 1)
        .map((table) => ({ id: table.id.toString(), tableCode: table.name, label: table.label })),
      tables: tables.map((table) => ({
        id: table.id.toString(),
        tableCode: table.name,
        label: table.label,
        isExposed: table.isExposed,
        fields: (fieldsByTable.get(table.id.toString()) ?? []).map((field) => ({
          id: field.id.toString(),
          name: field.name,
          label: field.label,
          type: field.type,
          isExposed: field.isExposed,
        })),
      })),
      publicPages: pages.map((page) => ({
        id: page.id.toString(),
        pageCode: page.code,
        name: page.name,
        route: page.route,
        isPublic: page.isPublic,
      })),
      missing,
    }
  }

  /** 表级暴露开关（R100；表关闭时字段开关前端禁用，服务端仍照实落库） */
  async setTableExpose(userId: bigint, code: string, tableId: bigint, isExposed: number) {
    const app = await this.assertOwned(userId, code)
    const table = await this.prisma.appTable.findFirst({
      where: { id: tableId, appId: app.id, deletedAt: null },
      select: { id: true, name: true },
    })
    if (!table) {
      throw new BusinessException(ErrorCode.AppNotFound, '数据表不存在或无权')
    }
    const flag = isExposed === 1 ? 1 : 0
    await this.prisma.appTable.update({ where: { id: table.id }, data: { isExposed: flag } })
    await invalidatePubAll(this.redis, app.id)
    return { tableCode: table.name, isExposed: flag }
  }

  /** 字段级暴露开关（R100；受表门禁——表未暴露时公开面仍不输出该字段） */
  async setFieldExpose(userId: bigint, code: string, fieldId: bigint, isExposed: number) {
    const app = await this.assertOwned(userId, code)
    // relationMode=prisma：无物理外键亦无 Prisma relation 字段 → 两步校验（先取表集合，再定位字段）
    const ownedTableIds = (
      await this.prisma.appTable.findMany({
        where: { appId: app.id, deletedAt: null },
        select: { id: true },
      })
    ).map((table) => table.id)
    const field = ownedTableIds.length
      ? await this.prisma.appField.findFirst({
          where: { id: fieldId, tableId: { in: ownedTableIds }, isDeleted: 0 },
          select: { id: true, name: true },
        })
      : null
    if (!field) {
      throw new BusinessException(ErrorCode.AppNotFound, '字段不存在或无权')
    }
    const flag = isExposed === 1 ? 1 : 0
    await this.prisma.appField.update({ where: { id: field.id }, data: { isExposed: flag } })
    await invalidatePubAll(this.redis, app.id)
    return { field: field.name, isExposed: flag }
  }

  /**
   * R114（P12-PATCH2 T116）：列当前用户未删应用（含公开态 + 公开凭证 + 发布缺项），
   * 供 AI 只读工具 `list_data_apps` 经 AppFacade 消费。draft 也列出（status 标明）；
   * `missing` 复用 collectPublishMissing（与 `GET /app/:code/pub-config` 同源逻辑）；
   * 已发布的应用不再计算缺项（公开态下必为空，省一次全表扫描）。
   * **只读**：不代发布、不改任何状态。
   */
  async listWithPubState(userId: bigint): Promise<
    Array<{
      appCode: string
      name: string
      status: string
      isPublic: number
      pubCode: string
      pubUrl: string
      missing: string[]
    }>
  > {
    const apps = await this.prisma.appDef.findMany({
      where: { ownerId: userId, deletedAt: null },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: { id: true, code: true, name: true, status: true, isPublic: true, pubCode: true },
    })
    const result: Array<{
      appCode: string
      name: string
      status: string
      isPublic: number
      pubCode: string
      pubUrl: string
      missing: string[]
    }> = []
    for (const app of apps) {
      result.push({
        appCode: app.code,
        name: app.name,
        status: app.status,
        isPublic: app.isPublic,
        pubCode: app.pubCode,
        pubUrl: this.pubUrl(app.pubCode),
        missing: app.isPublic === 1 ? [] : await this.collectPublishMissing(app.id),
      })
    }
    return result
  }

  /** 软删过期草稿（R91：7 天未确认自动清理；cron 每日触发，可手动调用验证） */
  async cleanExpiredDrafts(): Promise<{ scanned: number; cleaned: number }> {
    const ttlDays = this.config.get<number>('app.draftTtlDays', 7)
    const result = await cleanExpiredDraftsCore(this.prisma, ttlDays)
    for (const id of result.ids) {
      await this.invalidateSchema(id)
    }
    return { scanned: result.scanned, cleaned: result.cleaned }
  }

  /** 物理清理软删超期应用（数据保留 30 天，照回收站口径；cron 每日触发） */
  async purgeDeletedApps(): Promise<{ purged: number }> {
    const result = await purgeDeletedAppsCore(this.prisma)
    if (result.purged > 0) {
      this.logger.log(`应用数据物理清理完成：${result.purged} 个软删超期应用`)
    }
    return { purged: result.purged }
  }

  /** 失效公开数据缓存（R105：写路径事务提交后由 PageService / ImportService 调用，键族按 appId 隔离） */
  async invalidatePubCache(appId: bigint): Promise<void> {
    await invalidatePubData(this.redis, appId)
  }

  /** 失效应用 schema 缓存（结构/页面/应用变更即 DEL，R99） */
  async invalidateSchema(appId: bigint): Promise<void> {
    await invalidateAppSchema(this.redis, appId)
  }

  /**
   * R96：userinfo 菜单动态段数据源——该用户 active 应用 + 各应用功能页（不落 sys_menu）。
   * 应用软删 / 草稿态即不出现（下次拉 userinfo 即时消失，零种子依赖）。
   */
  async getAppMenuSegments(
    userId: bigint,
  ): Promise<
    Array<{ appCode: string; name: string; pages: Array<{ code: string; name: string }> }>
  > {
    const apps = await this.prisma.appDef.findMany({
      where: { ownerId: userId, status: APP_STATUS_ACTIVE, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true, code: true, name: true },
    })
    if (apps.length === 0) return []
    const pages = await this.prisma.appPage.findMany({
      where: { appId: { in: apps.map((app) => app.id) }, deletedAt: null },
      orderBy: [{ sort: 'asc' }, { id: 'asc' }],
      select: { appId: true, code: true, name: true },
    })
    return apps.map((app) => ({
      appCode: app.code,
      name: app.name,
      pages: pages
        .filter((page) => page.appId === app.id)
        .map((page) => ({ code: page.code, name: page.name })),
    }))
  }

  // ==================== 内部 ====================

  /** active 应用配额校验（50002，message 带配额项） */
  private async assertActiveQuota(userId: bigint): Promise<void> {
    const actives = await this.prisma.appDef.count({
      where: { ownerId: userId, status: APP_STATUS_ACTIVE, deletedAt: null },
    })
    const maxApps = this.config.get<number>('app.maxAppsPerUser', 10)
    if (actives >= maxApps) {
      throw new BusinessException(
        ErrorCode.AppQuotaExceeded,
        `数据应用数量已达上限（${maxApps} 个）`,
      )
    }
  }

  /** 统计数字 */
  private async stats(appId: bigint): Promise<AppStats> {
    const [tableCount, rowCount, pageCount] = await Promise.all([
      this.prisma.appTable.count({ where: { appId, deletedAt: null, isSystem: 0 } }),
      this.prisma.appRecord.count({ where: { appId, deletedAt: null } }),
      this.prisma.appPage.count({ where: { appId, deletedAt: null } }),
    ])
    return { tableCount, rowCount, pageCount }
  }

  /** 级联软删（应用 + 表/字段/页/关系）；记录与附件引用保留至物理清理（30 天） */
  private async softDelete(appId: bigint): Promise<void> {
    await softDeleteApp(this.prisma, appId)
    await this.invalidateSchema(appId)
  }

  /** 应用内唯一的 code（含已软删行，避免撞 DB 唯一索引；冲突 "(1)" 递增） */
  private async uniqueCode(userId: bigint, name: string): Promise<string> {
    const base = slugify(name)
    const existing = await this.prisma.appDef.findMany({
      where: { ownerId: userId },
      select: { code: true },
    })
    const taken = new Set(existing.map((row) => row.code))
    if (!taken.has(base)) return base
    for (let i = 1; i <= CODE_SUFFIX_MAX; i++) {
      const candidate = `${base}(${i})`
      if (!taken.has(candidate)) return candidate
    }
    throw new BusinessException(ErrorCode.AppQuotaExceeded, '应用标识生成失败，请更换名称')
  }

  /** 全局唯一 pubCode（R93：12 位字母数字；本项目单机写入，重试 10 次足够） */
  private async genPubCode(): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt++) {
      let code = ''
      for (let i = 0; i < PUB_CODE_LENGTH; i++) {
        code += PUB_CODE_ALPHABET[randomInt(PUB_CODE_ALPHABET.length)]
      }
      const exists = await this.prisma.appDef.findUnique({
        where: { pubCode: code },
        select: { id: true },
      })
      if (!exists) return code
    }
    throw new BusinessException(ErrorCode.InternalError, 'pubCode 生成失败，请重试')
  }
}
