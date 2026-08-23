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
} as const

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode]
