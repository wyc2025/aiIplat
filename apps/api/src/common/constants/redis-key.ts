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
  /** 单用户并发流限制：ai:chatting:{userId}，存在即拒绝新流（20007），流结束时主动删除，TTL 兜底 */
  aiChatting: (userId: string) => `ai:chatting:${userId}`,
  /** 聊天限流计数（20 次/分/用户）：ai:chat:rate:{userId}，INCR + 首次设置 60s TTL */
  aiChatRate: (userId: string) => `ai:chat:rate:${userId}`,
  /** 在线用户 hash：online:{userId}，字段 username/nickname/ip/loginAt/lastActiveAt，30min 滑动过期 */
  online: (userId: string) => `online:${userId}`,
} as const
