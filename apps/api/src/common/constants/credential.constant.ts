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
