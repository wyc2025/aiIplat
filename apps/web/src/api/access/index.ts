import { get, post, put } from '@/utils/request'

/**
 * 接入凭证 API 客户端（P15 T137，API-P15 §1）。
 *
 * 凭证 = 外部系统经 `/api/ext/v1` 只读取数的身份（D120/D126）：**一凭证一应用**，`scope` 限定
 * 可读表与字段（只能收窄暴露范围）。`secret` 仅在**创建 / 轮换**响应出现一次，此后任何接口不回显。
 */

/**
 * 凭证类型（P18 D141）：`api_key` 长期有效、可直接当密钥用；`oauth` 先换短时效令牌再用。
 * **创建后不可更改**。
 */
export type CredentialType = 'api_key' | 'oauth'

/** 凭证授权范围（R133/D125 + P17 D136）：表 + 可选字段 + 可选行过滤（缺省表 = 该表全部已暴露字段） */
export interface CredentialScope {
  tables: string[]
  fields: Record<string, string[]>
  ops: ['read']
  /** 行级过滤 `{表名: ["字段:op:值", …]}`（P17 第四纵深）；null = 不过滤 */
  rowFilter: Record<string, string[]> | null
}

/** 凭证视图（管理侧；**不含 secret**，只有 keyId 与 secret 前缀） */
export interface CredentialItem {
  id: string
  keyId: string
  secretPrefix: string
  name: string
  appCode: string
  appName: string
  scope: CredentialScope
  /** 凭证类型（P18；创建后不可更改） */
  type: CredentialType
  /** 1 = 有效 / 0 = 已吊销（吊销不可逆） */
  status: number
  expiresAt: string | null
  lastUsedAt: string | null
  createdAt: string
  /** 当日用量汇总（仅列表返回） */
  usageToday?: { requests: number; rows: number }
}

/** 创建 / 轮换响应（`apiKey` 仅本次返回一次） */
export interface CredentialIssued extends CredentialItem {
  apiKey: string
  secretOnce: true
  /** 仅轮换响应带（提示「旧密钥已立即失效」） */
  rotatedAt?: string
}

/** scope 入参（创建 / 编辑共用） */
export interface CredentialScopeInput {
  tables: string[]
  fields?: Record<string, string[]>
  /** 行级过滤（P17）；缺省 = 不过滤 */
  rowFilter?: Record<string, string[]> | null
}

/** 审计条目（acc_audit 出域形态） */
export interface AuditItem {
  id: string
  /** `cred:{id}`（凭证取数）| `display:{id}`（站点展示页取数） */
  principal: string
  appId: string | null
  /** schema / records / detail / file */
  endpoint: string
  tableName: string | null
  paramsSummary: string | null
  rows: number
  durationMs: number
  ip: string | null
  /** 0 / 40001 / 40400 / 42900 / 50019 … */
  resultCode: number
  createdAt: string
}

/** 审计检索分页结果 */
export interface AuditPage {
  list: AuditItem[]
  total: number
  pageNo: number
  pageSize: number
}

/** 我的凭证列表（含应用 code / 名称回填与当日用量） */
export const listCredentials = () => get<CredentialItem[]>('/access/credentials')

/** 创建凭证（`apiKey` 仅本次响应返回一次；scope 越界 50021；超上限 50020；类型缺省 api_key） */
export const createCredential = (payload: {
  appCode: string
  name: string
  scope: CredentialScopeInput
  type?: CredentialType
  expiresAt?: string
}) => post<CredentialIssued>('/access/credentials', payload)

/** 凭证详情（含 scope 全量） */
export const getCredential = (id: string) => get<CredentialItem>(`/access/credentials/${id}`)

/** 编辑（备注名 / scope / 过期时间；密钥不可改——改密钥走轮换） */
export const updateCredential = (
  id: string,
  payload: { name?: string; scope?: CredentialScopeInput; expiresAt?: string | null },
) => put<CredentialItem>(`/access/credentials/${id}`, payload)

/** 吊销（不可逆；校验不缓存 → 立即生效） */
export const revokeCredential = (id: string) =>
  post<{ ok: true; id: string }>(`/access/credentials/${id}/revoke`, {})

/** 轮换密钥（新 `apiKey` 仅本次返回；旧 secret 立即失效，keyId 不变） */
export const rotateCredential = (id: string) =>
  post<CredentialIssued>(`/access/credentials/${id}/rotate`, {})

/** 审计检索（属主隔离：只见自己的凭证流水与展示应用流水；pageSize ≤50） */
export const listAudits = (params: {
  credentialId?: string
  from?: string
  to?: string
  resultCode?: number
  pageNo?: number
  pageSize?: number
}) => get<AuditPage>('/access/audits', params)
