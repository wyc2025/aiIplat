import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Response } from 'express'
import { randomUUID } from 'node:crypto'
import { ErrorCode } from '../../../common/constants/error-code'
import { RedisKey } from '../../../common/constants/redis-key'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import { RedisService } from '../../../infra/redis/redis.service'
import { StorageService } from '../../../infra/storage/storage.service'
import { CloudFacade } from '../../cloud/facade/cloud-facade.service'
import { AdminService } from '../admin/admin.service'
import { DataService } from '../data/data.service'
import { SchemaService } from '../schema/schema.service'
import type { ResolvedTable } from '../schema/schema.types'
import { decodeCsvText, parseCsv, toCsvRow } from './csv'
import type { ConfirmImportDto } from './dto/import.dto'

/** 导入错误行 */
export interface ImportRowError {
  row: number
  reason: string
}

/** 导入进度（Redis 镜像存储） */
export interface ImportProgress {
  status: 'pending' | 'running' | 'done' | 'failed'
  total: number
  done: number
  errors: ImportRowError[]
}

/** 内存态导入任务（rows 可能是数万行，不入 Redis；重启即失效，属预期） */
interface ImportTask {
  userId: string
  appCode: string
  tableName: string
  headers: string[]
  rows: string[][]
  mapping: Record<string, string>
  progress: ImportProgress
}

/** 导出上限（R92：≤5 万行，超出截断） */
const EXPORT_MAX_ROWS = 50_000
/** 导入进度 Redis TTL（秒） */
const IMPORT_PROGRESS_TTL_SEC = 3600
/** 进度上报批次（R92：每批 500 行） */
const IMPORT_BATCH = 500

/**
 * CSV 导入导出服务（P11 T103，R92 / API-P11 §1.5）：
 * - 导入：上传（≤5MB，自研 CSV 解析，UTF-8/GBK 探测）→ 列名自动映射 + 人工确认 + 前 5 行预览
 *   → 异步逐行导入（每行独立事务；错误行记录不中断，成功行落库不回滚）→ 进度轮询。
 * - 导出：流式 CSV（cursor 分页 ≤5 万行，超出截断并在尾注释说明）；附件字段导出 fileId，多值 ref 以 ";" 连接。
 * - 附件上传：经 CloudFacade.uploadForApp 强制落 /app-attachments/{appCode}/。
 */
