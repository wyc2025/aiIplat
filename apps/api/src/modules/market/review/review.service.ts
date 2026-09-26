import { Injectable } from '@nestjs/common'
import { ErrorCode } from '../../../common/constants/error-code'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import { parseSnapshot } from '../snapshot/snapshot-marshal.core'
import {
  LISTING_STATUS_APPROVED,
  LISTING_STATUS_DELISTED,
  LISTING_STATUS_PENDING,
  LISTING_STATUS_REJECTED,
} from '../listing/listing.service'
import type { ReviewListingDto } from './dto/review.dto'

/**
 * 市场审核服务（P13 T119，D108/R121；API §20.1 审核侧）。
 *
 * 状态机：pending → approved | rejected；approved → delisted（其余流转 40001）。
 * 拒绝必填 note；审核动作全部挂 @OperationLog（控制器层）。
 * 审核是**人的事**（AI 代审核永不做，PRD §9）。
 */
@Injectable()
export class ReviewService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 审核列表（含快照摘要：表/页清单，供审核预览结构）。
   * @param status pending（默认，FIFO 先提交先审）| approved（在架，供下架操作）
   */
  async list(status: string = LISTING_STATUS_PENDING) {
    const where = status === LISTING_STATUS_APPROVED
      ? { status: LISTING_STATUS_APPROVED, delistedAt: null }
      : { status: LISTING_STATUS_PENDING }
    const rows = await this.prisma.marketListing.findMany({
      where,
      orderBy: status === LISTING_STATUS_APPROVED
        ? [{ listedAt: 'desc' as const }, { id: 'desc' as const }]
        : [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
    })
    return rows.map((row) => {
      const snapshot = parseSnapshot(row.snapshot)
      return {
        id: row.id.toString(),
        code: row.code,
        name: row.name,
        description: row.description,
        publisherId: row.publisherId.toString(),
        publisherName: row.publisherName,
        hasDemo: row.hasDemo === 1,
        createdAt: row.createdAt,
        listedAt: row.listedAt,
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
    })
  }

  /** 审核动作（approve 写 listed_at；reject 必填 note；delist 写 delisted_at） */
  async review(reviewerId: bigint, id: bigint, dto: ReviewListingDto) {
    const listing = await this.prisma.marketListing.findUnique({ where: { id } })
    if (!listing) {
      throw new BusinessException(ErrorCode.MarketListingNotFound, '市场条目不存在')
    }
    const now = new Date()

    if (dto.action === 'approve') {
      this.assertStatus(listing.status, [LISTING_STATUS_PENDING], '通过')
      const updated = await this.prisma.marketListing.update({
        where: { id: listing.id },
        data: {
          status: LISTING_STATUS_APPROVED,
          reviewNote: dto.note?.trim() || null,
          reviewerId,
          reviewedAt: now,
          listedAt: now,
        },
      })
      return { id: updated.id.toString(), code: updated.code, status: updated.status, listedAt: updated.listedAt }
    }

    if (dto.action === 'reject') {
      this.assertStatus(listing.status, [LISTING_STATUS_PENDING], '拒绝')
      const note = dto.note?.trim()
      if (!note) {
        throw new BusinessException(ErrorCode.ParamInvalid, '拒绝必须填写理由（note）')
      }
      const updated = await this.prisma.marketListing.update({
        where: { id: listing.id },
        data: {
          status: LISTING_STATUS_REJECTED,
          reviewNote: note,
          reviewerId,
          reviewedAt: now,
        },
      })
      return { id: updated.id.toString(), code: updated.code, status: updated.status }
    }

    this.assertStatus(listing.status, [LISTING_STATUS_APPROVED], '下架')
    const updated = await this.prisma.marketListing.update({
      where: { id: listing.id },
      data: {
        status: LISTING_STATUS_DELISTED,
        reviewNote: dto.note?.trim() || listing.reviewNote,
        reviewerId,
        reviewedAt: now,
        delistedAt: now,
      },
    })
    return { id: updated.id.toString(), code: updated.code, status: updated.status }
  }

  /** 状态前置校验（不满足 → 40001；不泄露内部状态机语义以外的信息） */
  private assertStatus(current: string, allowed: readonly string[], action: string): void {
    if (!allowed.includes(current)) {
      throw new BusinessException(
        ErrorCode.ParamInvalid,
        `当前状态（${current}）不可执行「${action}」`,
      )
    }
  }
}
