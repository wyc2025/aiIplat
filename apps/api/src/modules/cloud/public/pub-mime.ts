/**
 * 云盘公开端点 MIME 白名单（P4c R26：沿用 P3 预览白名单（R7 扩展），落地页消费口径）。
 * 与 site 域开放层 mime.ts 分属两域，禁止跨域 import（域边界铁律），故本表独立维护：
 * - 文本类强制 text/plain; charset=utf-8（防脚本执行，落地页 textContent 渲染）
 * - html/htm/svg 强制 attachment 下载（可携带脚本，防 XSS）
 * - 图片/音视频/PDF inline 输出（video/audio 原生 controls 依赖）
 * - 白名单外一律 application/octet-stream + attachment
 */

/** 文本类（P3 R7 预览白名单同集）：强制 text/plain; charset=utf-8 */
const TEXT_EXTS = new Set(['txt', 'md', 'json', 'js', 'ts', 'vue', 'css', 'xml', 'yml', 'yaml', 'csv', 'log'])

/** 强制 attachment 的可携带脚本类型（R26）：html/htm/svg */
const FORCE_ATTACHMENT_EXTS = new Set(['html', 'htm', 'svg'])

/** 图片（F2 落地页 img 直显） */
const IMAGE_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
}

/** 音视频（F2 落地页原生 controls；R7 扩展 webm/ogg/wav/m4a） */
const MEDIA_MIME: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  ogg: 'audio/ogg',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  pdf: 'application/pdf',
}

export interface PubMimeResolution {
  contentType: string
  /** inline 输出（false = 强制 attachment 下载） */
  inline: boolean
}

/**
 * 解析公开 raw 端点输出：文本 → text/plain（inline）；
 * html/htm/svg → octet-stream + attachment；图片/音视频/PDF → 真实 MIME inline；
 * 其余 → octet-stream + attachment。
 */
export function resolvePubMime(ext: string | null | undefined): PubMimeResolution {
  const key = (ext ?? '').toLowerCase()
  if (TEXT_EXTS.has(key)) {
    return { contentType: 'text/plain; charset=utf-8', inline: true }
  }
  if (FORCE_ATTACHMENT_EXTS.has(key)) {
    return { contentType: 'application/octet-stream', inline: false }
  }
  const mime = IMAGE_MIME[key] ?? MEDIA_MIME[key]
  if (mime) {
    return { contentType: mime, inline: true }
  }
  return { contentType: 'application/octet-stream', inline: false }
}
