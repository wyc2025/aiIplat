import { registerAs } from '@nestjs/config'

/** 文件上传配置：本地磁盘，单文件上限 10MB */
export default registerAs('upload', () => ({
  dir: process.env.UPLOAD_DIR ?? './uploads',
  maxSize: 10 * 1024 * 1024,
}))
