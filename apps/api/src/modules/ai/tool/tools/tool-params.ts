/**
 * 工具入参安全取值（P5 T72 云盘 / T73 CMS / T74 生命周期共用）。
 * 模型生成的参数不可信（类型、空白串、重复项都可能出现），工具层统一整形后再透传给域门面。
 */

/** 字符串参数安全取值（非字符串或空白串 → undefined） */
export function readStrParam(params: Record<string, unknown>, key: string): string | undefined {
  const raw = params[key]
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/** 字符串数组参数安全取值（去重、丢空串、保序） */
export function readStrArrayParam(params: Record<string, unknown>, key: string): string[] {
  const raw = params[key]
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (trimmed.length > 0) seen.add(trimmed)
  }
  return [...seen]
}

/** 数字参数安全取值（接受 number 与纯数字字符串；非法 → undefined） */
export function readNumParam(params: Record<string, unknown>, key: string): number | undefined {
  const raw = params[key]
  if (typeof raw === 'number' && Number.isInteger(raw)) return raw
  if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) return Number(raw.trim())
  return undefined
}
