import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as iconv from 'iconv-lite'
import * as yauzl from 'yauzl'
import type { WriteStream } from 'node:fs'
import type { Readable } from 'node:stream'
import type { Entry, ZipFile } from 'yauzl'
import { ErrorCode } from '../../../common/constants/error-code'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import { StorageService } from '../../../infra/storage/storage.service'
import { RAW_MIME_MAP } from '../facade/cloud-facade.service'
import { FileService, MAX_CHILDREN } from '../file/file.service'

/** UTF-8 文件名标记（zip 通用目的位 bit 11）；无标记按 GBK 解码（R29/GBK 兼容中文压缩包） */
const UTF8_FLAG = 0x800

/** 解压计划中的目录节点（相对目标文件夹的 '/' 连接路径） */
interface PlanDir {
  path: string
  name: string
  parentPath: string
}
/** 解压计划中的文件节点（先落 tmp，全部成功后转正 + 事务落库） */
interface PlanFile {
  dirPath: string
  name: string
  size: number
  ext: string
  tmpPath: string
}

/**
 * 在线解压（P4c T49，架构增补 §16.5；D36 同步接口 + tmp 中转事务）：
 * 仅 .zip（≤ CLOUD_MAX_FILE_SIZE）；安全四件套（R29）：
 *   1. Zip Slip 拦截：条目名含 .. / 绝对路径 / 反斜杠开头 / 盘符 → 30016 整包拒绝
 *   2. 双上限：条目数 ≤ CLOUD_UNZIP_MAX_ENTRIES；累计总大小 ≤ CLOUD_UNZIP_MAX_TOTAL_SIZE
 *      且 ≤ 配额余量（30003）；单条目 ≤ CLOUD_MAX_FILE_SIZE——边解边累计，超限即中断（30015）
 *   3. GBK 文件名解码：条目名无 UTF-8 flag 时按 GBK 解码（iconv-lite）
 *   4. 嵌套 zip 不递归：解出的 zip 就是普通文件
 * 事务语义（D36/R30）：zip 源复制到 tmp → 条目流式落 tmp（禁入内存）→ 全部成功后批量 moveToStorage
 * 转正 + 单事务落库（目标文件夹行 + 目录行 + 文件行 + used 记账 R3）→ 任何失败清理全部半成品，零残留。
 */
