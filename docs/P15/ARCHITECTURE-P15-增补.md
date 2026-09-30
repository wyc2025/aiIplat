# ARCHITECTURE-P15-增补（对外开放接入层：access 域）

> 配套：`PRD-P15-OPEN-ACCESS.md`（拍板 D119~~D130 / 规则 R130~~R141 的权威定义在 PRD；本文是落地结构）。
> 实施后并入 ARCHITECTURE.md 新增 **§31**，本文件保留为历史参考；并入后不得改名。

## 1. 新域 access

`apps/api/src/modules/access/`，独立 Nest 模块，**零跨域 import 业务模块**（铁律 6）；表前缀 `acc_`。

```
modules/access/
  access.module.ts
  config:  src/config/access.config.ts（env 前缀 ACCESS_*）
  credential/            # 凭证生命周期（管理侧）
    credential.controller.ts   # /api/access/credentials/**（登录态自服务）
    credential.service.ts      # 生成/校验/吊销/轮换/过期；scope 校验
  ext/                   # 对外取数面（凭证态）
    ext-auth.guard.ts          # Bearer 凭证解析 → request.principal；401 + WWW-Authenticate
    ext-data.controller.ts     # /api/ext/v1/app/:appCode/** 四端点
    ext-contract.service.ts    # 对外 envelope / cursor 编解码 / 字段投影（契约冻结层）
  quota/
    quota.interceptor.ts       # principal 双窗计数（请求数 + 返回行数），429
    quota.service.ts           # Redis 计数器封装
  audit/
    audit.interceptor.ts       # 统一埋点（读 request.principal 与响应摘要）
    audit.service.ts           # 异步缓冲批量落 acc_audit；检索
    access-clean.task.ts       # 90 天清理 cron（@nestjs/schedule，沿用 recycle-clean 模式）
  facade/
    access-facade.service.ts   # AccessFacade：writeAudit(entry)（唯一跨域消费点，供 site 开放层埋点）
    access-facade.module.ts
```

跨域依赖（全经门面，无环）：

- **出向**：`AppFacadeModule`（取数五方法 + `invalidatePublicCache`）、`DisplayFacadeModule`（A 部分主体化判定所在域）。
- **入向**：site 域开放层控制器经 `AccessFacade.writeAudit` 埋匿名层取数审计；app 域**无感知**（AppFacade 不认识凭证，scope 交集在 access 域完成后以过滤参数下传）。

## 2. 数据模型（迁移 `2026xxxxxxxxx_add_access_domain`）

```sql
acc_credential (
  id            BIGINT UNSIGNED PK AI,
  owner_id      BIGINT UNSIGNED NOT NULL,        -- 属主（同 app_def.owner_id 口径）
  app_id        BIGINT UNSIGNED NOT NULL,        -- 一凭证一应用（D126）→ KEY idx_cred_app (app_id)
  name          VARCHAR(64)  NOT NULL,           -- 备注名（属主内不要求唯一）
  key_id        VARCHAR(16)  NOT NULL,           -- 'ik_' + 10 位 base62，定位索引
  secret_hash   CHAR(64)     NOT NULL,           -- sha256(secret) hex；secret 不落库
  secret_prefix VARCHAR(8)   NOT NULL,           -- secret 前 4 位（可辨识溯源，列表回显）
  scope         JSON         NOT NULL,           -- {tables:[], fields:{table:[field]}, ops:['read'], rowFilter:null}
  status        TINYINT      NOT NULL DEFAULT 1, -- 1 active / 0 revoked（吊销不可逆）
  expires_at    DATETIME NULL,                   -- NULL = 不过期；惰性判定
  last_used_at  DATETIME NULL,                   -- 异步更新，允许分钟级延迟
  created_at / updated_at,
  UNIQUE KEY uk_cred_keyid (key_id),
  KEY idx_cred_owner (owner_id, status)
);

acc_audit (
  id             BIGINT UNSIGNED PK AI,
  principal      VARCHAR(40) NOT NULL,           -- 'display:{id}' | 'cred:{id}'
  owner_id       BIGINT UNSIGNED NOT NULL,
  app_id         BIGINT UNSIGNED NULL,           -- 失败链路过早（如应用不匹配）可为空
  endpoint       VARCHAR(32) NOT NULL,           -- schema / records / detail / file
  table_name     VARCHAR(64) NULL,
  params_summary VARCHAR(512) NULL,              -- 查询参数摘要（截断；不含返回内容）
  rows           INT NOT NULL DEFAULT 0,         -- 返回行数
  duration_ms    INT NOT NULL DEFAULT 0,
  ip             VARCHAR(64) NULL,
  result_code    INT NOT NULL,                   -- 0 / 40001 / 40400 / 42900 / 50019 ...
  created_at     DATETIME NOT NULL,
  KEY idx_audit_cred_time (principal, created_at),
  KEY idx_audit_owner_time (owner_id, created_at),
  KEY idx_audit_created (created_at)             -- 90 天清理扫描用
);
```

