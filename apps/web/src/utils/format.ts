/**
 * 展示格式化工具（纯函数，各列表页共用）。
 * 注意：后端时间字段为 ISO 字符串（如 2026-08-27T15:20:02.635Z），表格展示必须经 formatTime。
 */

/** 字节数 → 可读大小（B/KB/MB/GB） */
export function formatSize(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B'
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

/** 时间格式化：ISO/时间戳/Date → YYYY-MM-DD HH:mm:ss（无效输入原样返回） */
export function formatTime(input: string | number | Date): string {
  const d = input instanceof Date ? input : new Date(input)
  if (Number.isNaN(d.getTime())) return String(input)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
