import { createHash, randomBytes, randomInt } from 'node:crypto'

/** base62 字母表（keyId 随机段） */
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/** keyId 形态（R130）：`ik_` + 10 位 base62 */
const KEY_ID_PATTERN = /^ik_[0-9A-Za-z]{10}$/

/** secret 长度下限（32 字节 base64url ≈ 43 字符；解析时做粗校验防无意义查询） */
const SECRET_MIN_LENGTH = 20

/**
 * 凭证授权范围（R133 / D125；P17 D136 启用第四纵深 `rowFilter`）。
 *
 * - `tables`：可读的表名清单（创建时禁止为空 → 40001）；
 * - `fields`：`{表名: [字段名…]}`，缺省的表 = 该表全部已暴露字段；
 * - `ops`：本期恒 `['read']`（D119 对外纯只读，字段预留不实现）；
 * - `rowFilter`：`{表名: ["字段:op:值", …]}`，缺省 / null = 不过滤（P17 R147；与 R104 请求 filter 同语法，
 *   每表 ≤3 条、表内 AND）。
 *
 * **只能收窄**：保存时逐项校验 ⊆ 暴露三开关并集（越界 50021，显式报错优于静默收窄）；
 * 运行时再取交集（暴露开关后续收紧时凭证自动跟着收窄，无需改凭证）。
 * rowFilter 为**常量 WHERE 段**，与请求方 filter 并列 AND，游标 / 排序 / 配额口径不受影响（R148）。
 */
export interface CredentialScope {
  tables: string[]
  fields: Record<string, string[]>
  ops: ['read']
  rowFilter: Record<string, string[]> | null
}

/** 管理侧 scope 入参形态（fields / rowFilter 可选、值可不做去重） */
export interface CredentialScopeInput {
  tables: string[]
  fields?: Record<string, string[]>
  rowFilter?: Record<string, string[]> | null
}

/** 签发结果（apiKey 仅在创建 / 轮换响应中出现一次，R130） */
export interface IssuedCredential {
  keyId: string
  secret: string
  secretHash: string
  secretPrefix: string
  /** 完整密钥 `{keyId}.{secret}`——只在创建与轮换响应返回一次 */
  apiKey: string
}

/** 新 keyId：`ik_` + 10 位 base62（定位索引，唯一键 uk_cred_keyid） */
function newKeyId(): string {
  let suffix = ''
  for (let index = 0; index < 10; index += 1) {
    suffix += BASE62[randomInt(0, BASE62.length)]
  }
  return `ik_${suffix}`
}

/** 新 secret：32 字节随机 → base64url（43 字符；高熵随机，无需盐） */
function newSecret(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * secret 摘要（R130）：`sha256(secret)` hex，secret 本身**不落库**。
 *
 * 说明：这里刻意不用 bcrypt —— 凭证校验发生在**每次外部请求**上（高频），bcrypt 的
 * 计算成本不可接受；而 secret 是 256bit 随机串，彩虹表 / 暴力枚举对其无意义，无需加盐。
 */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

/**
 * 签发一套凭证（创建与轮换共用）：定长 secret、sha256 摘要、前缀回显。
 * @param existingKeyId 轮换时传入既有 keyId（**keyId 不变**，审计连续性保持，R131）
 */
export function issueCredential(existingKeyId?: string): IssuedCredential {
  const keyId = existingKeyId ?? newKeyId()
  const secret = newSecret()
  return {
    keyId,
    secret,
    secretHash: hashSecret(secret),
    // 列表 / 详情回显用（可辨识溯源）：secret 前 4 位
    secretPrefix: secret.slice(0, 4),
    apiKey: `${keyId}.${secret}`,
  }
}

/**
 * 解析 `Authorization: Bearer {keyId}.{secret}`（R132 第 1 步）。
 *
 * 形态不符（缺头 / 无 Bearer 前缀 / 无点号 / keyId 非 `ik_` 前缀 / secret 过短）一律返回 null，
 * 由调用方统一 401 + `WWW-Authenticate`——不做任何"存在性"区分（凭证层不泄露资源信息）。
 */
export function parseBearerKey(
  header: string | undefined,
): { keyId: string; secret: string } | null {
  if (!header) return null
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim())
  if (!match) return null
  const raw = match[1]
  const dot = raw.indexOf('.')
  if (dot <= 0) return null
  const keyId = raw.slice(0, dot)
  const secret = raw.slice(dot + 1)
  if (!KEY_ID_PATTERN.test(keyId)) return null
  if (secret.length < SECRET_MIN_LENGTH) return null
  return { keyId, secret }
}

// ==================== OAuth2 access token（P18 T155 / D139/R151） ====================

/** access token 前缀（D139）：`it_` + base64url(32 字节) */
export const ACCESS_TOKEN_PREFIX = 'it_'

/** access token 形态：`it_` + 43 字符 base64url（32 字节定长） */
const ACCESS_TOKEN_PATTERN = /^it_[A-Za-z0-9_-]{43}$/

/**
 * 签发 access token（D139）：32 字节随机 → base64url。
 *
 * **不透明令牌**（无结构、不含凭证信息）：仅作 Redis 查找键，映射回 credentialId；
 * 不用 JWT 是因为 JWT 无吊销能力（要即时失效就得配黑名单，等于回到存储查找，白付复杂度）。
 */
export function issueAccessToken(): string {
  return `${ACCESS_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`
}

/**
 * 令牌摘要（R151）：`sha256(token)` hex —— Redis 只以摘要为键。
 *
 * 令牌与 secret 同等对待：原文不落库、不落日志、不进审计；即便 Redis 快照泄露也无法反推可用令牌。
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/**
 * 从 `Authorization` 头提取 access token（`Bearer it_...`；R153 双形态分派）。
 *
 * 形态不符返回 null，由调用方统一 401——与 `parseBearerKey` 同样不做存在性区分。
 */
export function parseBearerToken(header: string | undefined): string | null {
  if (!header) return null
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim())
  if (!match) return null
  const token = match[1]
  return ACCESS_TOKEN_PATTERN.test(token) ? token : null
}
