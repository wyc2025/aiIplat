import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Request, Response } from 'express'
import bcrypt from 'bcrypt'
import { randomBytes } from 'node:crypto'
import type { CloudFile, CloudShare } from '@prisma/client'
import { ErrorCode } from '../../../common/constants/error-code'
import { RedisKey } from '../../../common/constants/redis-key'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import { RedisService } from '../../../infra/redis/redis.service'
import { StorageService } from '../../../infra/storage/storage.service'
import { PackService } from '../transfer/pack.service'
import { resolvePubMime } from '../public/pub-mime'
import type {
  ShareCreateDto,
  ShareExtendDto,
  ShareListQueryDto,
  SharePasswordDto,
  ShareVerifyDto,
} from './dto/share.dto'

/** 有效期档位 → 毫秒（0 = 永久） */
const EXPIRE_DAYS_TO_MS: Record<number, number> = {
  1: 24 * 60 * 60 * 1000,
  7: 7 * 24 * 60 * 60 * 1000,
  30: 30 * 24 * 60 * 60 * 1000,
}

/** bcrypt 加密轮数（照登录口令口径） */
const BCRYPT_ROUNDS = 10
/** 短期访问凭证最长有效期（R42：≤ 分享剩余有效期，且不超过 2h） */
const SID_MAX_TTL_MS = 2 * 60 * 60 * 1000
/** 提取码连续错误上限与锁定时长（R42：照登录 10102 口径） */
const PASS_FAIL_MAX = 5
const PASS_FAIL_LOCK_SEC = 10 * 60
/** 文件夹分享子树下钻最大深度（有界防环，与公开判定链同口径） */
const MAX_DEPTH = 10

/**
 * 分享链接（P3 + P4d 升级；约定见 ARCHITECTURE.md §4.7 / §17.3）：
 * 管理侧（登录）：create（文件/文件夹 + 审核门禁 R9 + 重复创建返回现存链接 + 提取码 D47）/
 *   list（含 itemType / hasPassword）/ stop / extend / updatePassword；
 * 访客侧（@Public）：verify（提取码校验 → 短期凭证 sid）/ info / raw / list / download / pack；
 * 校验链任一失败统一 30008（防探测），未过密码门 → 30017，提取码错误 → 30018（含锁定剩余秒数）。
 */
@Injectable()
export class ShareService {
  private readonly logger = new Logger(ShareService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly storage: StorageService,
    private readonly redis: RedisService,
    private readonly packService: PackService,
  ) {}

  /** 创建分享：文件/文件夹（P4d D48）→ 审核门禁（R9，30010）→ 重复创建返回现存有效链接 */
  async create(userId: bigint, dto: ShareCreateDto) {
    const fileId = BigInt(dto.fileId)
    const file = await this.prisma.cloudFile.findFirst({
      where: { id: fileId, userId, deletedAt: null },
    })
    if (!file) {
      throw new BusinessException(ErrorCode.CloudFileNotFound, '文件不存在或无权访问')
    }
    // 注：P4d D48 起文件夹亦可分享（原 P3 的 30009「文件夹暂不支持创建分享链接」不再触发，
    // 错误码常量保留备用，T58 文档备案）

    // 审核门禁（R9）：开关开启且文件未通过审核 → 拒绝
    if (this.config.get<boolean>('upload.cloudAuditEnabled', false) && file.auditStatus !== 1) {
      throw new BusinessException(ErrorCode.CloudAuditNotPassed, '文件未通过内容审核，禁止分享')
    }

    // 重复创建：同一文件已有"有效"（未停止且未过期）链接 → 直接返回现存链接（含密码状态）
    const existing = await this.findActiveShare(userId, fileId)
    if (existing) {
      return this.toCreateResult(existing)
    }

    const expireDays = dto.expireDays ?? 7
    const expireAt = this.expireDaysToDate(expireDays)
    const token = await this.generateUniqueToken()
    const passwordHash = dto.password ? await bcrypt.hash(dto.password, BCRYPT_ROUNDS) : null
    const created = await this.prisma.cloudShare.create({
      data: { userId, fileId, token, expireAt, status: 1, passwordHash },
    })
    return this.toCreateResult(created)
  }

