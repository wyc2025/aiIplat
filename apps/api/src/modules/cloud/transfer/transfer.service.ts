import { Injectable } from '@nestjs/common'
import type { Response } from 'express'
import { ErrorCode } from '../../../common/constants/error-code'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import { StorageService } from '../../../infra/storage/storage.service'
import { FileService, MAX_CHILDREN } from '../file/file.service'
import { resolvePubMime } from '../public/pub-mime'

/** 预览白名单（R7）：图片 */
const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp'])
/** 预览白名单（R7）：纯文本 */
const TEXT_EXTS = new Set(['txt', 'md', 'json', 'js', 'ts', 'vue', 'css', 'xml', 'yml', 'log'])
/** 预览白名单（R7）：文档与音视频 */
const MEDIA_EXTS = new Set(['pdf', 'mp4', 'mp3'])
/** 文本预览大小上限（R7：≤2MB） */
const TEXT_PREVIEW_MAX_SIZE = 2 * 1024 * 1024

/** 上传 / 预览 / 下载（流式，见 ARCHITECTURE-P3 §13.3） */
@Injectable()
export class TransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly cloudFileService: FileService,
  ) {}

  /**
   * 上传：Multer 已流式落 tmp 区 → 业务校验（归属/数量/配额/同名）→ 移入正式区 → 落 cloud_file + used 记账（R3）。
   * overwrite=1 且同目录存在同名未删文件 → 物理替换（R5：更新行 + used 差额记账 + 删旧物理文件）；否则同名自动"(1)"。
   * 任一步失败即清理临时/正式区文件，不留孤儿。
   */
  async upload(userId: bigint, parentId: bigint, file?: Express.Multer.File, overwrite = 0) {
    if (!file?.path) {
      throw new BusinessException(ErrorCode.ParamInvalid, '缺少上传文件（multipart 字段名 file）')
    }
    try {
      const originalName = this.sanitizeName(file.originalname)
      if (!originalName) {
        throw new BusinessException(ErrorCode.ParamInvalid, '文件名无效')
      }
      if (originalName.length > 64) {
        throw new BusinessException(ErrorCode.CloudDirLimitExceeded, '文件名不能超过 64 字符')
      }

      // 归属与目录类型校验（30001；根目录无实体行，跳过）
      if (parentId !== BigInt(0)) {
        await this.cloudFileService.assertOwned(parentId, userId, true)
      }
      // 单目录直接子项上限（R6，30006；覆盖不新增子项，不计入）
      const count = await this.prisma.cloudFile.count({
        where: { userId, parentId, deletedAt: null },
      })

      // 覆盖目标探测（R5：仅同名未删文件；命中文件夹或 overwrite=0 时走自动"(1)" 新增路径）
      const overwriteTarget =
        overwrite === 1
          ? await this.prisma.cloudFile.findFirst({
              where: { userId, parentId, name: originalName, deletedAt: null, isDir: 0 },
            })
          : null

      if (overwriteTarget) {
        // 覆盖路径：tmp 清理由 overwriteExisting 自持（return 子 Promise 与 finally 的 await 会竞态，见下）
        return this.overwriteExisting(userId, parentId, overwriteTarget, file, originalName)
      }

      // 新增路径：数量上限校验（覆盖不新增，跳过后避免误判）
      if (count + 1 > MAX_CHILDREN) {
        throw new BusinessException(ErrorCode.CloudDirLimitExceeded, '单个目录下子项不能超过 500 个')
      }
      // 配额校验（R3/R7：软删项照常占配额，used 即当前总占用，30003）
      const { quota, used } = await this.cloudFileService.getQuota(userId)
      if (used + BigInt(file.size) > quota) {
        throw new BusinessException(
          ErrorCode.CloudQuotaExceeded,
          `存储配额不足（已用 ${this.formatSize(used)} / 配额 ${this.formatSize(quota)}）`,
        )
      }
      // 同名自动 "(1)"（R4：同名判定排除回收站项）
      const name = await this.cloudFileService.resolveNameConflict(userId, parentId, originalName)

      const ext = this.extractExt(originalName)
      const mime = this.sanitizeMime(file.mimetype)
      // tmp → 正式区（yyyyMM/uuid.ext）
      const storageName = await this.storage.moveToStorage(file.path, ext)

      // 落库 + used 记账（事务）；is_public 不写（默认 0=继承父目录，R2 三态语义：公开目录内新上传自动可访问）
      try {
        const [created] = await this.prisma.$transaction([
          this.prisma.cloudFile.create({
            data: {
              userId,
              parentId,
              name,
              isDir: 0,
              size: BigInt(file.size),
              mime,
              ext: ext || null,
              storageName,
              auditStatus: 0,
            },
          }),
          this.prisma.cloudUsage.update({
            where: { userId },
            data: { used: { increment: BigInt(file.size) } },
          }),
        ])
        // TODO(P3后续): 触发内容审核事件 cloud.file.uploaded（见 ARCHITECTURE-P3 §13.7，审核引擎下期接入）
        return { id: created.id.toString(), name, size: file.size, overwritten: false }
      } catch (error) {
        await this.storage.remove(storageName)
        throw error
      }
    } finally {
      // 兜底清理 tmp：仅新增路径（覆盖路径由 overwriteExisting 自持 finally，避免 return 子 Promise 与
      // 此处 await 竞态导致 tmp 在 moveToStorage 前被误删）。moveToStorage 成功后 tmp 已不存在，删除静默。
      if (overwrite !== 1) {
        await this.storage.removeTmp(file.path)
      }
    }
  }

  /**
   * 覆盖上传（R5）：tmp→正式区 → 更新行 + used 差额 + 删旧物理 → 复用 FileService.replaceFileContent
   * 公共实现（P4b §15.5：与在线编辑保存同源，mime/ext 随覆盖上传更新）。URL（file id）不变，
   * 旧公开 URL 内容即时指向新文件。
   */
  private async overwriteExisting(
    userId: bigint,
    parentId: bigint,
    target: { id: bigint; size: bigint; storageName: string | null },
    file: Express.Multer.File,
    originalName: string,
  ) {
    try {
      const ext = this.extractExt(originalName)
      const mime = this.sanitizeMime(file.mimetype)
      const newStorageName = await this.storage.moveToStorage(file.path, ext)

      // 配额差额校验（30003）+ 事务更新行 + used 记账（GREATEST 兜底）+ 删旧物理，均在公共方法内
      await this.cloudFileService.replaceFileContent(userId, target, newStorageName, BigInt(file.size), {
        mime,
        ext: ext || null,
      })
      return { id: target.id.toString(), name: originalName, size: file.size, overwritten: true }
    } finally {
      // 覆盖路径自持 tmp 清理（upload 的 finally 已跳过覆盖分支，避免竞态）
      await this.storage.removeTmp(file.path)
    }
  }

  /** 预览：白名单类型 inline 输出，文本类强制 text/plain（R7 防 XSS），支持 Range */
  async preview(userId: bigint, id: bigint, range: string | null, res: Response) {
    const file = await this.findOwnedFile(userId, id)
    const ext = file.ext ?? ''
    const isText = TEXT_EXTS.has(ext)
    const previewable = isText || IMAGE_EXTS.has(ext) || MEDIA_EXTS.has(ext)
    if (!previewable) {
      throw new BusinessException(ErrorCode.CloudPreviewNotSupported, '该类型不支持预览，请下载查看')
    }
    if (isText && file.size > BigInt(TEXT_PREVIEW_MAX_SIZE)) {
      throw new BusinessException(ErrorCode.CloudPreviewNotSupported, '文本文件超过 2MB，不支持预览')
    }
    // R7：文本一律 text/plain; charset=utf-8（html/svg 不在白名单，即使伪装 mimetype 也无法内联执行脚本）
    // 非文本：优先用库里记录的 mime；历史上传若落了空值/octet-stream（浏览器未给 Content-Type），
    // 则按扩展名推导真实 MIME（mp4 → video/mp4）；否则 <video>/<img> 会因类型不符拒绝解码（表现为一直转圈）
    const contentType = isText
      ? 'text/plain; charset=utf-8'
      : this.resolvePreviewContentType(file.mime, ext)
    await this.streamToResponse(file, res, range, {
      disposition: 'inline',
      contentType,
    })
  }

  /** 下载：attachment + 原文件名（RFC 5987 编码，中文安全），支持 Range */
  async download(userId: bigint, id: bigint, range: string | null, res: Response) {
    const file = await this.findOwnedFile(userId, id)
    await this.streamToResponse(file, res, range, {
      disposition: 'attachment',
      contentType: 'application/octet-stream',
    })
  }

  /** 统一流式响应：Range 解析（206/416）+ 管道输出（详见 ARCHITECTURE-P3 §13.3） */
  private async streamToResponse(
    file: { name: string; storageName: string | null },
    res: Response,
    range: string | null,
    opts: { disposition: 'inline' | 'attachment'; contentType: string },
  ) {
    if (!file.storageName) {
      throw new BusinessException(ErrorCode.CloudFileNotFound, '文件不存在或无权访问')
    }
    const info = await this.storage.stat(file.storageName)
    if (!info) {
      // DB 有记录但物理文件丢失：数据不一致，按内部错误上报
      throw new BusinessException(ErrorCode.InternalError, '文件存储异常，请联系管理员')
    }
    const size = info.size

    // Content-Disposition：filename* 编码原名 + ASCII 兜底（防 quoted-string 注入）
    const disposition = `${opts.disposition}; filename="${this.asciiFallback(file.name)}"; filename*=UTF-8''${encodeURIComponent(file.name)}`

    const parsed = range ? this.parseRange(range, size) : null
    if (parsed === 'unsatisfiable') {
      // 416：区间不可满足，告知资源总大小
      res.status(416).set('Content-Range', `bytes */${size}`).end()
      return
    }
    if (parsed) {
      // 206 Partial Content：视频拖动进度条依赖
      const length = parsed.end - parsed.start + 1
      res.status(206).set({
        'Accept-Ranges': 'bytes',
        'Content-Type': opts.contentType,
        'Content-Disposition': disposition,
        'Content-Range': `bytes ${parsed.start}-${parsed.end}/${size}`,
        'Content-Length': String(length),
      })
      this.pipeStorage(file.storageName, { start: parsed.start, end: parsed.end }, res)
      return
    }
    // 200 全量（无 Range / Range 语法非法时按 RFC 7233 忽略）
    res.status(200).set({
      'Accept-Ranges': 'bytes',
      'Content-Type': opts.contentType,
      'Content-Disposition': disposition,
      'Content-Length': String(size),
    })
    this.pipeStorage(file.storageName, null, res)
  }

  /**
   * 管道输出 + 错误兜底：读流出错（物理文件缺失、磁盘异常）时主动销毁响应。
   * 不加这段的话连接会一直挂着，前端表现为预览弹框「无限转圈」。
   */
  private pipeStorage(storageName: string, range: { start: number; end: number } | null, res: Response) {
    const stream = range
      ? this.storage.createReadStream(storageName, { start: range.start, end: range.end })
      : this.storage.createReadStream(storageName)
    stream.on('error', () => res.destroy())
    stream.pipe(res)
  }

  /**
   * 非文本预览的 Content-Type（R7 兜底）：库里 mime 可用即用；为空或为 octet-stream 时按扩展名
   * 推导真实类型（mp4 → video/mp4、png → image/png），推导不出才回退 octet-stream。
   * 历史数据 mime 落空会让 <video>/<img> 拒绝解码（前端只能转圈），这里兜住。
   */
  private resolvePreviewContentType(mime: string | null, ext: string): string {
    if (mime && mime !== 'application/octet-stream') return mime
    const resolved = resolvePubMime(ext)
    return resolved.inline ? resolved.contentType : (mime ?? 'application/octet-stream')
  }

  /**
   * 解析单区间 Range 头（bytes=start-end / bytes=start- / bytes=-suffix）。
   * 解析失败返回 null（忽略 Range，回退 200 全量）；区间不可满足返回 'unsatisfiable'（416）。
   */
  private parseRange(header: string, size: number): { start: number; end: number } | 'unsatisfiable' | null {
    if (size === 0) return 'unsatisfiable'
    const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
    if (!match) return null
    const [, startRaw, endRaw] = match
    // 后缀形式 bytes=-N：最后 N 字节
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

  /** 校验目标为当前用户的未删除文件（文件夹按"不存在"处理，R1 数据隔离） */
  private async findOwnedFile(userId: bigint, id: bigint) {
    const file = await this.prisma.cloudFile.findFirst({
      where: { id, userId, deletedAt: null },
    })
    if (!file || file.isDir !== 0) {
      throw new BusinessException(ErrorCode.CloudFileNotFound, '文件不存在或无权访问')
    }
    return file
  }

  /** 清洗客户端原始文件名：截取 basename（防携带路径）并剔除控制字符 */
  private sanitizeName(original: string): string {
    const base = original.split(/[\\/]/).pop() ?? ''
    // eslint-disable-next-line no-control-regex -- 剔除控制字符正是本函数目的（防响应头/文件名注入）
    return base.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  }

  /** 提取小写扩展名（不带点；仅保留字母数字且 ≤20 字符，否则视为无扩展名） */
  private extractExt(name: string): string {
    const dot = name.lastIndexOf('.')
    if (dot <= 0) return ''
    const ext = name.slice(dot + 1).toLowerCase()
    return /^[a-z0-9]{1,20}$/.test(ext) ? ext : ''
  }

  /** mime 清洗（仅常规字符，防响应头注入；≤100 字符，非法置 null） */
  private sanitizeMime(mime: string | undefined): string | null {
    if (!mime) return null
    const value = mime.trim().toLowerCase()
    return /^[a-z0-9/+.-]{1,100}$/.test(value) ? value : null
  }

  /** filename 的 ASCII 兜底（quoted-string 内的引号/反斜杠一律替换） */
  private asciiFallback(name: string): string {
    const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
    return ascii || 'file'
  }

  /** 字节数人类可读化（错误提示用） */
  private formatSize(bytes: bigint): string {
    const n = Number(bytes)
    if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)}GB`
    if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(2)}MB`
    if (n >= 1024) return `${(n / 1024).toFixed(2)}KB`
    return `${n}B`
  }
}
