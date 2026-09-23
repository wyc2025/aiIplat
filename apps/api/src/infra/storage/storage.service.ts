import { createReadStream, createWriteStream } from 'node:fs'
import { copyFile, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
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

  /** 校验给定路径位于临时区内（防误删正式区文件） */
  private assertInsideTmp(tmpPath: string): void {
    const abs = resolve(tmpPath)
    if (!abs.startsWith(this.tmpDir + sep)) {
      throw new Error(`路径不在临时区内: ${tmpPath}`)
    }
  }

  private isNotFound(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'ENOENT'
  }
}
