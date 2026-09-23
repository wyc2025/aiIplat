import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { AppDef, Prisma } from '@prisma/client'
import { randomInt } from 'node:crypto'
import { ErrorCode } from '../../../common/constants/error-code'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import { RedisService } from '../../../infra/redis/redis.service'
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
