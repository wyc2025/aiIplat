import { registerAs } from '@nestjs/config'

/** UPLOAD_DIR 环境读取（配置组与 Multer 静态配置共用，单一来源） */
export function readUploadDir(): string {
  return process.env.UPLOAD_DIR ?? './uploads'
}

/** 云盘单文件大小上限读取（字节） */
export function readCloudMaxFileSize(): number {
  const value = Number(process.env.CLOUD_MAX_FILE_SIZE)
  return Number.isFinite(value) && value > 0 ? value : 100 * 1024 * 1024
}

/** 在线解压单包条目数上限读取（P4c T49） */
export function readCloudUnzipMaxEntries(): number {
  const value = Number(process.env.CLOUD_UNZIP_MAX_ENTRIES)
  return Number.isFinite(value) && value > 0 ? value : 5000
}

/** 在线解压单包累计总大小上限读取（字节） */
export function readCloudUnzipMaxTotalSize(): number {
  const value = Number(process.env.CLOUD_UNZIP_MAX_TOTAL_SIZE)
  return Number.isFinite(value) && value > 0 ? value : 500 * 1024 * 1024
}

/** 回收站保留天数读取（P4F D58，默认 30 天） */
export function readCloudRecycleRetentionDays(): number {
  const value = Number(process.env.CLOUD_RECYCLE_RETENTION_DAYS)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 30
}

/** 回收站自动清理总开关读取（P4F D58，默认开；仅显式 false/0 时关闭） */
export function readCloudRecycleCleanEnabled(): boolean {
  const value = process.env.CLOUD_RECYCLE_CLEAN_ENABLED
  if (value === undefined) return true
  return value !== 'false' && value !== '0'
}

/** 文件上传配置：本地磁盘，单文件上限 10MB；云盘相关配置（P3 扩展） */
export default registerAs('upload', () => ({
  dir: readUploadDir(),
  maxSize: 10 * 1024 * 1024,
  /** 云盘单文件大小上限（字节，默认 100MB） */
  cloudMaxFileSize: readCloudMaxFileSize(),
  /** 在线解压单包条目数上限（默认 5000，P4c T49） */
  cloudUnzipMaxEntries: readCloudUnzipMaxEntries(),
  /** 在线解压单包累计总大小上限（字节，默认 500MB，P4c T49） */
  cloudUnzipMaxTotalSize: readCloudUnzipMaxTotalSize(),
  /** 云盘默认存储配额（字节，默认 1GB） */
  cloudDefaultQuota: Number(process.env.CLOUD_DEFAULT_QUOTA ?? 1024 * 1024 * 1024),
  /** 云盘内容审核门禁开关（默认关闭，D13 预留） */
  cloudAuditEnabled: process.env.CLOUD_AUDIT_ENABLED === 'true',
  /** 回收站保留天数（默认 30，P4F D58） */
  cloudRecycleRetentionDays: readCloudRecycleRetentionDays(),
  /** 回收站自动清理总开关（默认开，P4F D58） */
  cloudRecycleCleanEnabled: readCloudRecycleCleanEnabled(),
}))
