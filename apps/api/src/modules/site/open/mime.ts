/**
 * 开放静态层 MIME 白名单与安全响应头（架构增补 §14.5）。
 * 白名单内真实 MIME 输出；白名单外一律 application/octet-stream + attachment 下载；
 * html/htm/svg/xml 附加 CSP sandbox 头（opaque origin，读不到主域凭证）。
 */

/**
 * CSP sandbox 固定值（D3/§14.5：html/svg/xml 附加，杜绝脚本读取主域 localStorage/cookie/JWT）。
 * 必须携带 allow-modals：访客页交互反馈（如评论提交后的 alert 提示）依赖弹窗 API；
 * 缺失时浏览器静默忽略 alert 且不产生报错，访客得不到任何成功/失败反馈（2026-08-29 修复）。
 */
export const CSP_SANDBOX = 'sandbox allow-scripts allow-forms allow-popups allow-downloads allow-modals'

/** 需附加 CSP sandbox 头的可执行文档扩展名 */
const SANDBOX_EXTS = new Set(['html', 'htm', 'svg', 'xml'])

/** 纯文本扩展名（沿用 P3 R7：强制 text/plain; charset=utf-8） */
const TEXT_EXTS = new Set(['txt', 'md', 'log', 'yml', 'yaml', 'csv'])

/** 扩展名 → Content-Type 映射（白名单，均为小写不带点） */
const MIME_MAP: Record<string, string> = {
  // 可执行文档（配 sandbox）
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  svg: 'image/svg+xml',
  xml: 'application/xml',
  // 脚本
  js: 'text/javascript',
  mjs: 'text/javascript',
  // 样式
  css: 'text/css',
  // 数据
  json: 'application/json',
  // 图片
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
  avif: 'image/avif',
  // 字体
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  // 音视频
  mp4: 'video/mp4',
  mp3: 'audio/mpeg',
  webm: 'video/webm',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  // 文档
  pdf: 'application/pdf',
}

/** 纯文本白名单（强制 text/plain，优先级高于 MIME_MAP，与 P3 R7 口径一致） */
const TEXT_MIME = 'text/plain; charset=utf-8'

/** 白名单外兜底 */
const FALLBACK_MIME = 'application/octet-stream'

/** 解析结果：是否白名单、Content-Type、是否需 sandbox、是否需 attachment 下载 */
export interface MimeResolution {
  /** 是否在白名单内 */
  whitelisted: boolean
  contentType: string
  /** 需附加 CSP sandbox 头（html/htm/svg/xml） */
  sandbox: boolean
  /** 白名单外：附加 Content-Disposition: attachment 下载 */
  attachment: boolean
}

/**
 * 根据扩展名（小写不带点）解析输出 Content-Type 与安全头标记。
 * 纯文本强制 text/plain（P3 R7 铁律在本开放链路的收窄：仅白名单类型 + 必须配 sandbox）。
 */
export function resolveMime(ext: string | null | undefined): MimeResolution {
  const key = (ext ?? '').toLowerCase()
  // 纯文本优先级最高（沿用 P3 R7）
  if (TEXT_EXTS.has(key)) {
    return { whitelisted: true, contentType: TEXT_MIME, sandbox: false, attachment: false }
  }
  if (SANDBOX_EXTS.has(key)) {
    return { whitelisted: true, contentType: MIME_MAP[key], sandbox: true, attachment: false }
  }
  const mime = MIME_MAP[key]
  if (mime) {
    return { whitelisted: true, contentType: mime, sandbox: false, attachment: false }
  }
  // 白名单外：octet-stream + attachment
  return { whitelisted: false, contentType: FALLBACK_MIME, sandbox: false, attachment: true }
}
