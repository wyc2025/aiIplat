/**
 * yazl 本地窄类型声明（P4d T54，D45 特批仅 yazl 一个新增依赖；
 * yazl 无自带类型且禁止额外引入 @types 包，故按 PackService 实际用到的 API 面声明）。
 */
declare module 'yazl' {
  import type { Readable } from 'node:stream'

  export interface AddFileOptions {
    /** 条目修改时间（缺省取真实文件 mtime） */
    mtime?: Date
    /** 是否压缩（缺省 true = deflate） */
    compress?: boolean
    mode?: number
  }

  export class ZipFile {
    /** 输出流（PassThrough）：pipe 到 HTTP 响应即边压边流，不落临时文件、不进内存 */
    outputStream: Readable
    /** 追加磁盘文件（realPath 为绝对路径；yazl 内部惰性 createReadStream，逐条边读边压） */
    addFile(realPath: string, metadataPath: string, options?: AddFileOptions): void
    /** 条目添加完毕后调用；zip 尾声（中央目录）随后写入 outputStream */
    end(options?: { forceZip64Format?: boolean; comment?: string }): void
    on(event: 'error', listener: (err: Error) => void): this
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 窄声明：移除事件监听器
    removeListener(event: string, listener: (...args: any[]) => void): this
  }
}
