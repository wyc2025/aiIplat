/** Redis Key 统一约定 */
export const RedisKey = {
  /** 登录失败计数：login:fail:{username} */
  loginFail: (username: string) => `login:fail:${username}`,
  /** refresh token：refresh:{userId}:{jti} */
  refresh: (userId: string, jti: string) => `refresh:${userId}:${jti}`,
  /** access token 黑名单（登出）：token:blacklist:{jti} */
  tokenBlacklist: (jti: string) => `token:blacklist:${jti}`,
  /** 密码修改时间戳（秒）：user:pwd:changed:{userId}，签发早于该值的 access 全部失效 */
  pwdChanged: (userId: string) => `user:pwd:changed:${userId}`,
  /** 用户权限标识集合缓存（JSON 数组，超管为 ['*']）：user:perms:{userId} */
  userPerms: (userId: string) => `user:perms:${userId}`,
} as const
