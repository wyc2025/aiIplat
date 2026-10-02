import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma, type AccCredential } from '@prisma/client'
import { ErrorCode } from '../../../common/constants/error-code'
import {
  CREDENTIAL_TYPE_API_KEY,
  CREDENTIAL_TYPES,
  MAX_ROW_FILTER,
  type CredentialType,
} from '../../../common/constants/credential.constant'
import { BusinessException } from '../../../common/exceptions/business.exception'
import {
  coerceFilterValue,
  parseFilterRaw,
  supportsContains,
} from '../../../common/utils/query-filter.util'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import { AppFacade } from '../../app/facade/app-facade.service'
import { QuotaService } from '../quota/quota.service'
import {
  hashSecret,
  issueCredential,
  type CredentialScope,
  type CredentialScopeInput,
} from './credential.util'
import type { CreateCredentialDto, UpdateCredentialDto } from './dto/credential.dto'
import { TokenStore } from './token-store'

/** 凭证状态：1 active / 0 revoked（吊销不可逆，R131） */
export const CREDENTIAL_STATUS_ACTIVE = 1

/** 应用摘要（凭证出域回填用；经 AppFacade 取，不直读 app_def） */
interface AppBrief {
  code: string
  name: string
}

/** 凭证视图（管理侧出域形态；**secret 永不出域**，只给 keyId + secretPrefix） */
export interface CredentialView {
  id: string
  keyId: string
  secretPrefix: string
  name: string
  appCode: string
  appName: string
  scope: CredentialScope
  /** 凭证形态（P18 D141）：`api_key` 直连资源端点 / `oauth` 换短时效令牌；创建后不可改 */
  type: CredentialType
  /** 1 active / 0 revoked */
  status: number
  expiresAt: Date | null
  lastUsedAt: Date | null
  createdAt: Date
}

/** 列表项（视图 + 当日用量汇总，API-P15 §1-2） */
export interface CredentialListItem extends CredentialView {
  usageToday: { requests: number; rows: number }
}

/** 创建 / 轮换响应（`apiKey` 仅此一次；`secretOnce` 供前端醒目提示，R130） */
export interface CredentialIssued extends CredentialView {
  apiKey: string
  secretOnce: true
  /** 仅轮换响应带（前端提示「旧密钥已立即失效」） */
  rotatedAt?: Date
}

/** 凭证主体（ext-auth.guard 解析结果，R132 第 1 步；对外取数链后续步骤消费） */
export interface CredentialPrincipal {
  type: 'credential'
  credentialId: bigint
  ownerId: bigint
  appId: bigint
  scope: CredentialScope
}

/**
 * 接入凭证服务（P15 T134 / R130~R133）。
 *
 * 职责：凭证生命周期（创建 / 列表 / 详情 / 编辑 / 吊销 / 轮换）与**校验链第 1 步**（`verify`）。
 * 跨域纪律（铁律 3/6）：应用信息一律经 `AppFacade` 取（属主校验单点在 app 域内），
 * 本域不 import app 域内部实现、不直读 `app_def` / `app_table` / `app_field`。
 *
 * 凭证校验**不缓存**（R131）：每次实查 `uk_cred_keyid` 主键级 → 吊销 / 轮换**立即生效**，
 * 无失效传播问题；代价由调用频次上限（配额，T136）兜住。
 */
@Injectable()
export class CredentialService {
  private readonly logger = new Logger(CredentialService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly appFacade: AppFacade,
    private readonly quota: QuotaService,
    private readonly tokens: TokenStore,
  ) {}

  // ==================== 管理侧（R131：登录态 + 属主自服务） ====================