  /**
   * 我的分享列表（不分页，创建时间倒序；status 后端计算：1 有效 / 0 已停止 / 2 已过期）。
   * P4d 扩展：itemType（file|folder，源为文件夹时供管理页类型列）+ hasPassword（不返回密码本体）。
   */
  async list(userId: bigint, query?: ShareListQueryDto) {
    const shares = await this.prisma.cloudShare.findMany({
      where: { userId },
      orderBy: { createTime: 'desc' },
    })
    // 收集涉及的文件（禁 JOIN，应用层聚合）
    const fileIds = shares.map((s) => s.fileId)
    const files = await this.prisma.cloudFile.findMany({
      where: { id: { in: fileIds } },
      select: { id: true, name: true, size: true, isDir: true, deletedAt: true },
    })
    const fileMap = new Map(files.map((f) => [f.id.toString(), f]))
    const now = new Date()

    let result = shares.map((s) => {
      const file = fileMap.get(s.fileId.toString())
      // status：已停止 0；已过期 2；否则 1（文件被删由校验链兜底）
      let status = 1
      if (s.status === 0) status = 0
      else if (s.expireAt && s.expireAt.getTime() < now.getTime()) status = 2

      return {
        id: s.id,
        fileId: s.fileId,
        fileName: file?.name ?? '',
        itemType: file?.isDir === 1 ? 'folder' : 'file',
        hasPassword: s.passwordHash != null,
        size: file?.size ?? BigInt(0),
        fileDeleted: file?.deletedAt != null || file == null,
        token: s.token,
        visitCount: s.visitCount,
        expireAt: s.expireAt,
        status,
        createTime: s.createTime,
      }
    })

    // 状态筛选：缺省排除已停止（默认视图），指定则精确匹配
    if (query?.status === undefined || query.status === null) {
      result = result.filter((r) => r.status !== 0)
    } else {
      result = result.filter((r) => r.status === query.status)
    }
    // 文件名关键字（模糊）
    const keyword = query?.keyword?.trim()
    if (keyword) {
      result = result.filter((r) => r.fileName.includes(keyword))
    }
    return result
  }

  /** 停止分享：链接即刻失效 */
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

  /**
   * 修改 / 移除提取码（P4d D47）：password 为空表示移除（NULL = 无密码）。
   * 密码变更后旧凭证全部失效（scanDel share:pass:{token}:*），访客需重新输码。
   */
  async updatePassword(userId: bigint, id: bigint, dto: SharePasswordDto) {
    const share = await this.assertOwnedShare(userId, id)
    const passwordHash = dto.password ? await bcrypt.hash(dto.password, BCRYPT_ROUNDS) : null
    await this.prisma.cloudShare.update({ where: { id: share.id }, data: { passwordHash } })
    await this.redis.scanDel(`share:pass:${share.token}:*`)
    return { id: share.id.toString(), hasPassword: passwordHash !== null }
  }

  // ==================== 访客侧（@Public） ====================

  /**
   * 提取码校验（R42）：无密码分享直通签发 sid；有密码则比对 bcrypt 哈希，
   * 错误按 IP+token 计数（连续 5 次锁 10 分钟，30018 带剩余秒数），通过则签发短期凭证。
   */
  async verify(token: string, dto: ShareVerifyDto, ip: string) {
    const { share } = await this.assertShareUsable(token)
    const ttlMs = this.sidTtlMs(share)
    const sid = randomBytes(18).toString('base64url')

    if (share.passwordHash) {
      await this.assertPassNotLocked(ip, token)
      const ok = dto.password ? await bcrypt.compare(dto.password, share.passwordHash) : false
      if (!ok) {
        await this.recordPassFail(ip, token)
      }
      await this.redis.client.del(RedisKey.sharePassFail(ip, token))
    }
    await this.redis.client.set(RedisKey.sharePass(token, sid), '1', 'PX', ttlMs)
    return { sid, expiresIn: Math.floor(ttlMs / 1000), needPassword: share.passwordHash != null }
  }

