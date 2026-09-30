import { registerAs } from '@nestjs/config'

/** 正整数读取：非法或缺省回退默认值（与 app/site/market/display 配置组风格一致） */
function readPositiveInt(key: string, fallback: number): number {
  const value = Number(process.env[key])
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

/**
 * access 域配置（P15 T132，API-P15 §6 / ARCHITECTURE-P15 §7）：对外开放接入层护栏，
 * 均有默认值，.env 可选覆盖（前缀 ACCESS_*）。零新依赖、零必需环境变量
 * （不进 validate.ts 的 REQUIRED_ENV_KEYS）。
 */
export default registerAs('access', () => ({
  /** 每用户凭证数上限（超限 50020，R130） */
  maxCredentialsPerUser: readPositiveInt('ACCESS_MAX_CREDENTIALS_PER_USER', 20),
  /** 每凭证请求数配额·分钟窗（超限 HTTP 429 + 42900，R134） */
  quotaPerMinute: readPositiveInt('ACCESS_QUOTA_PER_MINUTE', 120),
  /** 每凭证请求数配额·日窗（R134） */
  quotaPerDay: readPositiveInt('ACCESS_QUOTA_PER_DAY', 50000),
  /** 每凭证返回行数·日窗（按返回行数累计，schema 端点计 0 行；R134） */
  rowsPerDay: readPositiveInt('ACCESS_ROWS_PER_DAY', 100000),
  /** acc_audit 保留天数（每日清理 cron，R135） */
  auditRetentionDays: readPositiveInt('ACCESS_AUDIT_RETENTION_DAYS', 90),
  /** 审计缓冲 flush 间隔毫秒（每 5s 或满 100 条批量落表，R135） */
  auditFlushMs: readPositiveInt('ACCESS_AUDIT_FLUSH_MS', 5000),
}))
