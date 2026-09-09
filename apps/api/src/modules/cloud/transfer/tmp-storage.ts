import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface'
import { createTmpUploadStorage } from '../../../infra/storage/tmp-storage'
import { readCloudMaxFileSize } from '../../../config/upload.config'

/**
 * 通用上传 Multer 配置工厂（复用 infra 公共上传引擎，磁盘流写入临时区）：
 * - 全程流式落盘，不进内存；超限由 limits 控制。
 * - defParamCharset='utf8'：busboy 解析 multipart filename 默认按 latin1 逐字节解码，
 *   中文文件名的 UTF-8 字节会被误读成乱码（如"测试.mp4"→"æµ‹è¯•.mp4"）；
 *   浏览器发送的 filename 本就是 UTF-8，声明 utf8 后原样还原。
 */
export function cloudUploadOptions(fileSize: number): MulterOptions {
  return {
    storage: createTmpUploadStorage(),
    defParamCharset: 'utf8',
    limits: { fileSize, files: 1 },
  }
}

/** 云盘上传默认配置（单文件上限取 CLOUD_MAX_FILE_SIZE，缺省 100MB） */
export const CLOUD_UPLOAD_OPTIONS: MulterOptions = cloudUploadOptions(readCloudMaxFileSize())