  /**
   * 链接信息（需过密码门）：访问校验链任一失败统一 30008；
   * P4d 扩展：needPassword / itemType / mime / ext（供访客页分支渲染与密码门判断）。
   * path 可选（文件夹分享内子项寻址，供访客页「单文件预览」；缺省 = 分享项自身）。
   */
  async publicInfo(token: string, sid?: string | null, rawPath?: string) {
    const { share, file } = await this.assertAccess(token, sid)
    const target = await this.resolveSharedTarget(file, rawPath)
    return {
      token,
      fileName: target.name,
      itemType: target.isDir === 1 ? 'folder' : 'file',
      size: target.size.toString(),
      mime: target.mime ?? null,
      ext: target.ext ?? null,
      updatedAt: target.updateTime,
      expireAt: share.expireAt,
      isExpired: false,
      visitCount: share.visitCount,
      needPassword: share.passwordHash != null,
    }
  }

  /**
   * 访客文件流：inline（raw，MIME 口径 R44 同 R26）或 attachment（download，visit_count+1）。
   * path 可选（文件夹分享内子文件；缺省 = 分享项自身，必须为文件）。
   */
  async publicFileStream(
    token: string,
    sid: string | null,
    req: Request,
    res: Response,
    mode: 'raw' | 'download',
    rawPath?: string,
  ): Promise<void> {
    const { share, file } = await this.assertAccess(token, sid)
    const target = await this.resolveSharedTarget(file, rawPath, true)
    if (target.isDir === 1) {
      throw new BusinessException(ErrorCode.CloudShareInvalid, '分享链接无效')
    }
    if (!target.storageName) {
      throw new BusinessException(ErrorCode.InternalError, '文件存储异常，请联系管理员')
    }
    // 下载成功 visit_count+1（R8；raw 预览不计次）
    if (mode === 'download') {
      await this.prisma.cloudShare.update({
        where: { id: share.id },
        data: { visitCount: { increment: 1 } },
      })
    }
    await this.serveShareFile(target, req, res, mode)
  }

  /**
   * 分享项寻址（文件夹分享内子项扩展）：
   * 无 path → 分享项自身；有 path → 源必须是文件夹，逐段下行（阻断段不可见）。
   * requireFile=true 时要求最终命中文件（raw/download 用）。
   */
  private async resolveSharedTarget(
    file: CloudFile,
    rawPath: string | undefined,
    requireFile = false,
  ): Promise<CloudFile> {
    if (rawPath === undefined || rawPath === '') {
      if (requireFile && file.isDir === 1) {
        throw new BusinessException(ErrorCode.CloudShareInvalid, '分享链接无效')
      }
      return file
    }
    if (file.isDir !== 1) {
      throw new BusinessException(ErrorCode.CloudShareInvalid, '分享链接无效')
    }
    const normalized = this.normalizePath(rawPath)
    if (normalized === null) {
      throw new BusinessException(ErrorCode.CloudShareInvalid, '分享链接无效')
    }
    const target = await this.descendSharedFolder(file, normalized)
    if (requireFile && target.isDir === 1) {
      throw new BusinessException(ErrorCode.CloudShareInvalid, '分享链接无效')
    }
    return target
  }

  /**
   * 文件夹分享单层列表（D48 动态子树）：分享后新增内容自动可见、删除即消失；
   * 子树内 is_public=2（显式阻断）项对外不可见（R43）。响应形态同 pub d/list。
   */
  async publicList(token: string, sid: string | null, rawPath: string | undefined) {
    const { file } = await this.assertAccess(token, sid)
    if (file.isDir !== 1) {
      throw new BusinessException(ErrorCode.CloudShareInvalid, '分享链接无效')
    }
    const normalized = this.normalizePath(rawPath ?? '')
    if (normalized === null) {
      throw new BusinessException(ErrorCode.CloudShareInvalid, '分享链接无效')
    }
    const folder = await this.descendSharedFolder(file, normalized)
    const children = await this.prisma.cloudFile.findMany({
      where: { userId: file.userId, parentId: folder.id, deletedAt: null },
      orderBy: [{ isDir: 'desc' }, { name: 'asc' }],
    })
    return {
      path: normalized,
      items: children
        // R43：显式阻断项对外不可见（不继承阻断，仅过滤该层）
        .filter((c) => c.isPublic !== 2)
        .map((c) => ({
          name: c.name,
          isDir: c.isDir === 1,
          size: Number(c.size),
          ext: c.ext ?? '',
          updatedAt: c.updateTime,
        })),
    }
  }

