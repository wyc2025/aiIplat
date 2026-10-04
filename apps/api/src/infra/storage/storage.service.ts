import { createReadStream, createWriteStream } from 'node:fs'
import { copyFile, mkdir, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import type { WriteStream } from 'node:fs'
import type { Readable } from 'node:stream'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

/**
 * 文件存储抽象（本地磁盘起步，预留 MinIO/OSS 切换，见 ARCHITECTURE §3「文件」）。
 * 目录布局：UPLOAD_DIR/tmp（上传临时区）+ UPLOAD_DIR/yyyyMM（正式区）。
 * 业务代码只允许经本服务读写物理文件，禁止直接操作 fs（铁律）。
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name)

  /** 存储根目录（UPLOAD_DIR 绝对路径） */
  private readonly baseDir: string

  constructor(config: ConfigService) {
    this.baseDir = resolve(config.get<string>('upload.dir', './uploads'))
  }

  /** 启动时确保目录就绪（tmp 区 + 根目录） */
  async onModuleInit(): Promise<void> {
    await mkdir(this.tmpDir, { recursive: true })
  }

  /** 临时区目录（UPLOAD_DIR/tmp） */
  get tmpDir(): string {
    return join(this.baseDir, 'tmp')
  }

  /** 临时区目录静态访问（供 multer 引擎在装饰器静态求值期使用，无需实例化） */
  static tmpDirPath(): string {
    const base = resolve(process.env.UPLOAD_DIR ?? './uploads')
    return join(base, 'tmp')
  }

  /**
   * 将临时区文件移动到正式区（yyyyMM/uuid.ext），成功后原 tmp 文件不复存在。
   * @param tmpPath 临时文件绝对路径（必须位于 tmp 区内）
   * @param ext 目标扩展名（小写不带点；仅允许字母数字，非法一律视为无扩展名）
   * @returns 正式区相对路径 storage_name（yyyyMM/uuid.ext）
   */
  async moveToStorage(tmpPath: string, ext: string): Promise<string> {
    this.assertInsideTmp(tmpPath)
    const safeExt = /^[a-z0-9]{1,20}$/.test(ext) ? ext : ''
    const now = new Date()
    const monthDir = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
    const storageName = `${monthDir}/${randomUUID()}${safeExt ? `.${safeExt}` : ''}`
    const target = this.resolveStorage(storageName)
    await mkdir(dirname(target), { recursive: true })
    await rename(tmpPath, target)
    return storageName
  }

  /**
   * 将内存内容直接写入正式区（yyyyMM/uuid.ext）；供模板复制等应用内生成文件场景（P4a T36）。
   * @param content 文件内容
   * @param ext 目标扩展名（小写不带点；仅允许字母数字，非法一律视为无扩展名）
   * @returns 正式区相对路径 storage_name（yyyyMM/uuid.ext）
   */
  async writeFromBuffer(content: Buffer, ext: string): Promise<string> {
    const safeExt = /^[a-z0-9]{1,20}$/.test(ext) ? ext : ''
    const now = new Date()
    const monthDir = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
    const storageName = `${monthDir}/${randomUUID()}${safeExt ? `.${safeExt}` : ''}`
    const target = this.resolveStorage(storageName)
    // 与 moveToStorage 同口径：正式区按月子目录可能尚未存在（全新环境首写），必须先递归创建，
    // 否则 writeFile 直接 ENOENT（本地因历史上传已建过月份目录而被掩盖，干净环境必现）
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content)
    return storageName
  }

  /** 删除正式区文件；文件不存在返回 false（静默，供孤儿对账/幂等清理场景） */
  async remove(storageName: string): Promise<boolean> {
    try {
      await unlink(this.resolveStorage(storageName))
      return true
    } catch (error) {
      if (this.isNotFound(error)) return false
      throw error
    }
  }

  /**
   * 读取临时区文件到内存（P11 T103 CSV 导入：≤5MB，有界读取后即刻 removeTmp）。
   * 业务代码禁止直接操作 fs，故临时区读取也走本服务。
   */
  async readTmp(tmpPath: string): Promise<Buffer> {
    this.assertInsideTmp(tmpPath)
    return readFile(tmpPath)
  }

  /** 删除临时区文件（不存在静默；上传校验失败后的回滚清理） */
  async removeTmp(tmpPath: string): Promise<void> {
    try {
      this.assertInsideTmp(tmpPath)
      await unlink(tmpPath)
    } catch (error) {
      if (this.isNotFound(error)) return
      // 清理失败只记日志，不阻断主流程（残留 tmp 由后续运维清理）
      this.logger.warn(`清理临时文件失败: ${tmpPath}`)
    }
  }

  /**
   * 将正式区文件复制为临时区新文件（P4c T49 在线解压：zip 源中转，避免直接读正式区被并发覆盖/移动）。
   * @returns 临时文件绝对路径（调用方负责 finally 中 removeTmp 清理）
   */
  async copyToTmp(storageName: string): Promise<string> {
    const src = this.resolveStorage(storageName)
    const tmpPath = join(this.tmpDir, `${randomUUID()}.zip`)
    await copyFile(src, tmpPath)
    return tmpPath
  }

  /**
   * 在临时区创建写入流（P4c T49 在线解压：解压条目流式落 tmp，禁入内存）。
   * @param ext 目标扩展名（小写不带点；仅字母数字，非法视为无扩展名）
   * @returns { path, stream }；调用方负责 stream 结束/错误处理与 finally 中 removeTmp 清理
   */
  async createTmpWriteStream(ext: string): Promise<{ path: string; stream: WriteStream }> {
    const safeExt = /^[a-z0-9]{1,20}$/.test(ext) ? ext : ''
    const path = join(this.tmpDir, `${randomUUID()}${safeExt ? `.${safeExt}` : ''}`)
    const stream = createWriteStream(path)
    return { path, stream }
  }

  /** 读取正式区文件流（支持 Range 区间，视频拖动依赖） */
  createReadStream(storageName: string, options?: { start?: number; end?: number }): Readable {
    return createReadStream(this.resolveStorage(storageName), options)
  }

  /**
   * 解析正式区文件的绝对路径（P4d T54：yazl 打包需按路径惰性读盘，addFile 只接受真实路径）。
   * 路径穿越校验与内部读写同源（resolveStorage），业务层不得自行拼接 UPLOAD_DIR。
   */
  resolvePath(storageName: string): string {
    return this.resolveStorage(storageName)
  }

  /** 正式区文件元信息；不存在返回 null（DB 有记录但物理丢失 = 数据不一致，由业务层报错） */
  async stat(storageName: string): Promise<{ size: number } | null> {
    try {
      const info = await stat(this.resolveStorage(storageName))
      return { size: info.size }
    } catch (error) {
      if (this.isNotFound(error)) return null
      throw error
    }
  }

  /** 解析 storage_name 为绝对路径，并校验不允许越出存储根目录（防路径穿越） */
  private resolveStorage(storageName: string): string {
    if (!storageName || isAbsolute(storageName) || storageName.includes('..')) {
      throw new Error(`非法存储路径: ${storageName}`)
    }
    const abs = resolve(this.baseDir, storageName)
    if (abs !== this.baseDir && !abs.startsWith(this.baseDir + sep)) {
      throw new Error(`存储路径越界: ${storageName}`)
    }
    return abs
  }

  // ==================== 站点发布快照区（P19 T160；平台自营区，不经云盘文件树暴露） ====================

  /** 快照区根（UPLOAD_DIR/site-releases；R156/R160：唯一写入方=发布管道，唯一删除方=版本/站点删除与保留清理） */
  get releasesRoot(): string {
    return join(this.baseDir, 'site-releases')
  }

  /**
   * 快照目录相对路径：`site-releases/{siteId}/{releaseId}`；
   * `tmp = true` → `site-releases/{siteId}/.tmp-{releaseId}`（发布中转区，rename 前对外不可见，D145）。
   */
  releaseDirOf(siteId: bigint | string, releaseId: bigint | string, tmp = false): string {
    const leaf = tmp ? `.tmp-${releaseId.toString()}` : releaseId.toString()
    return join('site-releases', siteId.toString(), leaf)
  }

  // ==================== 展示应用检查点区（P20 T167） ====================

  /** 检查点区根（UPLOAD_DIR/disp-releases；与站点快照区并列的平台自营区，不进云盘文件树） */
  get dispReleasesRoot(): string {
    return join(this.baseDir, 'disp-releases')
  }

  /**
   * 检查点目录相对路径：`disp-releases/{displayId}/{releaseId}`；
   * `tmp = true` → `disp-releases/{displayId}/.tmp-{releaseId}`（保存中转区，rename 前不对外可见）。
   */
  dispReleaseDirOf(
    displayId: bigint | string,
    releaseId: bigint | string,
    tmp = false,
  ): string {
    const leaf = tmp ? `.tmp-${releaseId.toString()}` : releaseId.toString()
    return join('disp-releases', displayId.toString(), leaf)
  }

  /** 确保目录存在（快照区父目录链按需创建） */
  async ensureDir(relDir: string): Promise<void> {
    await mkdir(this.resolveStorage(relDir), { recursive: true })
  }

  /** 把正式区文件复制进快照目录（创建中间目录；`relPath` 相对快照目录，禁绝对路径/`..`） */
  async copyStorageInto(storageName: string, relDir: string, relPath: string): Promise<void> {
    const target = this.resolveInside(relDir, relPath)
    await mkdir(dirname(target), { recursive: true })
    await copyFile(this.resolveStorage(storageName), target)
  }

  /** 在快照目录内写文件（manifest.json 等生成物） */
  async writeInto(relDir: string, relPath: string, content: Buffer): Promise<void> {
    const target = this.resolveInside(relDir, relPath)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content)
  }

  /** 目录改名（发布 `rename .tmp → 正式`；与工作区同卷保证原子与瞬时，D145） */
  async renameDir(fromRel: string, toRel: string): Promise<void> {
    const to = this.resolveStorage(toRel)
    await mkdir(dirname(to), { recursive: true })
    await rename(this.resolveStorage(fromRel), to)
  }

  /** 删除目录树（版本删除 / 保留清理 / 发布失败清理 .tmp；不存在静默） */
  async removeDir(relDir: string): Promise<void> {
    await rm(this.resolveStorage(relDir), { recursive: true, force: true })
  }

  /** 目录是否存在（发布前置与互斥锁回收判断） */
  async dirExists(relDir: string): Promise<boolean> {
    try {
      const info = await stat(this.resolveStorage(relDir))
      return info.isDirectory()
    } catch (error) {
      if (this.isNotFound(error)) return false
      throw error
    }
  }

  /**
   * 快照目录内文件元信息（开放层快照轨用）。
   * 不存在返回 null；`isDir` 供目录语义（301 / index.html 回退）判定。
   */
  async statInDir(
    relDir: string,
    relPath: string,
  ): Promise<{ size: number; mtime: Date; isDir: boolean } | null> {
    try {
      const info = await stat(this.resolveInside(relDir, relPath))
      return { size: info.size, mtime: info.mtime, isDir: info.isDirectory() }
    } catch (error) {
      if (this.isNotFound(error)) return null
      throw error
    }
  }

  /** 快照目录内文件流（支持 Range 区间；开放层出流用） */
  createDirReadStream(
    relDir: string,
    relPath: string,
    options?: { start?: number; end?: number },
  ): Readable {
    return createReadStream(this.resolveInside(relDir, relPath), options)
  }

  /**
   * 解析「快照目录 + 相对路径」为绝对路径，并校验不越出该目录。
   * 快照轨**每次解析都过这道闸**（与 resolveStorage 同源策略，R160：site-releases 区不接受任何 URL 直达）。
   */
  private resolveInside(relDir: string, relPath: string): string {
    if (!relPath || isAbsolute(relPath) || relPath.includes('..')) {
      throw new Error(`非法快照内路径: ${relPath}`)
    }
    const base = this.resolveStorage(relDir)
    const abs = resolve(base, relPath)
    if (abs !== base && !abs.startsWith(base + sep)) {
      throw new Error(`快照内路径越界: ${relPath}`)
    }
    return abs
  }

  /** 校验给定路径位于临时区内（防误删正式区文件） */
  private assertInsideTmp(tmpPath: string): void {
    const abs = resolve(tmpPath)
    if (!abs.startsWith(this.tmpDir + sep)) {
      throw new Error(`路径不在临时区内: ${tmpPath}`)
    }
  }

  private isNotFound(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'ENOENT'
    )
  }
}
