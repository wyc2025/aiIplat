import { mkdirSync, createWriteStream } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { stat as statCb, unlink } from 'node:fs'
import type { StorageEngine } from 'multer'
import { StorageService } from './storage.service'

/**
 * 通用上传临时存储引擎（Multer 磁盘流的替代实现）：
 * 请求阶段全程流式写入 StorageService.tmpDir/uuid.tmp，杜绝 memoryStorage 整文件进内存。
 * 写完后以 fs.stat 回填权威 size（配额记账依赖），出错/超限自动清理半成品临时文件。
 * 作为 infra 公共资产，各域（cloud/transfer、system/avatar 等）统一复用，禁止各域各自实现。
 */
export function createTmpUploadStorage(): StorageEngine {
  const tmpDir = StorageService.tmpDirPath()
  return {
    _handleFile(_req, file, callback) {
      mkdirSync(tmpDir, { recursive: true })
      const filename = `${randomUUID()}.tmp`
      const target = join(tmpDir, filename)
      const out = createWriteStream(target)
      let settled = false
      const fail = (error: Error) => {
        if (settled) return
        settled = true
        out.destroy()
        unlink(target, () => {})
        callback(error)
      }
      file.stream.pipe(out)
      out.on('error', fail)
      file.stream.on('error', fail)
      file.stream.on('aborted', () => fail(new Error('upload aborted by client')))
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
    _removeFile(_req, file, callback) {
      if (!file?.path) {
        callback(null)
        return
      }
      unlink(file.path, () => callback(null))
    },
  }
}
