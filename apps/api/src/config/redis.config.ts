import { registerAs } from '@nestjs/config'

/** Redis 配置 */
export default registerAs('redis', () => ({
  url: process.env.REDIS_URL,
}))
