import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma, type MarketListing } from '@prisma/client'
import { randomInt } from 'node:crypto'
import { ErrorCode } from '../../../common/constants/error-code'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import { AppFacade } from '../../app/facade/app-facade.service'
import { UserService } from '../../system/user/user.service'
import { assertSnapshotSize, parseDemoData, parseSnapshot } from '../snapshot/snapshot-marshal.core'
import { buildSnapshot, type AppSnapshot } from '../snapshot/snapshot'
import type { ListMarketQueryDto, SubmitListingDto } from './dto/listing.dto'

/** 条目状态（D108 状态机：pending → approved | rejected → delisted） */
export const LISTING_STATUS_PENDING = 'pending'
export const LISTING_STATUS_APPROVED = 'approved'
export const LISTING_STATUS_REJECTED = 'rejected'
export const LISTING_STATUS_DELISTED = 'delisted'

/** 活跃条目（每应用同时仅 1 个，50013） */
export const ACTIVE_LISTING_STATUSES: readonly string[] = [
  LISTING_STATUS_PENDING,
  LISTING_STATUS_APPROVED,
]

/** 源应用必须已入册（草稿不可提交市场） */
const APP_STATUS_ACTIVE = 'active'

/** 列表默认每页条数 */
const DEFAULT_PAGE_SIZE = 12

/** 条目编号随机后缀（R93 slug 先例：4 位 base36） */
const CODE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
const CODE_SUFFIX_LENGTH = 4
const CODE_RETRY = 10

/** 名称 → 条目编号基础片段（R：对外展示用，slug 化） */
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

/** 快照/演示数据派生的卡片数字（列表与审核预览共用） */
interface SnapshotSummary {
  tableCount: number
  pageCount: number
  tables: Array<{ name: string; label: string; fieldCount: number }>
  pages: Array<{ name: string; route: string; kind: string }>
}

function summarize(snapshot: AppSnapshot): SnapshotSummary {
  return {
    tableCount: snapshot.tables.length,
    pageCount: snapshot.pages.length,
    tables: snapshot.tables.map((table) => ({
      name: table.name,
      label: table.label,
      fieldCount: table.fields.length,
    })),
    pages: snapshot.pages.map((page) => ({
      name: page.name,
      route: page.route,
      kind: page.kind,
    })),
  }
}

/**
 * 市场用户侧服务（P13 T118，API §20.1 用户侧 5 端点）：
 * 提交（快照物化）/ 我的提交 / 浏览列表 / 条目详情 / 复制物化。
 *
 * 域边界（ARCH §29.1/§29.3）：market 域**零跨域 import app 内部**——
 * 结构导出、演示数据读取、复制物化全部经 AppFacade；数据写入红线由 app 域 DataService 承接。
 * 市场可见性（R120）：仅登录用户；浏览只出 approved 且未 delisted；详情/复制对非在架条目统一 50014（防探测）。
 */