@Injectable()
export class UnzipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly storage: StorageService,
    private readonly fileService: FileService,
  ) {}

  async unzip(userId: bigint, id: bigint): Promise<{ folderId: string; folderName: string; fileCount: number; totalSize: number }> {
    // 1. 目标校验：zip 文件（30001 / 30014）
    const file = await this.findOwnedFile(userId, id)
    const ext = (file.ext ?? '').toLowerCase()
    if (ext !== 'zip' || file.size > BigInt(this.config.get<number>('upload.cloudMaxFileSize', 100 * 1024 * 1024))) {
      throw new BusinessException(ErrorCode.CloudUnzipNotSupported, '仅支持 .zip 压缩包在线解压')
    }
    // 父目录归属与类型（30001）
    if (file.parentId !== BigInt(0)) {
      await this.fileService.assertOwned(file.parentId, userId, true)
    }
    const { quota, used } = await this.fileService.getQuota(userId)

    // 2. 解压目标：同目录 / 包名文件夹（R31），同名自动 "(1)"（R4）；深度/数量上限（R6）
    const baseName = this.zipBaseName(file.name)
    const folderName = await this.fileService.resolveNameConflict(userId, file.parentId, baseName)
    // 目标文件夹深度 = 父深度 + 1（>10 拒绝，30006）
    const parentDepth = file.parentId === BigInt(0) ? 0 : await this.fileService.computeDepth(file.parentId, userId)
    if (parentDepth + 1 > 10) {
      throw new BusinessException(ErrorCode.CloudDirLimitExceeded, '目录深度不能超过 10 层')
    }

    // 3. zip 源复制到 tmp（隔离并发覆盖/移动风险），yauzl 流式解压
    const maxEntries = this.config.get<number>('upload.cloudUnzipMaxEntries', 5000)
    const maxTotalSize = this.config.get<number>('upload.cloudUnzipMaxTotalSize', 500 * 1024 * 1024)
    const maxFileSize = this.config.get<number>('upload.cloudMaxFileSize', 100 * 1024 * 1024)

    const zipTmpPath = await this.storage.copyToTmp(file.storageName as string)
    const plan: { dirs: PlanDir[]; files: PlanFile[]; tmpPaths: string[] } = { dirs: [], files: [], tmpPaths: [] }
    try {
      const zip = await this.openZip(zipTmpPath)
      try {
        if (zip.entryCount > maxEntries) {
          throw new BusinessException(ErrorCode.CloudUnzipLimitExceeded, `压缩包含 ${zip.entryCount} 个条目，超出上限 ${maxEntries}`)
        }
        // 目录登记表：relPath → node（mkdir -p 语义，文件路径中的隐式目录一并登记）
        const dirMap = new Map<string, PlanDir>()
        const dirChildren = new Map<string, number>()
        let totalSize = 0

        // 顺序逐条处理（磁盘瓶颈，无需并发；边解边累计，超限即中断）
        for (;;) {
          const entry = await this.nextEntry(zip)
          if (!entry) break
          const name = this.decodeEntryName(entry)
          const isDir = name.endsWith('/')
          // ---- Zip Slip 拦截（R29-1，整包拒绝 30016）----
          const segments = this.toSafeSegments(name)
          const depth = parentDepth + 1 + segments.length
          if (depth > 10) {
            throw new BusinessException(ErrorCode.CloudDirLimitExceeded, '解压后目录深度不能超过 10 层')
          }
          const parentKey = segments.slice(0, -1).join('/')
          const childCount = (dirChildren.get(parentKey) ?? 0) + 1
          if (childCount > MAX_CHILDREN) {
            throw new BusinessException(ErrorCode.CloudDirLimitExceeded, '单个目录下子项不能超过 500 个')
          }
          dirChildren.set(parentKey, childCount)
          // 隐式目录登记（除末段外的每一段）
          for (let i = 0; i < segments.length - (isDir ? 0 : 1); i++) {
            const p = segments.slice(0, i + 1).join('/')
            if (!dirMap.has(p)) {
              dirMap.set(p, { path: p, name: segments[i], parentPath: i === 0 ? '' : segments.slice(0, i).join('/') })
            }
          }
          if (isDir) continue

          // ---- 文件条目：大小上限预检（R29-2）----
          const size = entry.uncompressedSize
          if (size > maxFileSize) {
            throw new BusinessException(ErrorCode.CloudUnzipLimitExceeded, `条目「${segments[segments.length - 1]}」超出单文件大小上限`)
          }
          totalSize += size
          if (totalSize > maxTotalSize) {
            throw new BusinessException(ErrorCode.CloudUnzipLimitExceeded, `解压累计总大小超出上限（${Math.floor(maxTotalSize / 1024 / 1024)}MB）`)
          }
          if (used + BigInt(totalSize) > quota) {
            throw new BusinessException(ErrorCode.CloudQuotaExceeded, '存储配额不足')
          }
          // 流式落 tmp（禁入内存）；读流错误视为包损坏（30014），写流错误为内部错误
          const entryExt = this.extOf(segments[segments.length - 1])
          const { path: tmpPath, stream: ws } = await this.storage.createTmpWriteStream(entryExt)
          plan.tmpPaths.push(tmpPath)
          const rs = await this.openReadStream(zip, entry)
          await this.pipeToFile(rs, ws)
          plan.files.push({ dirPath: parentKey, name: segments[segments.length - 1], size, ext: entryExt, tmpPath })
        }

        // 4. 全部解压成功：批量转正（tmp → 正式区）+ 事务落库（R30 失败零残留）
        return await this.commit(userId, file.parentId, folderName, dirMap, plan, totalSize)
      } finally {
        zip.close()
      }
    } finally {
      // 5. tmp 清理（已 moveToStorage 的条目 tmp 已被 rename，removeTmp 静默）
      await this.storage.removeTmp(zipTmpPath)
      for (const p of plan.tmpPaths) {
        await this.storage.removeTmp(p)
      }
    }
  }

  /** 转正 + 事务落库（任何一步失败：删已转正物理文件回滚，DB 零写入） */
  private async commit(
    userId: bigint,
    parentId: bigint,
    folderName: string,
    dirMap: Map<string, PlanDir>,
    plan: { dirs: PlanDir[]; files: PlanFile[]; tmpPaths: string[] },
    totalSize: number,
  ): Promise<{ folderId: string; folderName: string; fileCount: number; totalSize: number }> {
    const defaultQuota = BigInt(this.config.get<number>('upload.cloudDefaultQuota', 1024 * 1024 * 1024))
    const moved: string[] = []
    try {
      // 先转正物理文件（失败仅 tmp/物理清理，无 DB 写入）；成功后事务落库
      for (const f of plan.files) {
        const storageName = await this.storage.moveToStorage(f.tmpPath, f.ext)
        moved.push(storageName)
        // tmp 已被 rename（后续 finally 清理静默）；storageName 挂到计划项供事务使用
        ;(f as PlanFile & { storageName?: string }).storageName = storageName
      }

      // 事务落库：目录行需要先拿到父 id，用「事务回调 + create 逐行 await」精确控序
      // （目录按深度排序，父先于子；行数受条目数上限 5000 约束，可接受）
      const result = await this.prisma.$transaction(async (tx) => {
        const folder = await tx.cloudFile.create({
          data: { userId, parentId, name: folderName, isDir: 1, size: BigInt(0) },
        })
        const ids = new Map<string, bigint>()
        for (const d of [...dirMap.values()].sort((a, b) => a.path.split('/').length - b.path.split('/').length)) {
          const row = await tx.cloudFile.create({
            data: {
              userId,
              parentId: d.parentPath === '' ? folder.id : ids.get(d.parentPath) as bigint,
              name: d.name,
              isDir: 1,
              size: BigInt(0),
            },
          })
          ids.set(d.path, row.id)
        }
        for (const f of plan.files) {
          await tx.cloudFile.create({
            data: {
              userId,
              parentId: f.dirPath === '' ? folder.id : ids.get(f.dirPath) as bigint,
              name: f.name,
              isDir: 0,
              size: BigInt(f.size),
              ext: f.ext || null,
              mime: RAW_MIME_MAP[f.ext] ?? 'application/octet-stream',
              storageName: (f as PlanFile & { storageName?: string }).storageName ?? 'PENDING',
              auditStatus: 0,
            },
          })
        }
        await tx.cloudUsage.upsert({
          where: { userId },
          update: { used: { increment: BigInt(totalSize) } },
          create: { userId, quota: defaultQuota, used: BigInt(totalSize) },
        })
        return folder
      })

      return {
        folderId: result.id.toString(),
        folderName,
        fileCount: plan.files.length,
        totalSize,
      }
    } catch (error) {
      // 落库/转正失败：回滚已转正物理文件（R30 零残留），DB 由事务回滚保证
      for (const name of moved) {
        await this.storage.remove(name).catch(() => undefined)
      }
      throw error
    }
  }

  // ==================== zip 解析与安全校验 ====================

  /** 打开 zip（deferred promise；error 事件在后续处理中以 30014 呈现） */
  private openZip(path: string): Promise<ZipFile> {
    return new Promise((resolve, reject) => {
      yauzl.open(path, { lazyEntries: true, autoClose: false, decodeStrings: false }, (err, zip) => {
        if (err || !zip) {
          reject(new BusinessException(ErrorCode.CloudUnzipNotSupported, '压缩包格式不支持或已损坏'))
        } else {
          resolve(zip)
        }
      })
    })
  }

  /** 拉取下一_entry（'entry' → Entry / 'end' → null）；zip error 事件转 30014 */
  private nextEntry(zip: ZipFile): Promise<Entry | null> {
    return new Promise((resolve, reject) => {
      const onEntry = (entry: Entry) => {
        cleanup()
        resolve(entry)
      }
      const onEnd = () => {
        cleanup()
        resolve(null)
      }
      const onError = (err: Error) => {
        cleanup()
        reject(new BusinessException(ErrorCode.CloudUnzipNotSupported, `压缩包已损坏（${err.message}）`))
      }
      const cleanup = () => {
        zip.removeListener('entry', onEntry)
        zip.removeListener('end', onEnd)
        zip.removeListener('error', onError)
      }
      zip.on('entry', onEntry).on('end', onEnd).on('error', onError)
      zip.readEntry()
    })
  }

  /** 打开条目读流（cb → promise；失败视为包损坏） */
  private openReadStream(zip: ZipFile, entry: Entry): Promise<Readable> {
    return new Promise((resolve, reject) => {
      zip.openReadStream(entry, (err, stream) => {
        if (err || !stream) {
          reject(new BusinessException(ErrorCode.CloudUnzipNotSupported, `条目读取失败（${err?.message ?? '未知错误'}）`))
        } else {
          resolve(stream)
        }
      })
    })
  }

  /** 读流管道写入 tmp 文件（读流错误 → 30014 包损坏；写流错误 → 50000） */
  private pipeToFile(rs: Readable, ws: WriteStream): Promise<void> {
    return new Promise((resolve, reject) => {
      rs.on('error', (err: Error) => {
        ws.destroy()
        reject(new BusinessException(ErrorCode.CloudUnzipNotSupported, `解压中断（${err.message}）`))
      })
      ws.on('error', (err: Error) => {
        rs.destroy()
        reject(new BusinessException(ErrorCode.InternalError, `临时文件写入失败（${err.message}）`))
      })
      ws.on('finish', () => resolve())
      rs.pipe(ws)
    })
  }

  /**
   * 条目名解码（R29-3）：原始字节按 UTF-8 flag（bit 11）→ UTF-8，否则 GBK（iconv-lite）；
   * decodeStrings=false 时 fileName 为原始 Buffer。
   */
  private decodeEntryName(entry: Entry): string {
    const raw = Buffer.isBuffer(entry.fileName) ? entry.fileName : Buffer.from(entry.fileName as string, 'latin1')
    const decoded = (entry.generalPurposeBitFlag & UTF8_FLAG) !== 0 ? raw.toString('utf8') : iconv.decode(raw, 'gbk')
    // zip 目录条目约定以 / 结尾；Windows 压缩包的 \ 分隔符统一归一为 /（反斜杠开头已在 toSafeSegments 拒绝）
    return decoded.replace(/\\/g, '/')
  }

  /**
   * 条目名安全切分（Zip Slip 拦截，整包拒绝 30016）：
   * 拒绝绝对路径（/ 或 \ 开头）、盘符（段含 ':'）、'..' 穿越、空段全部剔除、段长 >64（30006）。
   * @returns 规范化段数组（至少 1 段；目录条目末段保留）
   */
  private toSafeSegments(name: string): string[] {
    if (name.startsWith('/') || name.startsWith('\\')) {
      throw new BusinessException(ErrorCode.CloudUnzipIllegalEntry, `压缩包含非法路径条目（绝对路径）`)
    }
    const segments: string[] = []
    for (const seg of name.split('/')) {
      if (seg === '' || seg === '.') continue
      if (seg === '..') {
        throw new BusinessException(ErrorCode.CloudUnzipIllegalEntry, '压缩包含非法路径条目（父级穿越）')
      }
      if (seg.includes(':')) {
        throw new BusinessException(ErrorCode.CloudUnzipIllegalEntry, '压缩包含非法路径条目（盘符）')
      }
      if (seg.length > 64) {
        throw new BusinessException(ErrorCode.CloudDirLimitExceeded, '条目名称不能超过 64 字符')
      }
      segments.push(seg)
    }
    if (segments.length === 0) {
      throw new BusinessException(ErrorCode.CloudUnzipIllegalEntry, '压缩包含空路径条目')
    }
    return segments
  }

  /** 包名 → 目标文件夹名：去 .zip 后缀 + 剔除控制字符，限 64 字符（30006） */
  private zipBaseName(name: string): string {
    // eslint-disable-next-line no-control-regex -- 剔除控制字符正是本函数目的
    const base = name.replace(/\.zip$/i, '').replace(/[\u0000-\u001f\u007f]/g, '').trim() || 'unzip'
    if (base.length > 64) {
      throw new BusinessException(ErrorCode.CloudDirLimitExceeded, '文件夹名称不能超过 64 字符')
    }
    return base
  }

  /** 文件名小写扩展名（≤20 位字母数字；非法视为无扩展名，与上传口径一致） */
  private extOf(name: string): string {
    const dot = name.lastIndexOf('.')
    if (dot <= 0) return ''
    const ext = name.slice(dot + 1).toLowerCase()
    return /^[a-z0-9]{1,20}$/.test(ext) ? ext : ''
  }

  /** 校验目标为当前用户的未删除文件（30001） */
  private async findOwnedFile(userId: bigint, id: bigint) {
    const file = await this.prisma.cloudFile.findFirst({
      where: { id, userId, deletedAt: null },
    })
    if (!file || file.isDir !== 0 || !file.storageName) {
      throw new BusinessException(ErrorCode.CloudFileNotFound, '文件不存在或无权访问')
    }
    return file
  }
}
