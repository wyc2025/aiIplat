/**
 * AI 对话附件（P10 T98 / D84 / D86 / R86）。
 *
 * 与后端同源口径（`modules/ai/chat/attachment-resolver.ts`）：
 * - 类型白名单：仅文本类，前端用于入参过滤与 FilePicker 的 acceptExts；
 * - 上限：单文件 ≤2MB、单条消息 ≤5 个；
 * - 留档目录：本地上传先落云盘固定目录 `/ai-attachments/`（自动创建，删除/回收站/配额语义沿用云盘）。
 * 前端只做「体验级」预校验（真正的校验链在后端，错误码 30001/30012/30013/40001）。
 */

/** 可选附件扩展名（小写、不含点；D86 白名单前端副本） */
export const ATTACHMENT_EXTS: string[] = [
  'txt',
  'md',
  'markdown',
  'json',
  'js',
  'ts',
  'jsx',
  'tsx',
  'vue',
  'css',
  'scss',
  'xml',
  'yml',
  'yaml',
  'log',
  'csv',
  'html',
  'htm',
  'py',
  'java',
  'go',
  'rs',
  'c',
  'cc',
  'cpp',
  'h',
  'hpp',
  'sql',
  'sh',
  'bat',
  'ini',
  'conf',
  'toml',
]

/** 单文件体积上限（2MB，与后端 ATTACHMENT_MAX_BYTES 一致） */
export const ATTACHMENT_MAX_BYTES = 2 * 1024 * 1024
/** 单条消息附件数量上限（与后端 ATTACHMENT_MAX_COUNT 一致） */
export const ATTACHMENT_MAX_COUNT = 5
/** 本地上传留档目录名（云盘根下固定目录，D84） */
export const ATTACHMENT_DIR_NAME = 'ai-attachments'

/** 文件名扩展名（小写、不含点；无扩展名返回空串） */
export function extOfName(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/** 是否属于可作附件的文本类型 */
export function isAllowedAttachment(name: string): boolean {
  return ATTACHMENT_EXTS.includes(extOfName(name))
}

/** file input 的 accept 属性（`''` 表示不限，仅当白名单为空时） */
export function attachmentAcceptAttr(): string {
  return ATTACHMENT_EXTS.map((ext) => `.${ext}`).join(',')
}
