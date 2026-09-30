# API-P15-增补（对外开放接入层）

> 配套：`PRD-P15-OPEN-ACCESS.md` / `ARCHITECTURE-P15-增补.md`。实施后并入 API.md 新增 **§22**，本文件保留为历史参考；并入后不得改名。
> 本期 **+11 HTTP 端点（管理侧 7 + 对外 4）**、开放层取数 4 端点**改路径**（旧路径退役）、**错误码 +3（50019~~50021）**、AI 工具零新增（43 不变）、零新依赖。
> 通用约定沿用：bigint ID 序列化为字符串；时间为 ISO 字符串；管理侧响应走统一体 `{code,message,data}`。

## 1. 管理侧端点（+7，`/api/access/**`，登录态自服务，无 @RequirePermission，属主隔离）

| #   | 方法与路径                                | 说明                                                                                         | 错误码                                   |
| --- | ----------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------- |
| 1   | `POST /api/access/credentials`            | 创建凭证 `{appCode, name, scope:{tables[], fields?}, expiresAt?}` → 见 §3.1                  | 50001、50018→不适用、40001、50020、50021 |
| 2   | `GET /api/access/credentials`             | 我的凭证列表（含 appCode/应用名、secretPrefix、status、expiresAt、lastUsedAt、当日用量汇总） | —                                        |
| 3   | `GET /api/access/credentials/:id`         | 详情（含 scope 全量；**不含 secret**）                                                       | 50001                                    |
| 4   | `PUT /api/access/credentials/:id`         | 改 `{name?, scope?, expiresAt?}`；scope 校验同创建                                           | 40001、50001、50021                      |
| 5   | `POST /api/access/credentials/:id/revoke` | 吊销（不可逆，立即生效）                                                                     | 50001                                    |
| 6   | `POST /api/access/credentials/:id/rotate` | 轮换 secret：响应一次性返回新 Key（keyId 不变，旧 secret 立即失效）                          | 50001                                    |
| 7   | `GET /api/access/audits`                  | 审计检索：`?credentialId=&from=&to=&resultCode=&pageNo=&pageSize=`（pageSize ≤50）           | 40001                                    |

- 写操作（1/4/5/6）挂 `@OperationLog('接入凭证', xxx)`。
- 凭证校验不缓存：5/6 立即生效，无失效传播问题。

## 2. 对外取数端点（+4，`/api/ext/v1/**`，凭证态）

认证：`Authorization: Bearer {keyId}.{secret}`。**HTTP 状态码语义真实化**：401（凭证）/ 429（配额）/ 200（成功与业务失败——40400/40001 仍走统一体，与平台其余开放面一致）。

| #   | 方法与路径                                                                              | 说明                                                        |
| --- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 8   | `GET /api/ext/v1/app/:appCode/schema`                                                   | 表结构（scope ∩ 暴露三开关投影；含枚举选项与 ref 目标表名） |
| 9   | `GET /api/ext/v1/app/:appCode/tables/:table/records?size=&after=&sort=&filter=&expand=` | 列表（**游标分页**，无 pageNo/offset）                      |
| 10  | `GET /api/ext/v1/app/:appCode/tables/:table/records/:rowId`                             | 详情                                                        |
| 11  | `GET /api/ext/v1/app/:appCode/files/:fileId/stream`                                     | 附件流（R26 MIME；`?download=1` → attachment + 原名）       |

校验链：凭证（401/50019）→ appCode 与凭证 app_id 匹配（否 40400）→ 应用未软删且 `is_public=1`（否 40400）→ 表 ∈ scope ∩ 暴露（否 40400；schema 对越权表不输出、不报错）→ 配额（429/42900）→ 参数（40001）。

## 3. 请求/响应要点

### 3.1 创建凭证（端点 1）响应

```json
{
  "code": 0,
  "data": {
    "id": "12",
    "keyId": "ik_3f9ab2c7d1",
    "apiKey": "ik_3f9ab2c7d1.X7k...", // 完整 Key = keyId.secret，仅此一次
    "secretOnce": true,
    "secretPrefix": "X7k",
    "name": "ERP 对接",
    "appCode": "app(7)",
    "scope": { "tables": ["book"], "fields": {}, "ops": ["read"], "rowFilter": null },
    "expiresAt": null,
    "createdAt": "..."
  }
}
```

此后任何端点不返回完整 Key；列表/详情只给 `keyId + secretPrefix`。轮换（端点 6）响应同构（`apiKey` 为新值，`rotatedAt` 附加）。

### 3.2 对外响应 envelope（v1 冻结，D124/R136）