@Injectable()
export class ListingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly appFacade: AppFacade,
    private readonly userService: UserService,
  ) {}

  /**
   * 提交市场（R117/R118/R121）：导出结构 → 快照物化 → 50013 活跃条目校验 → 50015 演示数据/快照护栏
   * → 落 pending 条目（源应用后续变更不影响快照，D107）。
   */
  async submit(
    userId: bigint,
    dto: SubmitListingDto,
  ): Promise<{ ok: true; listingCode: string; status: string }> {
    const appCode = dto.appCode.trim()
    const withDemoData = dto.withDemoData === true

    const source = await this.appFacade.exportStructure(userId, appCode)
    if (source.status !== APP_STATUS_ACTIVE) {
      throw new BusinessException(ErrorCode.MarketSubmitInvalid, '草稿应用不可提交市场，请先确认入册')
    }
    const sourceAppId = BigInt(source.appId)

    const duplicate = await this.prisma.marketListing.findFirst({
      where: { publisherId: userId, sourceAppId, status: { in: [...ACTIVE_LISTING_STATUSES] } },
      select: { code: true, status: true },
    })
    if (duplicate) {
      throw new BusinessException(
        ErrorCode.MarketListingConflict,
        `该应用已有待审或在架条目（${duplicate.code}，${duplicate.status}），请勿重复提交`,
      )
    }

    const snapshot = buildSnapshot(source)
    assertSnapshotSize(snapshot, this.config.get<number>('market.snapshotMaxBytes', 256 * 1024))

    let demoData: Record<string, Array<{ rowId: string; data: Record<string, unknown> }>> | null = null
    if (withDemoData) {
      const maxRows = this.config.get<number>('market.demoMaxRowsPerTable', 100)
      const demo = await this.appFacade.readDemoRows(userId, appCode, maxRows)
      const overflow = demo.tables.find((table) => table.truncated)
      if (overflow) {
        throw new BusinessException(
          ErrorCode.MarketSubmitInvalid,
          `演示数据超出上限（单表 ${maxRows} 行）：表 ${overflow.table}`,
        )
      }
      demoData = {}
      for (const table of demo.tables) {
        demoData[table.table] = table.rows
      }
    }

    const publisher = await this.userService.findById(userId)
    const code = await this.uniqueListingCode(source.name)
    const listing = await this.prisma.marketListing.create({
      data: {
        code,
        publisherId: userId,
        publisherName: publisher.nickname ?? publisher.username ?? null,
        sourceAppId,
        name: source.name,
        description: source.description,
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
        demoData: demoData ? (demoData as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        hasDemo: demoData ? 1 : 0,
        status: LISTING_STATUS_PENDING,
      },
    })
    return { ok: true, listingCode: listing.code, status: listing.status }
  }

  /** 我的提交（全状态，时间倒序；含审核意见、卡片数字与源应用 code） */
  async listMine(userId: bigint) {
    const rows = await this.prisma.marketListing.findMany({
      where: { publisherId: userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })
    const ids = [...new Set(rows.map((row) => row.sourceAppId))]
    const codes = await this.appFacade.appCodesByIds(userId, ids)
    const codeById = new Map(codes.map((item) => [item.id, item.code]))
    return rows.map((row) => this.toMineItem(row, codeById.get(row.sourceAppId.toString()) ?? null))
  }

  /** 浏览列表（R120：approved 且未 delisted，按上架时间倒序，分页 ≤50） */
  async list(query: ListMarketQueryDto) {
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE
    const where: Prisma.MarketListingWhereInput = {
      status: LISTING_STATUS_APPROVED,
      delistedAt: null,
    }
    const [rows, total] = await Promise.all([
      this.prisma.marketListing.findMany({
        where,
        orderBy: [{ listedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.marketListing.count({ where }),
    ])
    return {
      list: rows.map((row) => {
        const summary = summarize(parseSnapshot(row.snapshot))
        return {
          code: row.code,
          name: row.name,
          description: row.description,
          publisherName: row.publisherName,
          tableCount: summary.tableCount,
          pageCount: summary.pageCount,
          hasDemo: row.hasDemo === 1,
          copyCount: row.copyCount,
          listedAt: row.listedAt,
        }
      }),
      total,
      page,
      pageSize,
    }
  }

  /** 条目详情（元数据卡片全字段 + 结构摘要；非在架 → 50014） */
  async detail(code: string) {
    const listing = await this.findListedByCode(code)
    const summary = summarize(parseSnapshot(listing.snapshot))
    return {
      code: listing.code,
      name: listing.name,
      description: listing.description,
      publisherName: listing.publisherName,
      hasDemo: listing.hasDemo === 1,
      copyCount: listing.copyCount,
      listedAt: listing.listedAt,
      tableCount: summary.tableCount,
      pageCount: summary.pageCount,
      tables: summary.tables,
      pages: summary.pages,
    }
  }

  /**
   * 复制物化为接收方新应用（R119）：快照结构 + 可选演示数据经 AppFacade 在 app 域内落库；
   * 成功后 copy_count +1；配额不足 50002；条目不可复制 50014。
   */
  async copy(userId: bigint, code: string) {
    const listing = await this.findListedByCode(code)
    const snapshot = parseSnapshot(listing.snapshot)
    const demoData = listing.demoData ? parseDemoData(listing.demoData) : null
    const result = await this.appFacade.materializeListing(userId, {
      name: listing.name,
      description: listing.description,
      sourceAppId: listing.sourceAppId,
      snapshot,
      demoData,
    })
    await this.prisma.marketListing.update({
      where: { id: listing.id },
      data: { copyCount: { increment: 1 } },
    })
    return {
      appCode: result.appCode,
      tableCount: result.tableCount,
      pageCount: result.pageCount,
      rowCount: result.rowCount,
      skippedRows: result.skippedRows,
    }
  }

  // ==================== 内部 ====================

  /** 在架条目（approved 且未 delisted）；否则统一 50014（防探测） */
  private async findListedByCode(code: string): Promise<MarketListing> {
    const listing = await this.prisma.marketListing.findFirst({
      where: { code, status: LISTING_STATUS_APPROVED, delistedAt: null },
    })
    if (!listing) {
      throw new BusinessException(ErrorCode.MarketListingNotFound, '市场条目不存在或未上架')
    }
    return listing
  }

  /** 我的提交项（不返回快照本体，只给摘要，避免 payload 过大） */
  private toMineItem(row: MarketListing, appCode: string | null) {
    const summary = summarize(parseSnapshot(row.snapshot))
    return {
      code: row.code,
      appCode,
      name: row.name,
      description: row.description,
      status: row.status,
      hasDemo: row.hasDemo === 1,
      copyCount: row.copyCount,
      reviewNote: row.reviewNote,
      tableCount: summary.tableCount,
      pageCount: summary.pageCount,
      tables: summary.tables,
      pages: summary.pages,
      createdAt: row.createdAt,
      reviewedAt: row.reviewedAt,
      listedAt: row.listedAt,
      delistedAt: row.delistedAt,
    }
  }

  /** 条目编号：slug + 4 位随机（全局唯一，冲突重试 R93 先例） */
  private async uniqueListingCode(name: string): Promise<string> {
    const base = slugify(name)
    for (let attempt = 0; attempt < CODE_RETRY; attempt++) {
      let suffix = ''
      for (let i = 0; i < CODE_SUFFIX_LENGTH; i++) {
        suffix += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
      }
      const candidate = `${base}-${suffix}`
      const exists = await this.prisma.marketListing.findUnique({
        where: { code: candidate },
        select: { id: true },
      })
      if (!exists) return candidate
    }
    throw new BusinessException(ErrorCode.InternalError, '市场条目编号生成失败，请重试')
  }
}
