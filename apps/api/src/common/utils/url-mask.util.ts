/** 脱敏占位符 */
const MASK = '***'

/** 默认需脱敏的查询参数键（P4E D56：分享提取码 sid、密码类参数） */
const DEFAULT_KEYS = ['sid', 'password']

/** 是否绝对 URL（http:// / https:// 等带 scheme 的形态） */
const ABSOLUTE_URL = /^[a-z][a-z0-9+.-]*:\/\//i

/**
 * URL 查询参数脱敏（P4E D56/T64）。
 *
 * 用途：把日志中出现的 URL（`req.originalUrl` 等）里的敏感查询参数值替换为 `***`，
 * 避免 sid（P4d 分享提取码通过后的短期凭证）与密码类参数以明文落日志。
 *
 * 纪律：
 * - 只替换目标键的值，URL 其余部分（path / 其他参数 / 绝对 URL 的 origin）保持原样；
 * - 未命中目标键时原样返回（不做任何重构，减少误伤）；
 * - 解析失败原样返回——**宁漏勿错**，脱敏不得阻断主流程（抛错被异常兜底捕获反而会掩盖原始异常）。
 *
 * 零新依赖（仅用内置 URL 解析）。
 */
export function maskSensitiveQuery(url: string, keys: string[] = DEFAULT_KEYS): string {
  if (!url || keys.length === 0) return url
  const isAbsolute = ABSOLUTE_URL.test(url)
  try {
    // 相对 URL 需要一个 base 才能解析（origin 仅作占位，不参与返回）
    const parsed = new URL(url, 'http://url-mask.invalid')
    let hit = false
    for (const key of keys) {
      if (parsed.searchParams.has(key)) {
        parsed.searchParams.set(key, MASK)
        hit = true
      }
    }
    if (!hit) return url
    const path = `${parsed.pathname}${parsed.search}`
    return isAbsolute ? `${parsed.origin}${path}` : path
  } catch {
    return url
  }
}
