/** 把 '2h' / '7d' 形式的时长解析为秒数（纯数字按秒处理） */
export function parseDurationToSeconds(duration: string): number {
  const match = /^(\d+)([smhd])$/.exec(duration)
  if (!match) return Number(duration) || 0
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 }
  return Number(match[1]) * multipliers[match[2]]
}
