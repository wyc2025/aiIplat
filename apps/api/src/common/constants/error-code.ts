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
  /** 文件夹暂不支持创建分享链接 */
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
  /** 该分享需要提取码（未验证或凭证过期，P4d D47） */
  CloudShareNeedPassword: 30017,
  /** 提取码错误（含连续错误锁定提示剩余秒数，P4d R42） */
  CloudSharePasswordWrong: 30018,
  /** 非法移动目标（移入自身子树 / 站点根 / 回收站，P4d R37） */
  CloudMoveTargetInvalid: 30019,
  /** 站点根目录禁止直接删除（须先删除站点，P4E R52） */
  CloudSiteRootProtected: 30020,
  /** 文件被应用数据引用，禁止删除（P11 D96：cloud 删除/彻底删除/回收站清理预检；复用方=app_attachment_ref） */
  CloudFileReferencedByApp: 30021,

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
  /**
   * 站点数量已达上限（message 带 limit/used，P4E R47）。
   * 编号说明：PRD-P4E 原定 40117，但该码已被 P4c 的 CloudListingDisabled 占用
   * （前端 FolderView 与云盘公开页硬编码依赖），故 P4E 两码顺延为 40118/40119。
   */
  SiteQuotaExceeded: 40118,
  /** 站点不存在或非属主（P4E R56；不暴露他人站点存在性） */
  SiteForbidden: 40119,
  /**
   * 用户名下有站点内容（文章/栏目/标签），禁止删除（P7 D73/R75 删用户预检）。
   * 与 40112 的关系：内容池化后内容不再随站点删，无站点也可能有内容，故单列一码。
   */
  SiteUserHasContent: 40120,

  // ========== app 域（50xxx 段，50001 起；50000 为通用内部错误已占用，见 API.md §18.3） ==========
  /** 应用不存在或无权（统一属主校验；含系统表操作、越权表） */
  AppNotFound: 50001,
  /** 超出配额（message 带配额项：应用数/表数/行数/页数/附件/导入大小） */
  AppQuotaExceeded: 50002,
  /** 结构变更未通过数据校验（类型收窄遇存量违规，message 带前 10 个 rowId） */
  AppSchemaShrinkInvalid: 50003,
  /** 页面模式校验失败（schema 过 zod 失败，message 带路径） */
  AppPageSchemaInvalid: 50004,
  /** 数据校验失败（字段规则 / 动作步骤失败，事务回滚） */
  AppDataInvalid: 50005,
  /** 导入文件不合规（非 CSV / 超 5MB / 空文件 / 首行无列名） */
  AppImportInvalid: 50006,
  /** 功能页路由冲突（同应用内 route 重复） */
  AppPageRouteConflict: 50007,
  /** 草稿已过期或不存在（confirm 时草稿失效） */
  AppDraftExpired: 50008,
  /** 查询超出护栏（>2s 或非索引过滤 >1 万行） */
  AppQueryGuardExceeded: 50009,
  /** 动作与页面定义不符（action 未在 schema 声明） */
  AppActionMismatch: 50010,
  /** 发布校验未过（P12 R103：无暴露表 / 无公开 display 页 / 公开页数据源未全暴露；message 带缺项清单） */
  AppPublishInvalid: 50012,

  // ========== market 域（50xxx 段续：50013 起，P13 D108/D109） ==========
  /** 该应用已有待审或在架条目（每应用同时仅允许 1 个活跃条目，R121/D108） */
  MarketListingConflict: 50013,
  /** 市场条目不存在或未上架（详情/复制防探测；不暴露未上架条目存在性） */
  MarketListingNotFound: 50014,
  /** 提交内容不合规（演示数据超 100 行/表、快照超限或结构非法；message 带原因） */
  MarketSubmitInvalid: 50015,

  // ========== display 域（50xxx 段续：50016 起，P14 D112/D114） ==========
  /** 展示应用不存在或已删除（后管与开放层统一；开放层经 R125 校验链后仍统一 40400 防探测） */
  DisplayNotFound: 50016,
  /** 授权关系已存在 / 不存在（grant 重复、revoke 无此边） */
  DisplayGrantConflict: 50017,
  /** 展示应用名称冲突（owner 内唯一，D112/R123） */
  DisplayNameConflict: 50018,

  // ========== access 域（50xxx 段续：50019 起，P15 D119~D128 / API-P15 §5） ==========
  /**
   * 凭证缺失 / 无效 / 已吊销 / 已过期（对外四端点）。
   * 刻意与匿名层分治：凭证层用**真实 HTTP 401** + `WWW-Authenticate: Bearer`（外部系统与
   * 下期 MCP 客户端据此发现授权要求），body 统一体 code=50019；应用/资源层失败仍 40400。
   */
  CredentialInvalid: 50019,
  /** 凭证数达上限（每用户 access.maxCredentialsPerUser，默认 20；R130） */
  CredentialQuotaExceeded: 50020,
  /** 授权范围越界（scope 引用未暴露 / 不存在的表或字段；R133，显式报错优于静默收窄） */
  CredentialScopeInvalid: 50021,
} as const

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode]
