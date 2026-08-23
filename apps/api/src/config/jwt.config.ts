import { registerAs } from '@nestjs/config'

/** JWT 配置：access 2h + refresh 7d 双 token */
export default registerAs('jwt', () => ({
  accessSecret: process.env.JWT_ACCESS_SECRET,
  accessExpires: process.env.JWT_ACCESS_EXPIRES ?? '2h',
  refreshSecret: process.env.JWT_REFRESH_SECRET,
  refreshExpires: process.env.JWT_REFRESH_EXPIRES ?? '7d',
}))
