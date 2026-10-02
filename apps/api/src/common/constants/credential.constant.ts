/**
 * 接入凭证层对外常量的共享定义（P15 D120/R132）。
 *
 * 放在 `common/` 是因为 gateway 的异常过滤器需要它（横切层只允许依赖 common，铁律 3）——
 * 该常量是**对外协议**的一部分（RFC 6750 形态），不是某个域的内部实现细节。
 */

/** 凭证缺失 / 无效 / 已吊销 / 已过期时的 401 挑战头（外部系统与下期 MCP 客户端据此发现授权要求） */
export const CREDENTIAL_WWW_AUTHENTICATE = 'Bearer realm="iplat-ext", error="invalid_token"'

/** 对外契约版本前缀（D124：v1 冻结，只增不改，破坏性变更开 v2） */
export const EXT_API_PREFIX = 'ext/v1'

/** 对外列表默认页大小（R136；上限沿用 R104 的 size ≤ 50） */
export const EXT_DEFAULT_PAGE_SIZE = 20

/** 凭证行级过滤（`scope.rowFilter`）每表条件条数上限（P17 R147；与 R104 请求 filter ≤3 对齐） */
export const MAX_ROW_FILTER = 3

/**
 * 凭证形态（P18 D141，`acc_credential.type`）：
 * - `api_key`：长期有效，`Bearer {keyId}.{secret}` 直连资源端点（手动配置友好，MCP 客户端推荐）；
 * - `oauth`：`Bearer it_*` 短时效令牌，须先经 `/api/ext/oauth/token` 换发（程序化集成推荐）。
 *
 * **创建后不可更改**（D141）：改形态等于换一套凭据语义，应新建凭证而非原地切换。
 */
export const CREDENTIAL_TYPE_API_KEY = 'api_key'
export const CREDENTIAL_TYPE_OAUTH = 'oauth'

/** 允许的凭证形态清单（创建时校验） */
export const CREDENTIAL_TYPES = [CREDENTIAL_TYPE_API_KEY, CREDENTIAL_TYPE_OAUTH] as const

/** 凭证形态（同 `acc_credential.type` 的取值域） */
export type CredentialType = (typeof CREDENTIAL_TYPES)[number]

/** access token 存活秒数缺省值（`ACCESS_TOKEN_TTL_SECONDS`，P18 R151） */
export const DEFAULT_TOKEN_TTL_SECONDS = 3600