@Injectable()
export class ImportService {
  private readonly logger = new Logger(ImportService.name)
  /** 进行中任务（内存态；进度同时镜像到 Redis 供轮询） */
  private readonly tasks = new Map<string, ImportTask>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly storage: StorageService,
    private readonly adminService: AdminService,
    private readonly schemaService: SchemaService,
    private readonly dataService: DataService,
    private readonly cloudFacade: CloudFacade,
  ) {}

  // ==================== 导入 ====================

  /** 上传解析（不落库）：解析 → 自动映射 → 建任务 → 返回预览 */
  async prepareImport(
    userId: bigint,
    appCode: string,
    tableName: string,
    file?: Express.Multer.File,
  ) {
    const app = await this.adminService.assertOwned(userId, appCode)
    const table = await this.schemaService.resolveTableByName(app.id, tableName)
    if (!file?.path) {
      throw new BusinessException(ErrorCode.AppImportInvalid, '缺少导入文件（multipart 字段名 file）')
    }
    const maxSize = this.config.get<number>('app.maxImportSize', 5 * 1024 * 1024)
    try {
      if (file.size <= 0) {
        throw new BusinessException(ErrorCode.AppImportInvalid, '导入文件为空')
      }
      if (file.size > maxSize) {
        const mb = Math.max(1, Math.floor(maxSize / 1024 / 1024))
        throw new BusinessException(ErrorCode.AppImportInvalid, `导入文件超出 ${mb}MB 上限`)
      }
      const name = (file.originalname || '').toLowerCase()
      if (!name.endsWith('.csv') && !(file.mimetype || '').includes('csv')) {
        throw new BusinessException(ErrorCode.AppImportInvalid, '仅支持 CSV 文件')
      }
      const buffer = await this.storage.readTmp(file.path)
      const rows = parseCsv(decodeCsvText(buffer))
      if (rows.length === 0 || rows[0].length === 0) {
        throw new BusinessException(ErrorCode.AppImportInvalid, 'CSV 首行缺少列名')
      }
      const headers = rows[0].map((header) => header.trim())
      if (headers.every((header) => header === '')) {
        throw new BusinessException(ErrorCode.AppImportInvalid, 'CSV 首行缺少列名')
      }
      const dataRows = rows.slice(1)
      const mapping = this.autoMap(headers, table)
      const taskId = randomUUID()
      this.tasks.set(taskId, {
        userId: userId.toString(),
        appCode,
        tableName,
        headers,
        rows: dataRows,
        mapping,
        progress: { status: 'pending', total: dataRows.length, done: 0, errors: [] },
      })
      await this.writeProgress(taskId, this.tasks.get(taskId)!.progress)
      const previewRows = dataRows.slice(0, 5).map((row) => {
        const item: Record<string, string> = {}
        headers.forEach((header, index) => {
          item[header] = row[index] ?? ''
        })
        return item
      })
      return { taskId, mapping, previewRows, total: dataRows.length }
    } finally {
      await this.storage.removeTmp(file.path)
    }
  }

  /** 确认映射并异步导入 */
  async confirmImport(
    userId: bigint,
    appCode: string,
    taskId: string,
    dto: ConfirmImportDto,
  ) {
    const task = this.requireTask(userId, appCode, taskId)
    if (task.progress.status === 'running') {
      throw new BusinessException(ErrorCode.AppImportInvalid, '该导入任务正在进行中')
    }
    if (dto.mapping) {
      const sanitized: Record<string, string> = {}
      for (const header of task.headers) {
        const value = dto.mapping[header]
        sanitized[header] = typeof value === 'string' ? value : (task.mapping[header] ?? '')
      }
      task.mapping = sanitized
    }
    task.progress = { status: 'running', total: task.rows.length, done: 0, errors: [] }
    await this.writeProgress(taskId, task.progress)
    // 异步执行（不阻塞响应）；进度经 GET /app/import/:taskId 轮询
    void this.runImport(taskId).catch((error) => {
      this.logger.error(`CSV 导入任务异常（${taskId}）：${(error as Error).message}`)
    })
    return { taskId, status: 'running', total: task.rows.length }
  }

  /** 查询导入进度（内存优先，Redis 兜底） */
  async getProgress(userId: bigint, taskId: string) {
    const task = this.tasks.get(taskId)
    if (task) {
      if (task.userId !== userId.toString()) {
        throw new BusinessException(ErrorCode.AppImportInvalid, '导入任务不存在或已过期')
      }
      return task.progress
    }
    const cached = await this.redis.client.get(RedisKey.appImport(taskId)).catch(() => null)
    if (!cached) {
      throw new BusinessException(ErrorCode.AppImportInvalid, '导入任务不存在或已过期')
    }
    const parsed = JSON.parse(cached) as ImportProgress & { userId?: string }
    if (parsed.userId && parsed.userId !== userId.toString()) {
      throw new BusinessException(ErrorCode.AppImportInvalid, '导入任务不存在或已过期')
    }
    return parsed
  }

  /** 异步导入主体：逐行独立事务，错误行记录不中断 */
  private async runImport(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId)
    if (!task) return
    try {
      const userId = BigInt(task.userId)
      const app = await this.adminService.assertOwned(userId, task.appCode)
      const table = await this.schemaService.resolveTableByName(app.id, task.tableName)
      const errors: ImportRowError[] = []
      let done = 0
      for (const [index, row] of task.rows.entries()) {
        try {
          const values = this.buildValues(table, task, row)
          if (Object.keys(values).length === 0) continue
          await this.prisma.$transaction(async (tx) => {
            await this.dataService.createRow(tx, app, table, values, userId)
          })
        } catch (error) {
          errors.push({
            row: index + 2,
            reason: error instanceof BusinessException ? error.message : '导入失败',
          })
        }
        done += 1
        if (done % IMPORT_BATCH === 0) {
          task.progress = { status: 'running', total: task.rows.length, done, errors }
          await this.writeProgress(taskId, task.progress)
        }
      }
      task.progress = { status: 'done', total: task.rows.length, done, errors }
      await this.writeProgress(taskId, task.progress)
    } catch (error) {
      task.progress = {
        status: 'failed',
        total: task.rows.length,
        done: task.progress.done,
        errors: [
          { row: 0, reason: error instanceof BusinessException ? error.message : '导入任务失败' },
        ],
      }
      await this.writeProgress(taskId, task.progress)
    } finally {
      // 行数据释放；进度保留在 Redis 供轮询
      this.tasks.delete(taskId)
    }
  }

  // ==================== 导出 ====================

  /** 流式导出 CSV（≤5 万行；附件字段输出 fileId，多值 ref 以 ";" 连接） */
  async exportCsv(
    userId: bigint,
    appCode: string,
    tableName: string,
    res: Response,
  ): Promise<void> {
    const app = await this.adminService.assertOwned(userId, appCode)
    const table = await this.schemaService.resolveTableByName(app.id, tableName)
    const columns = table.fields
    const { views, truncated } = await this.dataService.fetchAllRows(app, table, EXPORT_MAX_ROWS)

    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(`${appCode}-${tableName}.csv`)}"`,
    )
    res.write('\uFEFF')
    res.write(`${toCsvRow(['rowId', ...columns.map((field) => field.name)])}\r\n`)
    for (const view of views) {
      const cells = columns.map((field) => {
        const value = view.data[field.name]
        if (Array.isArray(value)) return value.join(';')
        return value
      })
      res.write(`${toCsvRow([view.rowId, ...cells])}\r\n`)
    }
    if (truncated) {
      res.write(`# 数据超过 ${EXPORT_MAX_ROWS} 行，已截断\r\n`)
    }
    res.end()
  }

  // ==================== 附件上传 ====================

  /** 附件字段上传（强制落 /app-attachments/{appCode}/，≤10MB，占云盘配额） */
  async uploadAttachment(
    userId: bigint,
    appCode: string,
    file?: Express.Multer.File,
  ) {
    // 属主校验（应用不存在/无权 50001）
    await this.adminService.assertOwned(userId, appCode)
    const maxBytes = this.config.get<number>('app.maxAttachmentSize', 10 * 1024 * 1024)
    return this.cloudFacade.uploadForApp(userId, appCode, file, maxBytes)
  }

  // ==================== 内部 ====================

  private requireTask(userId: bigint, appCode: string, taskId: string): ImportTask {
    const task = this.tasks.get(taskId)
    if (!task || task.userId !== userId.toString() || task.appCode !== appCode) {
      throw new BusinessException(ErrorCode.AppImportInvalid, '导入任务不存在或已过期')
    }
    return task
  }

  private async writeProgress(taskId: string, progress: ImportProgress): Promise<void> {
    const task = this.tasks.get(taskId)
    const payload = { ...progress, userId: task?.userId }
    await this.redis.client
      .set(RedisKey.appImport(taskId), JSON.stringify(payload), 'EX', IMPORT_PROGRESS_TTL_SEC)
      .catch(() => undefined)
  }

  /** 自动映射：字段名/显示名精确 → 包含；多值 ref 不参与（需中间表，CSV 无法表达） */
  private autoMap(headers: string[], table: ResolvedTable): Record<string, string> {
    const mapping: Record<string, string> = {}
    const candidates = table.fields.filter((field) => !field.refMultiple)
    for (const header of headers) {
      const key = header.trim().toLowerCase()
      if (!key) {
        mapping[header] = ''
        continue
      }
      const hit =
        candidates.find((field) => field.name.toLowerCase() === key) ??
        candidates.find((field) => field.label.toLowerCase() === key) ??
        candidates.find(
          (field) =>
            field.name.toLowerCase().includes(key) || field.label.toLowerCase().includes(key),
        )
      mapping[header] = hit ? hit.name : ''
    }
    return mapping
  }

  /** 按映射组装写入值（CSV 单元格字符串 → 字段类型；空串跳过以走默认/空值） */
  private buildValues(
    table: ResolvedTable,
    task: ImportTask,
    row: string[],
  ): Record<string, unknown> {
    const values: Record<string, unknown> = {}
    task.headers.forEach((header, index) => {
      const fieldName = task.mapping[header]
      if (!fieldName) return
      const raw = (row[index] ?? '').trim()
      if (raw === '') return
      const field = table.fieldMap.get(fieldName)
      if (!field || field.refMultiple) return
      switch (field.type) {
        case 'number': {
          const num = Number(raw)
          if (!Number.isFinite(num)) {
            throw new BusinessException(ErrorCode.AppDataInvalid, `字段「${field.label}」不是合法数字：${raw}`)
          }
          values[fieldName] = num
          break
        }
        case 'bool':
          values[fieldName] = this.parseBool(raw, field.label)
          break
        case 'datetime':
          if (Number.isNaN(Date.parse(raw))) {
            throw new BusinessException(ErrorCode.AppDataInvalid, `字段「${field.label}」不是合法日期：${raw}`)
          }
          values[fieldName] = new Date(raw).toISOString()
          break
        default:
          values[fieldName] = raw
      }
    })
    return values
  }

  private parseBool(raw: string, label: string): boolean {
    const value = raw.toLowerCase()
    if (['true', '1', '是', 'yes', 'y'].includes(value)) return true
    if (['false', '0', '否', 'no', 'n'].includes(value)) return false
    throw new BusinessException(ErrorCode.AppDataInvalid, `字段「${label}」不是合法布尔值：${raw}`)
  }
}