  /**
   * 创建凭证（R131）：选自己名下未软删的应用 + scope 子集 + 可选过期时间 + 备注名。
   * `apiKey` 仅本次响应返回一次（R130）；scope 越界 50021；凭证数超上限 50020。
   */
  async create(userId: bigint, dto: CreateCredentialDto): Promise<CredentialIssued> {
    // ① 应用校验（属主 + 未软删）并取暴露清单（scope 只能收窄暴露三开关并集）
    const app = await this.appFacade.exposedSchemaOf(userId, dto.appCode)
    // ② 凭证数上限（按 active 计：吊销后释放槽位）
    const limit = this.config.get<number>('access.maxCredentialsPerUser', 20)
    const used = await this.prisma.accCredential.count({
      where: { ownerId: userId, status: CREDENTIAL_STATUS_ACTIVE },
    })
    if (used >= limit) {
      throw new BusinessException(
        ErrorCode.CredentialQuotaExceeded,
        `凭证数量已达上限（${limit} 个），请先吊销不再使用的凭证`,
      )
    }
    // ③ scope 校验（越界 50021）
    const scope = this.buildScope(dto.scope, app.tables)
    // ④ 凭证形态（P18 D141）：缺省 api_key；创建后不可改，故只在此处校验一次
    const type = this.resolveType(dto.type)
    // ⑤ 签发 + 落库（keyId 唯一冲突自动换号重试，见 insertCredential）
    const { row, apiKey } = await this.insertCredential({
      ownerId: userId,
      appId: BigInt(app.appId),
      name: dto.name.trim(),
      scope: scope as unknown as Prisma.InputJsonValue,
      type,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
    })
    return {
      ...this.toView(row, { code: app.appCode, name: app.name }),
      apiKey,
      secretOnce: true,
    }
  }