  /** 文件夹分享整包下载（D48）：复用 yazl 流式链路；访客视角 publicOnly=true 过滤阻断项 */
  async publicPack(token: string, sid: string | null, res: Response): Promise<void> {
    const { file } = await this.assertAccess(token, sid)
    if (file.isDir !== 1) {
      throw new BusinessException(ErrorCode.CloudShareInvalid, '分享链接无效')
    }
    const { entries, skipped } = await this.packService.collect(file.userId, [file.id], { publicOnly: true })
    if (entries.length === 0) {
      throw new BusinessException(ErrorCode.CloudShareInvalid, '该文件夹暂无可下载内容')
    }
    await this.packService.stream(entries, res, {
      filename: `${this.sanitizeFileName(file.name)}.zip`,
      skipped,
    })
  }

  // ==================== 私有方法 ====================

  /** 校验链（§4.7 分享端点安全）：token → status=1 → 未过期 → 源存在未删 →（开关开启）audit_status=1；任一失败 30008 */
  private async assertShareUsable(token: string): Promise<{ share: CloudShare; file: CloudFile }> {
    const invalid = () => new BusinessException(ErrorCode.CloudShareInvalid, '分享链接无效')
    const share = await this.prisma.cloudShare.findUnique({ where: { token } })
    if (!share || share.status !== 1) throw invalid()
    if (share.expireAt && share.expireAt.getTime() < Date.now()) throw invalid()

    const file = await this.prisma.cloudFile.findFirst({
      where: { id: share.fileId, deletedAt: null },
    })
    if (!file) throw invalid()
    if (this.config.get<boolean>('upload.cloudAuditEnabled', false) && file.auditStatus !== 1) {
      throw invalid()
    }
    return { share, file }
  }

  /** 密码门（R42/D47）：有密码且未持有效凭证 → 30017（前端跳密码门禁页） */
  private async assertAccess(token: string, sid?: string | null): Promise<{ share: CloudShare; file: CloudFile }> {
    const { share, file } = await this.assertShareUsable(token)
    if (share.passwordHash) {
      if (!sid) {
        throw new BusinessException(ErrorCode.CloudShareNeedPassword, '该分享需要提取码')
      }
      const valid = await this.redis.client.get(RedisKey.sharePass(token, sid))
      if (!valid) {
        throw new BusinessException(ErrorCode.CloudShareNeedPassword, '提取码验证已过期，请重新输入')
      }
    }
    return { share, file }
  }

  /** 短期凭证 TTL：min(2h, 分享剩余有效期)（R42） */
  private sidTtlMs(share: CloudShare): number {
    if (!share.expireAt) return SID_MAX_TTL_MS
    const remain = share.expireAt.getTime() - Date.now()
    return Math.max(60_000, Math.min(SID_MAX_TTL_MS, remain))
  }

  /** 提码错误锁定检查（连续 5 次锁 10 分钟） */
  private async assertPassNotLocked(ip: string, token: string): Promise<void> {
    const count = Number((await this.redis.client.get(RedisKey.sharePassFail(ip, token))) ?? 0)
    if (count < PASS_FAIL_MAX) return
    const ttl = await this.redis.client.ttl(RedisKey.sharePassFail(ip, token))
    if (ttl > 0) {
      throw new BusinessException(
        ErrorCode.CloudSharePasswordWrong,
        `提取码错误次数过多，请 ${ttl} 秒后再试`,
      )
    }
    await this.redis.client.del(RedisKey.sharePassFail(ip, token))
  }

  /** 记录一次提取码错误（10 分钟窗口；达上限后剩余次数提示，超限提示锁定剩余秒数） */
  private async recordPassFail(ip: string, token: string): Promise<void> {
    const key = RedisKey.sharePassFail(ip, token)
    const count = await this.redis.client.incr(key)
    await this.redis.client.expire(key, PASS_FAIL_LOCK_SEC)
    if (count >= PASS_FAIL_MAX) {
      throw new BusinessException(
        ErrorCode.CloudSharePasswordWrong,
        `提取码错误次数过多，请 ${PASS_FAIL_LOCK_SEC} 秒后再试`,
      )
    }
    throw new BusinessException(
      ErrorCode.CloudSharePasswordWrong,
      `提取码错误，还可尝试 ${PASS_FAIL_MAX - count} 次`,
    )
  }

