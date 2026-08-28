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
} as const

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode]
