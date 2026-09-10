/**
 * yauzl 本地窄类型声明（P4c T49，D37 特批仅 yauzl + iconv-lite 两个依赖；
 * yauzl 无自带类型且禁止额外引入 @types 包，故按 UnzipService 实际用到的 API 面声明）。
 */
declare module 'yauzl' {
  import type { Readable } from 'node:stream'

  /** 压缩条目（decodeStrings: false 时 fileName/rawFileName 为原始字节 Buffer） */
  export interface Entry {
    /** decodeStrings=false 时为 Buffer（原始字节，未按 cp437/utf-8 解码） */
    fileName: string | Buffer
    rawFileName?: Buffer
    uncompressedSize: number
    compressedSize: number
    /** 通用目的位标记：bit 11 (0x800) = UTF-8 文件名 */
    generalPurposeBitFlag: number
  }

  export interface ZipFile {
    /** 中央目录条目总数（打开即知，可提前做条目数上限校验） */
    entryCount: number
    readEntry(): void
    openReadStream(entry: Entry, callback: (err: Error | null, stream?: Readable) => void): void
    close(): void
    on(event: 'entry', listener: (entry: Entry) => void): this
    on(event: 'end', listener: () => void): this
    on(event: 'close', listener: () => void): this
    on(event: 'error', listener: (err: Error) => void): this
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 窄声明：移除上述任一事件监听器
    removeListener(event: string, listener: (...args: any[]) => void): this
  }

  export interface OpenOptions {
    /** 手动 readEntry 逐条拉取（顺序处理，便于边解边累计） */
    lazyEntries?: boolean
    /** 关闭时机由调用方控制（finally 中 close） */
    autoClose?: boolean
    /** false = 不解码文件名（拿到原始字节，按 UTF-8 flag / GBK 自行解码，R29） */
    decodeStrings?: boolean
  }

  export function open(
    path: string,
    options: OpenOptions,
    callback: (err: Error | null, zipfile?: ZipFile) => void,
  ): void
}
