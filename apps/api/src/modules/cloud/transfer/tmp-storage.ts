import { mkdirSync, createWriteStream } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { stat as statCb, unlink } from 'node:fs'
import type { StorageEngine } from 'multer'
import { readUploadDir, readCloudMaxFileSize } from '../../../config/upload.config'

// 说明：multer 是 @nestjs/platform-express 的传递依赖（pnpm 隔离不可运行时 import），
// 此处仅做类型导入（编译后消失，类型解析走 @types/multer），运行时以自定义 StorageEngine 落盘。

/**
 * 云盘上传临时存储引擎（Multer 磁盘流的替代实现）：
 * 请求阶段全程流式写入 UPLOAD_DIR/tmp/uuid.tmp，杜绝 memoryStorage 整文件进内存（ARCHITECTURE-P3 §13.3）。
 * 行为对齐 multer 官方 diskStorage 三条：① 写完以 fs.stat 回填 file.size（配额记账依赖，
 * 比 bytesWritten 更权威——文件系统落盘真值）；② 超限中断由 multer 核心监听 busboy limit
 * 事件报 LIMIT_FILE_SIZE 并调本引擎 _removeFile 清理；③ 本引擎自身再兜底流错误/客户端中断路径
 * （此时 callback 失败、文件不进 multer cleanup 列表，半截文件必须自行删除，不留 tmp 尸体）。
 * 装饰器静态求值，故目录与上限均直接读环境变量（与 upload.config 同一来源函数）。
 */
export function createCloudTmpStorage(): StorageEngine {
  const tmpDir = join(resolve(readUploadDir()), 'tmp')
  return {
    _handleFile(_req, file, callback) {
      mkdirSync(tmpDir, { recursive: true })
      const filename = `${randomUUID()}.tmp`
      const target = join(tmpDir, filename)
      const out = createWriteStream(target)
      // 单次回调保护：任何失败路径先清理半截文件再向 multer 报错（对齐 §13.3「任一失败删临时文件」）
      let settled = false
      const fail = (error: Error) => {
        if (settled) return
        settled = true
        out.destroy()
        unlink(target, () => {})
        callback(error)
      }
      // 流式管道：不缓冲；info 携带 path/size（multer 会合并进 file 对象）
      file.stream.pipe(out)
      // 写入流出错（磁盘满等）
      out.on('error', fail)
      // 源流出错（请求中断 premature close 等）
      file.stream.on('error', fail)
      // busboy 客户端中断标记（part 流 abort，不会走正常收尾）
      file.stream.on('aborted', () => fail(new Error('upload aborted by client')))
      // 正常收尾：stat 回填权威 size
      out.on('finish', () => {
        statCb(target, (error, stats) => {
          if (settled) return
          if (error) {
            fail(error)
            return
          }
          settled = true
          callback(null, { filename, path: target, size: stats.size })
        })
      })
    },
    // Multer 出错（如超限中断）时自动调用，清理半成品临时文件
    _removeFile(_req, file, callback) {
      if (!file?.path) {
        callback(null)
        return
      }
      unlink(file.path, () => callback(null))
    },
  }
}

/** 云盘上传 Multer options（Controller 装饰器静态使用） */
export const CLOUD_UPLOAD_OPTIONS = {
  storage: createCloudTmpStorage(),
  limits: { fileSize: readCloudMaxFileSize() },
  // 现代浏览器 multipart 文件名按 UTF-8 字节发送（RFC 7578 头域为 latin1，
  // busboy 默认 latin1 会把中文解析成 mojibake，需显式指定 utf8）
  defParamCharset: 'utf8',
} as const
