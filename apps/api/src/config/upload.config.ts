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

/** 文件上传配置：本地磁盘，单文件上限 10MB；云盘相关配置（P3 扩展） */
export default registerAs('upload', () => ({
  dir: readUploadDir(),
  maxSize: 10 * 1024 * 1024,
  /** 云盘单文件大小上限（字节，默认 100MB） */
  cloudMaxFileSize: readCloudMaxFileSize(),
  /** 云盘默认存储配额（字节，默认 1GB） */
  cloudDefaultQuota: Number(process.env.CLOUD_DEFAULT_QUOTA ?? 1024 * 1024 * 1024),
  /** 云盘内容审核门禁开关（默认关闭，D13 预留） */
  cloudAuditEnabled: process.env.CLOUD_AUDIT_ENABLED === 'true',
}))