设计要点：

- **不建 `acc_grant`**：D126 一凭证一应用，授权关系即凭证行本身，scope 内嵌。
- `acc_audit` 是高基数流水表：不设外键、不做 JOIN；索引只服务「按凭证/按属主/按时间」三类查询与清理扫描。
- 凭证校验**不缓存**（R131 吊销即时），每请求一次主键级查询（`uk_cred_keyid`），成本可忽略。

## 3. 凭证校验链（ext-auth.guard，R130/R131/R132-1）

```
Authorization: Bearer {keyId}.{secret}
  │  缺头 / 形态不符（无点号、keyId 非 ik_ 前缀）
  ▼
按 key_id 查行（uk_cred_keyid）
  │  不存在 → 401
  ▼
sha256(secret) === secret_hash            → 否 401
status = 1                                → 吊销 401
expires_at 未过                            → 过期 401
  ▼
request.principal = { type:'credential', credentialId, ownerId, appId, scope }
异步更新 last_used_at（不阻塞响应）
```

401 响应统一：`HTTP 401` + `WWW-Authenticate: Bearer realm="iplat-ext", error="invalid_token"` + 统一体 `{ code: 50019, message, data: null }`。**凭证层用真实 HTTP 状态码，不走「全 200 + 业务码」的匿名层口径**——外部系统与 MCP 客户端（下期）依赖 401 + WWW-Authenticate 发现授权要求；这是与匿名 40400 防探测口径的刻意分治（凭证错误不泄露资源存在性：应用/资源层失败仍 40400）。

## 4. 对外契约层（ext-contract.service，R136/R137-对外侧）

**契约冻结层独立成服务**：对外端点不直接透传 AppFacade 返回值，统一经契约层改写——内部形状变更不漂移到 v1。

- `schema` → `{ data: { app: {name, description}, tables: [...] } }`（表/字段已按 scope ∩ 暴露开关投影）；
- `records` 列表 → `{ data: [...], paging: { nextCursor, size } }`；**无 total**（全量拉取场景 total 既贵又会随写入漂移；前端管理面用管理侧接口拿 total）；
- `records/:rowId` → `{ data: {...} }`；`files/:f/stream` → 流式（R26 MIME，`?download=1` 同开放层语义）。
- **cursor**：`base64url(JSON({v:1, sort, last: [tiebreaker 值…]}))`，默认排序 `rowId ASC`；`sort` 参数白名单（仅 scope ∩ 暴露内字段、≤2 个沿用 R104）且服务端强制追加 `rowId` tiebreaker。游标非法 → 40001。**无 pageNo/offset 参数**。
- 参数名冻结：`size` / `after` / `sort` / `filter` / `expand`（filter/expand 语法沿用 R104 固定口径；filter ≤3、expand ≤1、size ≤50）。
- 行字段名 = `app_field.name`（用户逻辑名）；`rowId/createdAt/updatedAt` 沿用公开投影白名单；内部列（r_cN、app_id 等）不出域。

## 5. 配额与审计横切（R134/R135/R141）

- **quota.interceptor**（仅挂 ext-data.controller）：请求进入时预检 `req/min` 与 `req/day`（INCR + 首写 EXPIRE）；响应完成后按返回行数 INCRBY `rows/day`——行数是响应后记账，**先放行后扣账**（无法预知行数；单日超额幅度 ≤ 一次 50 行，可接受，写入口径避免实现层误以为预检含行数）。超限 → HTTP 429 + `code=42900` + `Retry-After`（秒，按窗口重置点算）。
- **audit.interceptor**（挂 ext-data.controller + 供 AccessFacade 复用同一 AuditService）：从 `request.principal`、路由元数据、响应行数、耗时组装审计条目，推入内存缓冲；AuditService 每 5s 或满 100 条批量 `createMany`；`onApplicationShutdown` drain；写库失败 `Logger.error` 不阻断。
- **匿名层埋点**：open 域数据控制器在响应出口调 `AccessFacade.writeAudit({principal: 'display:{id}', ...})`——site 域对 access 域的唯一依赖，走门面（铁律 3）。
- Redis Key（登记 §9 Redis Key 表）：
  - `acc:quota:req:{credentialId}:m:{yyyyMMddHHmm}` TTL 120s
  - `acc:quota:req:{credentialId}:d:{yyyyMMdd}` TTL 48h
  - `acc:quota:rows:{credentialId}:d:{yyyyMMdd}` TTL 48h
  - 审计不落 Redis（内存缓冲即可，进程崩溃损失 ≤5s 流水，登记为可接受口径）。

## 6. 开放层路径收窄与主体化（R137/R138；site 域 + display 域改动）

**路由布局（site/open/）**：