- schema：`{ "code":0, "data":{ "app":{name,description}, "tables":[{name,label,fields:[…]}] } }`
- 列表：`{ "code":0, "data":[ ...行... ], "paging":{ "nextCursor":"eyJ2Ij…"|null, "size":50 } }`（**无 total**）
- 详情：`{ "code":0, "data":{ ...行... } }`
- 行 = 公开投影白名单（用户逻辑字段名 + rowId/createdAt/updatedAt）；内部列不出域。

### 3.3 游标与排序

- `size` ≤50（默认 20）；`after` = 上一页 `nextCursor`，缺省首页。
- 排序默认 `rowId ASC`；`sort` 至多 2 个白名单字段（`name:asc,name2:desc`），服务端强制追加 `rowId ASC` tiebreaker——**边拉边写不重不漏**。
- cursor 非法/过期语义不合法 → 40001。cursor 内部形态为实现细节（当前 base64url JSON），调用方不得解析。

### 3.4 配额响应头与超限

- 成功响应携带：`X-RateLimit-Remaining-Minute` / `X-RateLimit-Remaining-Day` / `X-RateLimit-Rows-Remaining-Day`。
- 超限：`HTTP 429` + `{ "code":42900, "message":"已超配额", "data":null }` + `Retry-After: <秒>`。

### 3.5 审计检索（端点 7）响应

`{ list: [{ id, principal, appId, endpoint, tableName, paramsSummary, rows, durationMs, ip, resultCode, createdAt }], total, pageNo, pageSize }`；属主隔离（只见自己的凭证与匿名展示应用流水）。

## 4. 开放层取数路径变更（D123/R137）

| 项           | 旧（P14，退役）                                       | 新（本期）                                                        |
| ------------ | ----------------------------------------------------- | ----------------------------------------------------------------- |
| 数据端点     | `GET /api/open/:slug/api/app/:appCode/**`（404 下线） | `GET /api/open/:slug/disp/:id/api/app/:appCode/**`                |
| 校验链       | 站点下任一挂靠展示应用被授权即放行                    | **该 displayId** 挂靠该站点 ∧ `disp_grant(displayId, appId)` 命中 |
| 页面取数写法 | 同源 `/api/open/<slug>/api/app/<appCode>/...`         | 同源相对 `./api/app/<appCode>/...`                                |

错误口径不变：资源类统一 40400；参数 40001；限流 42900（60/分/IP 独立桶，保留）。

## 5. 错误码（+3，50xxx 段续）

| 码    | 常量                      | 含义                              | 场景                                      |
| ----- | ------------------------- | --------------------------------- | ----------------------------------------- |
| 50019 | `CredentialInvalid`       | 凭证缺失/无效/已吊销/已过期       | 对外四端点，HTTP 401 + `WWW-Authenticate` |
| 50020 | `CredentialQuotaExceeded` | 凭证数达上限                      | 管理侧创建                                |
| 50021 | `CredentialScopeInvalid`  | scope 引用未暴露/不存在的表或字段 | 管理侧创建/编辑                           |

复用：40001 / 40400 / 42900 / 50001 / 50009。**50xxx 段用至 50021，下一可用 50022**；30xxx / 40xxx 本期零新增。

## 6. 配置登记（新增 access 组，`src/config/access.config.ts`，env 前缀 `ACCESS_*`）

`access.maxCredentialsPerUser=20` / `access.quotaPerMinute=120` / `access.quotaPerDay=50000` / `access.rowsPerDay=100000` / `access.auditRetentionDays=90` / `access.auditFlushMs=5000`。

## 7. AI 工具与手册

- 工具零新增（43 不变）；`create_display_app` / `authorize_data_app` 的返回文案与站点 README 三模板取数路径同步改为 `./api/app/<appCode>/...`（R124 修订）→ 属工具链变更，**`pnpm smoke:ai` 必跑**（M/O 用例断言口径同步更新）。
- `check:ai` 19/19 不回归；手册如需加「接入凭证」一行，**先腾挪**（合注余量 ≤12 字）。

## 8. 编号登记

| 系列      | 本期使用                                                   | 说明                     |
| --------- | ---------------------------------------------------------- | ------------------------ |
| 决策      | D119~D128（+D129/D130 下期预登记）                         | PRD-P15 §2               |
| 规则      | R130~R141                                                  | PRD-P15 §4               |
| 任务      | T132~T138                                                  | PRD-P15 §5               |
| HTTP 端点 | +11（管理侧 7 + 对外 4）；开放层 4 端点改路径（旧 4 退役） | §1/§2/§4                 |
| 错误码    | +3（50019~50021），下一可用 50022                          | §5                       |
| DB        | +2 表（acc_credential / acc_audit）                        | ARCHITECTURE-P15-增补 §2 |
| AI 工具   | +0（43 不变；文案改动需 smoke:ai）                         | §7                       |
| 新依赖    | +0（MCP SDK 特批属下期）                                   | PRD-P15 D130             |
