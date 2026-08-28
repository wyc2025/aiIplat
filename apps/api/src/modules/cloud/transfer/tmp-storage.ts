import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface'
import { createTmpUploadStorage } from '../../../infra/storage/tmp-storage'
import { readCloudMaxFileSize } from '../../../config/upload.config'

/**
 * 通用上传 Multer 配置工厂（复用 infra 公共上传引擎，磁盘流写入临时区）：
 * - 全程流式落盘，不进内存；超限由 limits 控制。
 */
export function cloudUploadOptions(fileSize: number): MulterOptions {
  return {
    storage: createTmpUploadStorage(),
    limits: { fileSize, files: 1 },
  }
}

/** 云盘上传默认配置（单文件上限取 CLOUD_MAX_FILE_SIZE，缺省 100MB） */
export const CLOUD_UPLOAD_OPTIONS: MulterOptions = cloudUploadOptions(readCloudMaxFileSize())