  /** 我的凭证列表（含应用 code / 名称回填与当日用量；不回显 secret） */
  async list(userId: bigint): Promise<CredentialListItem[]> {
    const rows = await this.prisma.accCredential.findMany({
      where: { ownerId: userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })
    if (rows.length === 0) return []
    const apps = await this.appFacade.appBriefByIds(userId, [
      ...new Set(rows.map((row) => row.appId)),
    ])
    const byId = new Map(apps.map((app) => [app.id, app]))
    return Promise.all(
      rows.map(async (row) => ({
        ...this.toView(row, byId.get(row.appId.toString())),
        usageToday: await this.quota.usageToday(row.id),
      })),
    )
  }

  /** 凭证详情（含 scope 全量；不含 secret） */
  async detail(userId: bigint, id: bigint): Promise<CredentialView> {
    const row = await this.requireOwned(userId, id)
    return this.toView(row, await this.appBriefOf(userId, row.appId))
  }

  /** 编辑（备注名 / scope / 过期时间；密钥不可改——改密钥请走轮换） */
  async update(userId: bigint, id: bigint, dto: UpdateCredentialDto): Promise<CredentialView> {
    // 凭证形态创建后不可更改（P18 D141）：DTO 显式接收 type 只为给出明确错误
    // （否则被全局 ValidationPipe 的 whitelist 静默剥离，用户以为改成功了）
    if (dto.type !== undefined) {
      throw new BusinessException(
        ErrorCode.ParamInvalid,
        '凭证类型创建后不可更改（如需更换请新建凭证）',
      )
    }
    const row = await this.requireOwned(userId, id)
    const data: Prisma.AccCredentialUncheckedUpdateInput = {}
    if (dto.name !== undefined) data.name = dto.name.trim()
    if (dto.expiresAt !== undefined) {
      data.expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null
    }
    if (dto.scope !== undefined) {
      const brief = await this.appBriefOf(userId, row.appId)
      if (!brief) {
        throw new BusinessException(ErrorCode.AppNotFound, '凭证绑定的应用已删除，无法校验授权范围')
      }
      const app = await this.appFacade.exposedSchemaOf(userId, brief.code)
      data.scope = this.buildScope(dto.scope, app.tables) as unknown as Prisma.InputJsonValue
    }
    const updated = await this.prisma.accCredential.update({ where: { id: row.id }, data })
    return this.toView(updated, await this.appBriefOf(userId, row.appId))
  }

  /** 吊销（不可逆，立即生效：校验不缓存，R131）；已签发令牌一并即时失效（P18 R154） */
  async revoke(userId: bigint, id: bigint): Promise<{ ok: true; id: string }> {
    const row = await this.requireOwned(userId, id)
    await this.prisma.accCredential.update({ where: { id: row.id }, data: { status: 0 } })
    await this.tokens.revokeAll(row.id)
    return { ok: true, id: row.id.toString() }
  }

  /**
   * 轮换密钥（R131）：生成新 secret，**旧 secret 立即失效**（v1 无双活窗口，双活记演进预留）；
   * `keyId` 不变 → 审计连续性保持。已吊销凭证不可轮换。
   */
  async rotate(userId: bigint, id: bigint): Promise<CredentialIssued> {
    const row = await this.requireOwned(userId, id)
    if (row.status !== CREDENTIAL_STATUS_ACTIVE) {
      throw new BusinessException(ErrorCode.ParamInvalid, '凭证已吊销，无法轮换（请新建凭证）')
    }
    const issued = issueCredential(row.keyId)
    const updated = await this.prisma.accCredential.update({
      where: { id: row.id },
      data: { secretHash: issued.secretHash, secretPrefix: issued.secretPrefix },
    })
    // 旧 secret 立即失效 → 已签发令牌同步级联失效（P18 R154：不等 TTL）
    await this.tokens.revokeAll(row.id)
    return {
      ...this.toView(updated, await this.appBriefOf(userId, row.appId)),
      apiKey: issued.apiKey,
      secretOnce: true,
      rotatedAt: new Date(),
    }
  }

  // ==================== 对外校验（T135 守卫消费；R132 第 1 步） ====================

  /**
   * 资源端点的凭证校验（R130/R131；P18 D141 加形态准入）：keyId 不存在 / 摘要不匹配 / 已吊销 /
   * 已过期 / **非 api_key 形态** → `null`。
   *
   * 刻意不区分失败原因——调用方（ext 守卫）统一 401 + `WWW-Authenticate`，不泄露任何存在性差异；
   * 不缓存（每次实查主键索引），保证吊销 / 轮换即时生效。
   *
   * `oauth` 型凭证的 secret 不得直连资源端点（须先经 `/api/ext/oauth/token` 换发令牌）——
   * 否则「短时效令牌」的语义可以被绕过（长期 secret 直接当钥匙用）。
   */
  async verify(keyId: string, secret: string): Promise<CredentialPrincipal | null> {
    const row = await this.loadVerified(keyId, secret)
    if (!row || row.type !== CREDENTIAL_TYPE_API_KEY) return null
    return this.toPrincipal(row)
  }

  /**
   * 令牌端点专用校验（P18 D141/R152）：**不限形态**——任何有效凭证都可换 access token。
   *
   * 放宽的理由是迁移路径：存量 api_key 型凭证可渐进改用 OAuth 流程；资源端点仍只认
   * api_key 直连，故语义边界依然清晰（形态差异只体现在「能不能直接当 Bearer 用」）。
   */
  async verifyForToken(keyId: string, secret: string): Promise<CredentialPrincipal | null> {
    const row = await this.loadVerified(keyId, secret)
    return row ? this.toPrincipal(row) : null
  }

  /**
   * 主体解析（P18 R153；令牌路径用）：按凭证 id 实查凭证行并**重新校验有效性**。
   *
   * 令牌命中 Redis 后仍走这一步，是「scope / 吊销 / 到期即时生效」的实现方式：
   * 不逐令牌传播失效，而是让授权事实每次都回凭证行取；此处不校验 `type`
   * （令牌本就由 oauth 语义承载，且形态创建后不可改）。
   */
  async principalOf(credentialId: bigint): Promise<CredentialPrincipal | null> {
    const row = await this.prisma.accCredential.findUnique({ where: { id: credentialId } })
    if (!row) return null
    if (row.status !== CREDENTIAL_STATUS_ACTIVE) return null
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null
    return this.toPrincipal(row)
  }

  /** 凭证校验公共段：存在 + 摘要匹配 + 未吊销 + 未过期（实查不入缓存 → 变更即时生效） */
  private async loadVerified(keyId: string, secret: string): Promise<AccCredential | null> {
    const row = await this.prisma.accCredential.findUnique({ where: { keyId } })
    if (!row) return null
    if (row.secretHash !== hashSecret(secret)) return null
    if (row.status !== CREDENTIAL_STATUS_ACTIVE) return null
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null
    return row
  }

  /**
   * 凭证行 → 取数主体（R153）：令牌与 API Key 两条路径产出的**主体完全同构**，
   * 故下游（配额 / 审计 / scope / rowFilter / MCP 工具链）零感知、零改动。
   */
  private toPrincipal(row: AccCredential): CredentialPrincipal {
    return {
      type: 'credential',
      credentialId: row.id,
      ownerId: row.ownerId,
      appId: row.appId,
      scope: row.scope as unknown as CredentialScope,
    }
  }

  /** 凭证形态归一（P18 D141）：缺省 api_key；非法值 40001 */
  private resolveType(input?: string): CredentialType {
    if (input === undefined || input === '') return CREDENTIAL_TYPE_API_KEY
    if (!(CREDENTIAL_TYPES as readonly string[]).includes(input)) {
      throw new BusinessException(
        ErrorCode.ParamInvalid,
        `凭证类型仅支持 ${CREDENTIAL_TYPES.join(' / ')}`,
      )
    }
    return input as CredentialType
  }

  /** 命中后异步更新 `lastUsedAt`（不阻塞响应；失败只记日志，R130） */
  async touchLastUsed(id: bigint): Promise<void> {
    void this.prisma.accCredential
      .update({ where: { id }, data: { lastUsedAt: new Date() } })
      .catch((error: unknown) => this.logger.warn(`更新凭证 lastUsedAt 失败：${String(error)}`))
  }

  // ==================== 内部 ====================

  /**
   * 签发并落库（返回「凭证行 + 一次性 apiKey」，R130）。
   *
   * **keyId 冲突处理（P15 走查 C1）**：`ik_` keyId 为 16 字节 base62（≈62^16 空间），唯一冲突
   * 概率理论不可达；但 `uk_cred_keyid` 是硬约束，且验收 #1 明确要求「重复 keyId 冲突提示」——
   * 与其在不可达分支抛 50000「服务器内部错误」，此处**换新 keyId 自动重试一次**，
   * 重试仍冲突才抛原始错误（用户侧看不到任何冲突痕迹，且不留「冲突提示文案」这种
   * 只能靠人工构造才能验到的死分支）。
   */
  private async insertCredential(
    base: Omit<Prisma.AccCredentialUncheckedCreateInput, 'keyId' | 'secretHash' | 'secretPrefix'>,
  ): Promise<{ row: AccCredential; apiKey: string }> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const issued = issueCredential()
      try {
        const row = await this.prisma.accCredential.create({
          data: {
            ...base,
            keyId: issued.keyId,
            secretHash: issued.secretHash,
            secretPrefix: issued.secretPrefix,
          },
        })
        return { row, apiKey: issued.apiKey }
      } catch (error) {
        if (!this.isKeyIdConflict(error) || attempt === 1) throw error
        this.logger.warn('凭证 keyId 冲突（理论不可达），已换新 keyId 重试')
      }
    }
    // 理论不可达（两次签发同一 keyId）
    throw new BusinessException(ErrorCode.InternalError, '凭证创建失败，请重试')
  }

  /** 是否命中 `uk_cred_keyid` 唯一约束冲突（Prisma P2002） */
  private isKeyIdConflict(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
  }

  /** 属主校验（非属主 / 不存在一律 50001，不暴露他人凭证存在性） */
  private async requireOwned(userId: bigint, id: bigint): Promise<AccCredential> {
    const row = await this.prisma.accCredential.findFirst({ where: { id, ownerId: userId } })
    if (!row) {
      throw new BusinessException(ErrorCode.AppNotFound, '凭证不存在或无权')
    }
    return row
  }

  /** 应用摘要（已软删应用返回 undefined，由 toView 兜底为「（应用已删除）」） */
  private async appBriefOf(userId: bigint, appId: bigint): Promise<AppBrief | undefined> {
    const apps = await this.appFacade.appBriefByIds(userId, [appId])
    return apps.find((app) => app.id === appId.toString())
  }

  /**
   * scope 构建与校验（R133 / D125）：只能**收窄**暴露三开关并集，越界显式 50021。
   *
   * - `tables` 每项必须是已暴露表（不存在 / 未暴露 → 50021）；
   * - `fields` 的键必须 ∈ `tables`，值必须是该表**已暴露**字段（越界 → 50021）；
   * - `ops` 固定 `['read']`（D119），`rowFilter` 列预留（本期为 null）。
   */
  private buildScope(input: CredentialScopeInput, exposedTables: ExposedTable[]): CredentialScope {
    const exposed = new Map(exposedTables.map((table) => [table.name, table]))
    const tables: string[] = []
    const fields: Record<string, string[]> = {}

    for (const tableName of input.tables) {
      const table = exposed.get(tableName)
      if (!table) {
        throw new BusinessException(
          ErrorCode.CredentialScopeInvalid,
          `表「${tableName}」不存在或未暴露（scope 只能收窄暴露范围）`,
        )
      }
      if (!tables.includes(tableName)) tables.push(tableName)

      const picked = input.fields?.[tableName]
      if (picked === undefined) continue
      if (!Array.isArray(picked) || picked.some((field) => typeof field !== 'string')) {
        throw new BusinessException(
          ErrorCode.ParamInvalid,
          `scope.fields.${tableName} 必须是字段名数组`,
        )
      }
      const exposedFields = new Set(table.fields.map((field) => field.name))
      const invalid = picked.filter((field) => !exposedFields.has(field))
      if (invalid.length > 0) {
        throw new BusinessException(
          ErrorCode.CredentialScopeInvalid,
          `表「${tableName}」以下字段未暴露或不存在：${invalid.join('、')}`,
        )
      }
      fields[tableName] = [...new Set(picked)]
    }

    for (const key of Object.keys(input.fields ?? {})) {
      if (!tables.includes(key)) {
        throw new BusinessException(
          ErrorCode.CredentialScopeInvalid,
          `scope.fields 中的表「${key}」不在 scope.tables 内`,
        )
      }
    }

    return {
      tables,
      fields,
      ops: ['read'],
      // P17 R147：行级过滤（第四纵深）——表 ∈ tables、字段 ∈ 该表 scope 字段口径且在暴露开关内
      rowFilter: this.buildRowFilter(input.rowFilter, tables, exposed, fields),
    }
  }

  /**
   * rowFilter 构建与校验（P17 R147）。
   *
   * 语法 / 算子 / 值类型复用 R104 请求 filter 的**同一解析器**（`common/utils/query-filter.util`），
   * 本方法只补 scope 语义：表 ∈ `scope.tables`、字段 ∈ 该表 scope 字段口径（`fields` 未配 = 全部已暴露字段）
   * 且在暴露开关内。任一违例 → **50021**，errmsg 指明条目（表 + 条目 + 原因）。
   *
   * @returns 归一后的条件表；未配 / 空对象 → `null`（不过滤，现行行为）
   */
  private buildRowFilter(
    input: CredentialScopeInput['rowFilter'],
    tables: string[],
    exposed: Map<string, ExposedTable>,
    fields: Record<string, string[]>,
  ): Record<string, string[]> | null {
    if (input === undefined || input === null) return null
    if (typeof input !== 'object' || Array.isArray(input)) {
      throw new BusinessException(
        ErrorCode.CredentialScopeInvalid,
        'scope.rowFilter 需为「表名 → 条件数组」对象，如 {"book": ["status:eq:published"]}',
      )
    }
    const result: Record<string, string[]> = {}
    for (const [tableName, conditions] of Object.entries(input)) {
      if (!tables.includes(tableName)) {
        throw new BusinessException(
          ErrorCode.CredentialScopeInvalid,
          `scope.rowFilter 中的表「${tableName}」不在 scope.tables 内`,
        )
      }
      if (!Array.isArray(conditions) || conditions.some((item) => typeof item !== 'string')) {
        throw new BusinessException(
          ErrorCode.CredentialScopeInvalid,
          `scope.rowFilter.${tableName} 需为条件串数组，如 ["status:eq:published"]`,
        )
      }
      if (conditions.length === 0 || conditions.length > MAX_ROW_FILTER) {
        throw new BusinessException(
          ErrorCode.CredentialScopeInvalid,
          `scope.rowFilter.${tableName} 需为 1~${MAX_ROW_FILTER} 条条件（多条为「且」的关系）`,
        )
      }
      const exposedFields = new Map(
        (exposed.get(tableName)?.fields ?? []).map((field) => [field.name, field.type]),
      )
      const scopedFields = fields[tableName]
      for (const raw of conditions) {
        // ① 形态 / 算子合法性（R104 同一解析器）
        const parsed = parseFilterRaw(raw)
        if (!parsed.ok) this.rowFilterInvalid(tableName, raw, parsed.error)
        const { field, op, value } = parsed.value
        // ② 字段须在该表 scope 字段口径内（`fields` 未配该表 = 全部已暴露字段）
        if (scopedFields && !scopedFields.includes(field)) {
          this.rowFilterInvalid(tableName, raw, `字段「${field}」不在该表授权字段范围内`)
        }
        // ③ 字段须存在且已暴露（禁止用不可见字段做存在性探测）
        const type = exposedFields.get(field)
        if (!exposedFields.has(field)) {
          this.rowFilterInvalid(tableName, raw, `字段「${field}」不存在或未暴露`)
        }
        if (op === 'contains' && !supportsContains(type)) {
          this.rowFilterInvalid(tableName, raw, `contains 仅支持文本/枚举字段：${field}`)
        }
        // ④ 值须能按字段定义解析
        const coerced = coerceFilterValue(type, value)
        if (!coerced.ok) this.rowFilterInvalid(tableName, raw, coerced.error)
      }
      result[tableName] = [...conditions]
    }
    return Object.keys(result).length > 0 ? result : null
  }

  /** rowFilter 条目违例统一报错（50021，errmsg 定位到「表 + 条目 + 原因」） */
  private rowFilterInvalid(table: string, raw: string, reason: string): never {
    throw new BusinessException(
      ErrorCode.CredentialScopeInvalid,
      `scope.rowFilter.${table} 条目「${raw}」：${reason}`,
    )
  }

  /** 出域视图（bigint → string；secret 绝不出现） */
  private toView(row: AccCredential, app?: AppBrief): CredentialView {
    return {
      id: row.id.toString(),
      keyId: row.keyId,
      secretPrefix: row.secretPrefix,
      name: row.name,
      appCode: app?.code ?? '',
      appName: app?.name ?? '（应用已删除）',
      scope: row.scope as unknown as CredentialScope,
      type: (row.type as CredentialType) ?? CREDENTIAL_TYPE_API_KEY,
      status: row.status,
      expiresAt: row.expiresAt,
      lastUsedAt: row.lastUsedAt,
      createdAt: row.createdAt,
    }
  }
}

/** 暴露清单表项（AppFacade.exposedSchemaOf 返回形态） */
interface ExposedTable {
  name: string
  label: string
  /** `type` 供 rowFilter 值类型校验（P17 R147；与 app 域 `exposedSchema` 的暴露口径一致） */
  fields: Array<{ name: string; label: string; type: string }>
}