| 控制器                         | 路由                                                      | 变化                                                       |
| ------------------------------ | --------------------------------------------------------- | ---------------------------------------------------------- |
| open-app-data.controller.ts    | `GET /api/open/:slug/disp/:id/api/app/:appCode/**` 四端点 | **改造**（原 `:slug/api/app/:appCode/**` 加 displayId 段） |
| open-static.controller.ts      | `GET /api/open/:slug/disp/:id/**`                         | 加 `api/` 子前缀排除（命中即 40400，不进文件解析）         |
| 旧 `:slug/api/app/:appCode/**` | —                                                         | **控制器移除，访问 404**（照 §30.5 退役先例）              |

**声明顺序**：open-app-data（disp 数据）→ open-static 的 `disp/:id/**` → 站点静态通配 `:slug/*path`（§30.3 教训；注册顺序 + 静态排除双保险，端到端断言「数据路径不得被吞成首页 200」）。

**校验链（R125 修订版）**：站点解析（slug → 站点，缓存沿用）→ `DisplayFacade.resolveForOpen(displayId)`（存在、未软删、`site_id` = 该站点）→ `DisplayFacade.assertCanRead(appId, {type:'display', displayId})`（`disp_grant` 命中）→ `is_public=1` → 暴露三开关。任一失败 40400；参数 40001；限流 42900（匿名层 60/分/IP 保留）。

**主体化签名**：`DisplayFacade.assertCanRead(appId: bigint, principal: {type:'display',displayId} | {type:'credential',credentialId,appId,scope})`——display 分支查 `disp_grant`；credential 分支本期由 access 域自行完成（R132 第 2~4 步），不进 DisplayFacade（凭证判定不需要 disp_grant）。签名预留多主体，是 D128 下期 MCP 复用的挂点。

**生成规范修订（R124 改）**：AI 生成展示应用页面时取数用**同源相对路径** `./api/app/<appCode>/...`（页面在 `disp/{id}/` 下）；站点 README 三模板「数据应用取数」节同步重写；`create_display_app` / `authorize_data_app` 返回的 `urlPreview` / nextSteps 文案同步（工具链改动 → `pnpm smoke:ai` 必跑，M/O 用例口径更新）。

**存量迁移**：P14（2026-09-30 交付）与本期间隔极短，存量已生成展示页面极少；按「预期破坏窗口」处理——发布说明明示重新生成/手改取数路径；不做自动迁移（页面是用户内容，改写风险自负原则不适用——不动用户文件是更优纪律）。

## 7. 配置组（`src/config/access.config.ts`，env 前缀 `ACCESS_*`）

| 键                             | 默认     | 说明                |
| ------------------------------ | -------- | ------------------- |
| `access.maxCredentialsPerUser` | `20`     | 超限 50020          |
| `access.quotaPerMinute`        | `120`    | 每凭证请求数/分     |
| `access.quotaPerDay`           | `50000`  | 每凭证请求数/日     |
| `access.rowsPerDay`            | `100000` | 每凭证返回行数/日   |
| `access.auditRetentionDays`    | `90`     | acc_audit 清理窗口  |
| `access.auditFlushMs`          | `5000`   | 审计缓冲 flush 间隔 |

## 8. 错误码（50xxx 段续，本期 +3）

| 码    | 含义                                              | 场景                                                           |
| ----- | ------------------------------------------------- | -------------------------------------------------------------- |
| 50019 | 凭证缺失/无效/已吊销/已过期                       | 对外四端点（**HTTP 401** + WWW-Authenticate；body code=50019） |
| 50020 | 凭证数达上限                                      | 管理侧创建                                                     |
| 50021 | 授权范围越界（scope 引用未暴露/不存在的表或字段） | 管理侧创建/编辑 scope                                          |

复用：40001（参数）/ 40400（资源不可见，对外不区分原因）/ 42900（配额，对外 HTTP 429）/ 50001（属主/应用不存在，管理侧）/ 50009（内存护栏，沿用）。**50xxx 段用至 50021，下一可用 50022**。

## 9. 演进预留（本期不做，架构不堵路）

1. **MCP 适配器（下期，D129/D130）**：`access/mcp/` 加协议适配器 + 复用 ExtAuthGuard/Quota/Audit——本期 principal 模型与横切层即为复用点；SDK `@modelcontextprotocol/sdk` 特批已授予、届时引入。
2. **OAuth2 client_credentials**：`acc_credential.type` 列预留（默认 `api_key`）。
3. **行级 `rowFilter`**：scope JSON 已留键；实现时需求值器白名单（防注入），单独立项。
4. **轮换双活窗口**：v1 轮换即时生效；双活需第二有效 secret 槽，届时加列。
5. **多应用凭证**：若 D126 将来放宽为一对多，拆 scope 出 `acc_grant` 表即可，凭证行不动。

## 10. 资产表登记（实施后并入 §9）

`AccessFacade.writeAudit` / `access-clean.task` / `quota.interceptor`（principal 配额）/ `ext-contract.service`（对外契约层）/ 游标编解码工具。
