/** 必需的环境变量 */
const REQUIRED_ENV_KEYS = [
  'DATABASE_URL',
  'REDIS_URL',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
] as const

/** 环境变量校验：缺失时启动即报错，避免运行期才发现配置问题 */
export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const missing = REQUIRED_ENV_KEYS.filter((key) => !config[key])
  if (missing.length > 0) {
    throw new Error(`缺少必需的环境变量: ${missing.join(', ')}`)
  }
  return config
}
