import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Response } from 'express'
import { randomBytes } from 'node:crypto'
import { ErrorCode } from '../../../common/constants/error-code'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import { StorageService } from '../../../infra/storage/storage.service'
import type { ShareCreateDto, ShareExtendDto } from './dto/share.dto'

/** 有效期档位 → 毫秒（0 = 永久） */
const EXPIRE_DAYS_TO_MS: Record<number, number> = {
  1: 24 * 60 * 60 * 1000,
  7: 7 * 24 * 60 * 60 * 1000,
  30: 30 * 24 * 60 * 60 * 1000,
}

/**
 * 公开链接（P3 §13.6 / API.md §5.5）：
 * 管理侧（登录）：create（仅文件 + 审核门禁 R9 + 重复创建返回现存链接）/ list / stop / extend；
 * 访客侧（@Public）：info / download（校验链任一失败统一 30008，下载成功 visit_count+1）。
 */
@Injectable()
export class ShareService {
  private readonly logger = new Logger(ShareService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly storage: StorageService,
  ) {}

  /** 创建分享：仅文件（30009）→ 审核门禁（R9，30010）→ 重复创建返回现存有效链接（不重复建行） */
  async create(userId: bigint, dto: ShareCreateDto) {
    const fileId = BigInt(dto.fileId)
    const file = await this.prisma.cloudFile.findFirst({
      where: { id: fileId, userId, deletedAt: null },
    })
    if (!file) {
      throw new BusinessException(ErrorCode.CloudFileNotFound, '文件不存在或无权访问')
    }
    if (file.isDir !== 0) {
      throw new BusinessException(ErrorCode.CloudShareNotAllowed, '文件夹暂不支持创建公开链接')
    }

    // 审核门禁（R9）：开关开启且文件未通过审核 → 拒绝
    if (this.config.get<boolean>('upload.cloudAuditEnabled', false) && file.auditStatus !== 1) {
      throw new BusinessException(ErrorCode.CloudAuditNotPassed, '文件未通过内容审核，禁止分享')
    }

    // 重复创建：同一文件已有"有效"（未停止且未过期）链接 → 直接返回现存链接
    const existing = await this.findActiveShare(userId, fileId)
    if (existing) {
      return this.toCreateResult(existing)
    }

    const expireDays = dto.expireDays ?? 7
    const expireAt = this.expireDaysToDate(expireDays)
    const token = await this.generateUniqueToken()
    const created = await this.prisma.cloudShare.create({
      data: { userId, fileId, token, expireAt, status: 1 },
    })
    return this.toCreateResult(created)
  }

  /** 我的分享列表（不分页，创建时间倒序；status 后端计算：1 有效 / 0 已停止 / 2 已过期） */
  async list(userId: bigint) {
    const shares = await this.prisma.cloudShare.findMany({
      where: { userId },
      orderBy: { createTime: 'desc' },
    })
    // 收集涉及的文件（禁 JOIN，应用层聚合）
    const fileIds = shares.map((s) => s.fileId)
    const files = await this.prisma.cloudFile.findMany({
      where: { id: { in: fileIds } },
      select: { id: true, name: true, size: true, deletedAt: true },
    })
    const fileMap = new Map(files.map((f) => [f.id.toString(), f]))
    const now = new Date()

    return shares.map((s) => {
      const file = fileMap.get(s.fileId.toString())
      // status：已停止 0；已过期 2；否则 1（文件被删也视为"已过期/失效"？按契约仅 status 三态，文件删由校验链兜底）
      let status = 1
      if (s.status === 0) status = 0
      else if (s.expireAt && s.expireAt.getTime() < now.getTime()) status = 2

      return {
        id: s.id,
        fileId: s.fileId,
        fileName: file?.name ?? '',
        size: file?.size ?? BigInt(0),
        fileDeleted: file?.deletedAt != null || file == null,
        token: s.token,
        visitCount: s.visitCount,
        expireAt: s.expireAt,
        status,
        createTime: s.createTime,
      }
    })
  }

  /** 停止公开：链接即刻失效 */
  async stop(userId: bigint, id: bigint) {
    await this.assertOwnedShare(userId, id)
    await this.prisma.cloudShare.update({
      where: { id },
      data: { status: 0 },
    })
    return { success: true }
  }

  /** 延长时间：从 max(now, expireAt) 续一档；已停止不可延长（30008） */
  async extend(userId: bigint, dto: ShareExtendDto) {
    const id = BigInt(dto.id)
    const share = await this.assertOwnedShare(userId, id)
    if (share.status === 0) {
      throw new BusinessException(ErrorCode.CloudShareInvalid, '链接已停止，不可延长')
    }
    const base = Math.max(share.expireAt?.getTime() ?? 0, Date.now())
    const expireAt =
      dto.expireDays === 0 ? null : new Date(base + EXPIRE_DAYS_TO_MS[dto.expireDays])
    const updated = await this.prisma.cloudShare.update({
      where: { id },
      data: { expireAt },
    })
    return { id: updated.id.toString(), expireAt: updated.expireAt }
  }

  // ==================== 访客侧（@Public） ====================

  /** 链接信息：访问校验链任一失败统一 30008（不区分原因，防探测） */
  async publicInfo(token: string) {
    const { share, file } = await this.assertAccessible(token)
    return {
      fileName: file.name,
      size: file.size,
      expireAt: share.expireAt,
      visitCount: share.visitCount,
    }
  }

