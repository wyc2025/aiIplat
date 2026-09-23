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

  // ===== app 域公开面（P12 T108~T112，R105）=====
  /** 公开面 manifest 缓存：app:pub:{appId}:manifest，TTL 600s */
  appPubManifest: (appId: string) => `app:pub:${appId}:manifest`,
  /** 公开面页 schema 缓存：app:pub:{appId}:schema:{pageCode}，TTL 600s */
  appPubPageSchema: (appId: string, pageCode: string) => `app:pub:${appId}:schema:${pageCode}`,
  /** 公开面页 schema 前缀（SCAN 批量失效用）：app:pub:{appId}:schema: */
  appPubSchemaPrefix: (appId: string) => `app:pub:${appId}:schema:`,
  /** 公开面数据缓存前缀（SCAN 批量失效用）：app:pub:{appId}:data: */
  appPubDataPrefix: (appId: string) => `app:pub:${appId}:data:`,
  /** 公开面限流计数（60 次/分/IP，R106）：app:pub:rate:{ip}，INCR + 首次 60s TTL */
  appPubRate: (ip: string) => `app:pub:rate:${ip}`,
} as const