  /** 文件夹分享子树 path 逐段下行（有界 ≤10；缺 path = 分享根自身；任一段不存在或阻断 → 30008） */
  private async descendSharedFolder(root: CloudFile, normalizedPath: string): Promise<CloudFile> {
    const invalid = () => new BusinessException(ErrorCode.CloudShareInvalid, '分享链接无效')
    let current = root
    const segments = normalizedPath.length > 0 ? normalizedPath.split('/') : []
    for (const seg of segments) {
      const next = await this.prisma.cloudFile.findFirst({
        where: { userId: root.userId, parentId: current.id, name: seg, deletedAt: null },
      })
      if (!next || next.isPublic === 2) throw invalid()
      current = next
    }
    return current
  }

  /** 路径规范化（拒反斜杠/../超深；'' = 根）；非法返回 null */
  private normalizePath(rawPath: string): string | null {
    let decoded: string
    try {
      decoded = decodeURIComponent(rawPath)
    } catch {
      return null
    }
    if (decoded.includes('\\')) return null
    const segments: string[] = []
    for (const seg of decoded.split('/')) {
      if (seg === '' || seg === '.') continue
      if (seg === '..') return null
      segments.push(seg)
    }
    if (segments.length > MAX_DEPTH) return null
    return segments.join('/')
  }

  /** 访客文件流（raw inline / download attachment）：ETag/304 + Range 206/416 + no-cache（照 pub 口径） */
  private async serveShareFile(file: CloudFile, req: Request, res: Response, mode: 'raw' | 'download'): Promise<void> {
    const info = await this.storage.stat(file.storageName!)
    if (!info) {
      throw new BusinessException(ErrorCode.InternalError, '文件存储异常，请联系管理员')
    }
    const size = info.size
    const resolved = resolvePubMime(file.ext)
    const disposition = mode === 'download' || !resolved.inline ? 'attachment' : 'inline'
    const contentType = mode === 'download' ? 'application/octet-stream' : resolved.contentType

    const etag = `W/"${size}-${file.updateTime.getTime()}"`
    if (req.headers['if-none-match'] === etag) {
      res.status(304).set('ETag', etag).end()
      return
    }
    const parsed = req.headers.range ? this.parseRange(req.headers.range, size) : null
    if (parsed === 'unsatisfiable') {
      res.status(416).set('Content-Range', `bytes */${size}`).end()
      return
    }
    res.set({
      ETag: etag,
      'Last-Modified': file.updateTime.toUTCString(),
      'Cache-Control': 'no-cache',
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `${disposition}; filename="${this.asciiFallback(file.name)}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      'Accept-Ranges': 'bytes',
    })
    res.setTimeout(30_000, () => {
      res.destroy()
    })
    if (parsed) {
      res.status(206).set({
        'Content-Range': `bytes ${parsed.start}-${parsed.end}/${size}`,
        'Content-Length': String(parsed.end - parsed.start + 1),
      })
      this.storage.createReadStream(file.storageName!, { start: parsed.start, end: parsed.end }).pipe(res)
      return
    }
    res.status(200).set('Content-Length', String(size))
    this.storage.createReadStream(file.storageName!).pipe(res)
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

  private toCreateResult(share: {
    id: bigint
    token: string
    expireAt: Date | null
    passwordHash?: string | null
  }) {
    return {
      id: share.id.toString(),
      token: share.token,
      url: `/share/${share.token}`,
      expireAt: share.expireAt,
      hasPassword: share.passwordHash != null,
    }
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

  /** zip 文件名清洗（去路径分隔与控制字符，防响应头注入） */
  private sanitizeFileName(name: string): string {
    // eslint-disable-next-line no-control-regex -- 剔除控制字符正是本函数目的（防响应头/文件名注入）
    const cleaned = name.replace(/[\u0000-\u001f\u007f"\\/]/g, '_').trim()
    return cleaned || 'folder'
  }
}