  /** 访客下载（attachment 原文件名，支持 Range）；成功 visit_count+1 */
  async publicDownload(token: string, range: string | null, res: Response) {
    const { share, file } = await this.assertAccessible(token)
    if (!file.storageName) {
      throw new BusinessException(ErrorCode.CloudShareInvalid, '链接无效')
    }
    const info = await this.storage.stat(file.storageName)
    if (!info) {
      throw new BusinessException(ErrorCode.InternalError, '文件存储异常，请联系管理员')
    }

    // 下载成功 visit_count+1（R8）
    await this.prisma.cloudShare.update({
      where: { id: share.id },
      data: { visitCount: { increment: 1 } },
    })

    await this.streamToResponse(
      { name: file.name, storageName: file.storageName! },
      info.size,
      res,
      range,
    )
  }

  // ==================== 私有方法 ====================

  /** 校验链（§13.6）：token 存在 → status=1 → 未过期 → 文件存在且未删 →（开关开启）audit_status=1；任一失败 30008 */
  private async assertAccessible(token: string) {
    const share = await this.prisma.cloudShare.findUnique({ where: { token } })
    const invalid = () => new BusinessException(ErrorCode.CloudShareInvalid, '分享链接无效')
    if (!share || share.status !== 1) throw invalid()
    if (share.expireAt && share.expireAt.getTime() < Date.now()) throw invalid()

    const file = await this.prisma.cloudFile.findFirst({
      where: { id: share.fileId, deletedAt: null },
    })
    if (!file || file.isDir !== 0) throw invalid()
    if (this.config.get<boolean>('upload.cloudAuditEnabled', false) && file.auditStatus !== 1) {
      throw invalid()
    }
    return { share, file }
  }

  /** 校验分享归属当前用户（管理侧操作） */
  private async assertOwnedShare(userId: bigint, id: bigint) {
    const share = await this.prisma.cloudShare.findFirst({
      where: { id, userId },
    })
    if (!share) {
      throw new BusinessException(ErrorCode.CloudShareInvalid, '分享记录不存在')
    }
    return share
  }

  /** 查找同文件现存"有效"链接（未停止且未过期） */
  private async findActiveShare(userId: bigint, fileId: bigint) {
    const now = new Date()
    const shares = await this.prisma.cloudShare.findMany({
      where: { userId, fileId, status: 1 },
    })
    return (
      shares.find((s) => !s.expireAt || s.expireAt.getTime() >= now.getTime()) ?? null
    )
  }

  /** 生成唯一 token（URL-safe，碰撞重试） */
  private async generateUniqueToken(): Promise<string> {
    for (let i = 0; i < 5; i++) {
      const token = randomBytes(16).toString('base64url')
      const exists = await this.prisma.cloudShare.findUnique({ where: { token } })
      if (!exists) return token
    }
    throw new BusinessException(ErrorCode.InternalError, '生成链接失败，请重试')
  }

  /** 有效期天数 → Date（0 = null 永久） */
  private expireDaysToDate(days: number): Date | null {
    if (days === 0) return null
    return new Date(Date.now() + EXPIRE_DAYS_TO_MS[days])
  }

  private toCreateResult(share: { token: string; expireAt: Date | null }) {
    return {
      token: share.token,
      url: `/share/${share.token}`,
      expireAt: share.expireAt,
    }
  }

  /** 访客下载流式输出（attachment + 原文件名，支持 Range；复用 T27 的 Range 语义） */
  private async streamToResponse(
    file: { name: string; storageName: string },
    size: number,
    res: Response,
    range: string | null,
  ) {
    const disposition = `attachment; filename="${this.asciiFallback(file.name)}"; filename*=UTF-8''${encodeURIComponent(file.name)}`

    const parsed = range ? this.parseRange(range, size) : null
    if (parsed === 'unsatisfiable') {
      res.status(416).set('Content-Range', `bytes */${size}`).end()
      return
    }
    if (parsed) {
      const length = parsed.end - parsed.start + 1
      res.status(206).set({
        'Accept-Ranges': 'bytes',
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': disposition,
        'Content-Range': `bytes ${parsed.start}-${parsed.end}/${size}`,
        'Content-Length': String(length),
      })
      this.storage
        .createReadStream(file.storageName, { start: parsed.start, end: parsed.end })
        .pipe(res)
      return
    }
    res.status(200).set({
      'Accept-Ranges': 'bytes',
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': disposition,
      'Content-Length': String(size),
    })
    this.storage.createReadStream(file.storageName).pipe(res)
  }

  private parseRange(header: string, size: number): { start: number; end: number } | 'unsatisfiable' | null {
    if (size === 0) return 'unsatisfiable'
    const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
    if (!match) return null
    const [, startRaw, endRaw] = match
    if (startRaw === '') {
      if (endRaw === '') return null
      const suffix = Number(endRaw)
      if (suffix === 0) return 'unsatisfiable'
      return { start: Math.max(0, size - suffix), end: size - 1 }
    }
    const start = Number(startRaw)
    if (start >= size) return 'unsatisfiable'
    const end = endRaw === '' ? size - 1 : Math.min(Number(endRaw), size - 1)
    if (end < start) return null
    return { start, end }
  }

  private asciiFallback(name: string): string {
    const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
    return ascii || 'file'
  }
}
