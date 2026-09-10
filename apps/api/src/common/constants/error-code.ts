/** 统一错误码（与 ARCHITECTURE.md「API 约定」一致） */
export const ErrorCode = {
  /** 成功 */
  Success: 0,
  /** 参数校验失败 */
  ParamInvalid: 40001,
  /** 未登录 / token 失效 */
  Unauthorized: 40100,
  /** 无权限 */
  Forbidden: 40300,
  /** 资源不存在 */
  NotFound: 40400,
  /** 请求过于频繁（限流） */
  TooManyRequests: 42900,
  /** 服务器内部错误 */
  InternalError: 50000,

  // ========== auth 域业务错误（101xx） ==========
  /** 用户名或密码错误 */
  InvalidCredentials: 10101,
  /** 账号已锁定（登录失败次数过多） */
  AccountLocked: 10102,
  /** 账号已禁用 */
  AccountDisabled: 10103,
  /** refresh token 无效或已过期 */
  InvalidRefreshToken: 10104,

  // ========== user 域（102xx） ==========
  /** 用户名已存在 */
  UsernameExists: 10201,
  /** admin 用户不可执行此操作（禁用/删除/改角色） */
  AdminProtected: 10202,
  /** 旧密码错误（个人中心修改密码） */
  OldPasswordIncorrect: 10203,

  // ========== role 域（103xx） ==========
  /** 角色标识已存在 */
  RoleCodeExists: 10301,
  /** 角色被用户引用，不可删除 */
  RoleInUse: 10302,
  /** admin 角色不可编辑/删除 */
  AdminRoleProtected: 10303,

  // ========== menu 域（104xx） ==========
  /** 菜单存在子级，不可删除 */
  MenuHasChildren: 10401,

  // ========== dept 域（105xx） ==========
  /** 部门存在子级，不可删除 */
  DeptHasChildren: 10501,
  /** 部门下存在用户，不可删除 */
  DeptHasUsers: 10502,

  // ========== dict 域（106xx） ==========
  /** 字典类型标识已存在 */
  DictTypeExists: 10601,
  /** 字典类型下存在数据，不可删除 */
  DictTypeHasData: 10602,

  // ========== ai 域（20xxx，见 API.md） ==========
  /** 未开通套餐或套餐已失效 */
  AiNoPlan: 20001,
  /** 积分不足 */
  AiInsufficientCredits: 20002,
  /** 模型不可用 / 已停用 */
  AiModelUnavailable: 20003,
  /** 会话不存在或无权访问 */
  AiConversationNotFound: 20004,
  /** 上游模型调用失败 */
  AiUpstreamError: 20005,
  /** 内容超出模型上下文长度 */
  AiContentTooLong: 20006,
  /** 上一段对话进行中（并发流限制） */
  AiChatInProgress: 20007,
  /** 套餐下有生效订阅，不可删除 */
  AiPlanInUse: 20008,
  /** 套餐标识已存在 */
  AiPlanCodeExists: 20009,
  /** 厂商标识已存在 */
  AiProviderCodeExists: 20010,
  /** 厂商下有模型，不可删除 */
  AiProviderHasModels: 20011,
  /** 模型（厂商内 API 模型名）已存在 */
  AiModelExists: 20012,
  /** 模型存在引用（会话/用量记录），不可删除，仅可停用 */
  AiModelInUse: 20013,
  /** 工具不存在或未启用 */
  AiToolNotFound: 20014,
  /** 无权限使用该工具 */
  AiToolNoPermission: 20015,
  /** 确认单不存在或已过期 */
  AiToolConfirmExpired: 20016,
  /** 工具执行失败 */
  AiToolFailed: 20017,

  // ========== cloud 域（30xxx，见 API.md §5.1） ==========
  /** 文件/文件夹不存在或无权访问 */
  CloudFileNotFound: 30001,
  /** 同目录下已存在同名项 */
  CloudNameConflict: 30002,
  /** 存储配额不足 */
  CloudQuotaExceeded: 30003,
  /** 文件超出大小限制 */
  CloudFileTooLarge: 30004,
  /** 该类型不支持预览 */
  CloudPreviewNotSupported: 30005,
  /** 超出目录限制（深度>10 / 单目录>500 项 / 名称>64 字符） */
  CloudDirLimitExceeded: 30006,
  /** 回收站记录不存在 */
  CloudRecycleNotFound: 30007,
  /** 分享链接无效（不存在/已停止/已过期/文件已删/未过审） */
  CloudShareInvalid: 30008,
  /** 文件夹暂不支持创建公开链接 */
  CloudShareNotAllowed: 30009,
  /** 文件未通过内容审核，禁止分享 */
  CloudAuditNotPassed: 30010,
  /** 用户仍有云盘文件，禁止删除 */
  CloudUserHasFiles: 30011,
  /** 该文件类型不支持在线编辑（非文本白名单扩展名，P4b T43） */
  CloudFileTypeNotAllowed: 30012,
  /** 内容超出在线编辑上限（1MB，P4b T43） */
  CloudContentTooLarge: 30013,
  /** 压缩包格式不支持或已损坏（P4c T49 unzip） */
  CloudUnzipNotSupported: 30014,
  /** 解压超限（条目数 / 累计总大小 / 单条目大小，P4c T49 unzip） */
  CloudUnzipLimitExceeded: 30015,
  /** 压缩包含非法路径条目（Zip Slip 拦截，整包拒绝，P4c T49 unzip） */
  CloudUnzipIllegalEntry: 30016,

  // ========== site 域（40xxx 段，40101 起；40001/40100/40300/40400/42900 为通用码已占用，见 API.md §6.1） ==========
  /** 站点不存在或未开通 */
  SiteNotFound: 40101,
  /** slug 已被占用 */
  SiteSlugTaken: 40102,
  /** slug 格式非法或命中保留字 */
  SiteSlugInvalid: 40103,
  /** 站点已停用 */
  SiteDisabled: 40104,
  /** 站点根目录不可用（被删或已取消公开） */
  SiteRootUnavailable: 40105,
  /** 栏目不存在 */
  SiteColumnNotFound: 40106,
  /** 栏目下存在子栏目或文章，不可删除 */
  SiteColumnInUse: 40107,
  /** 标签已存在 */
  SiteTagExists: 40108,
  /** 文章不存在 */
  SiteArticleNotFound: 40109,
  /** 评论不存在 */
  SiteCommentNotFound: 40110,
  /** 评论提交过于频繁 */
  SiteCommentTooFrequent: 40111,
  /** 用户已开通个人网站，禁止删除（R13 删用户预检） */
  SiteUserHasSite: 40112,
  /** 站点文件路径非法（越出站点根 / 含 .. / 绝对路径 / 空段，P4b R17） */
  SiteFilePathInvalid: 40113,
  /** 文件类型不允许（非文本白名单扩展名，P4b R17） */
  SiteFileTypeNotAllowed: 40114,
  /** 内容超限（AI 写单文件 >256KB / 单次 >10 个 / 读 >64KB，P4b R17） */
  SiteContentTooLarge: 40115,
  /** 模板不存在（P4b T44 apply-template） */
  SiteTemplateNotFound: 40116,
  /** 该文件夹未开放列表浏览（P4c，云盘公开文件夹 allow_listing=0 访问列表；开放层段） */
  CloudListingDisabled: 40117,
} as const

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode]
