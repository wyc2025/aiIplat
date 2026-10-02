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
  /** write 工具确认单：ai:confirm:{toolCallId}，存 JSON，TTL 600s，确认/取消/过期即失效 */
  aiConfirm: (toolCallId: string) => `ai:confirm:${toolCallId}`,

  // ========== site 域（P4a 开放层，见架构增补 §14.9） ==========
  /** slug → 站点信息缓存：site:resolve:{slug}，JSON { siteId, rootFolderId, status, title, description, commentAudit }，TTL 300s */
  siteResolve: (slug: string) => `site:resolve:${slug}`,
  /** 路径 → fileId 缓存：site:path:{siteId}:{path}，"404" 为负缓存，TTL 60s */
  sitePath: (siteId: string, path: string) => `site:path:${siteId}:${path}`,
  /** 开放数据热缓存：site:data:{siteId}:{...}，JSON，TTL 60s */
  siteData: (siteId: string, key: string) => `site:data:${siteId}:${key}`,
  /** 查看数去重窗口：site:view:{articleId}:{ip}，SET NX EX 300 */
  siteView: (articleId: string, ip: string) => `site:view:${articleId}:${ip}`,
  /** 同文章同 IP 评论间隔：site:comment:rate:{articleId}:{ip}，TTL 60s（命中即 40111） */
  siteCommentRate: (articleId: string, ip: string) => `site:comment:rate:${articleId}:${ip}`,
  /** 开放层独立限流计数：site:rate:{bucket}:{ip}，INCR + 首次 60s TTL（bucket = static|api|comment） */
  siteRate: (bucket: string, ip: string) => `site:rate:${bucket}:${ip}`,
  /** 云盘公开端点独立限流计数：pub:rate:{bucket}:{ip}，INCR + 首次 60s TTL（bucket = static|data，P4c R32） */
  pubRate: (bucket: string, ip: string) => `pub:rate:${bucket}:${ip}`,
  /** 分享提取码通过后的短期访问凭证：share:pass:{token}:{sid}，TTL = min(2h, 分享剩余有效期)（P4d R42） */
  sharePass: (token: string, sid: string) => `share:pass:${token}:${sid}`,
  /** 分享提取码错误计数（IP+token，连续 5 次锁 10 分钟，照登录 10102 口径）：share:passfail:{ip}:{token}（P4d R42） */
  sharePassFail: (ip: string, token: string) => `share:passfail:${ip}:${token}`,

  // ========== app 域（P11 T100） ==========
  /** 应用 schema 全量打包缓存：app:schema:{appId}，结构/页面变更即 DEL，TTL 600s（R99） */
  appSchema: (appId: string) => `app:schema:${appId}`,
  /** CSV 导入任务进度：app:import:{taskId}，JSON {status,total,done,errors}，TTL 1h（T103 用） */
  appImport: (taskId: string) => `app:import:${taskId}`,

  // ===== app 域授权取数面（P12 R105 建键 → P14 D115 收敛：manifest/页 schema 退役）=====
  /** 取数面 schema 缓存（暴露表结构）：app:pub:{appId}:schema，TTL 600s（授权/暴露/结构变更即 DEL） */
  appPubSchema: (appId: string) => `app:pub:${appId}:schema`,
  /** 取数面数据缓存前缀（SCAN 批量失效用）：app:pub:{appId}:data: */
  appPubDataPrefix: (appId: string) => `app:pub:${appId}:data:`,
  /** 取数面限流计数（60 次/分/IP，R106）：app:pub:rate:{ip}，INCR + 首次 60s TTL */
  appPubRate: (ip: string) => `app:pub:rate:${ip}`,

  // ===== access 域对外配额（P15 T136 / R134，ARCHITECTURE-P15 §5）=====
  /** 凭证请求数·分钟窗：acc:quota:req:{credentialId}:m:{yyyyMMddHHmm}，INCR + 首次 120s TTL */
  accQuotaReqMinute: (credentialId: string, window: string) =>
    `acc:quota:req:${credentialId}:m:${window}`,
  /** 凭证请求数·日窗：acc:quota:req:{credentialId}:d:{yyyyMMdd}，INCR + 首次 48h TTL */
  accQuotaReqDay: (credentialId: string, window: string) =>
    `acc:quota:req:${credentialId}:d:${window}`,
  /** 凭证返回行数·日窗：acc:quota:rows:{credentialId}:d:{yyyyMMdd}，INCRBY + 首次 48h TTL（按返回行数计） */
  accQuotaRowsDay: (credentialId: string, window: string) =>
    `acc:quota:rows:${credentialId}:d:${window}`,

  // ===== access 域 OAuth2 令牌（P18 T155 / D139/R151，ARCHITECTURE-P18 §34.2）=====
  /** 令牌 → 凭证：acc:token:{sha256(token)} = credentialId，TTL = access.tokenTtlSeconds（不透明令牌，不落 DB） */
  accToken: (tokenHash: string) => `acc:token:${tokenHash}`,
  /** 每凭证活跃令牌索引：acc:token:idx:{credentialId}，成员 = sha256(token)；吊销 / 轮换时按集合级联删除（R154） */
  accTokenIndex: (credentialId: string) => `acc:token:idx:${credentialId}`,
} as const
