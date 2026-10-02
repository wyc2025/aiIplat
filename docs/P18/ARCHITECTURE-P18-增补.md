# ARCHITECTURE-P18 增补（§34：OAuth2 client_credentials）

版本：2026-10-02 ｜ 对应 PRD-P18（D139~~D142 / R151~~R155 / T155~T158）
地位：主文档 ARCHITECTURE.md §34 的入库蓝本。

---

## §34.1 落点与迁移

- **迁移**：`acc_credential` 加列 `type varchar(16) NOT NULL DEFAULT 'api_key'`（存量行自动 api_key，零数据改写）；§31.9 第 2 条预留兑现。
- 改动集中 `access/` 域：`credential/`（type 校验与创建）+ `ext/`（新 token 控制器、守卫双形态）；新增 `access/ext/oauth-token.controller.ts` 与 `token-store.ts`（Redis 存取）。**配额/审计/取数/工具链零改动**（principal 解析后管线同一）。

## §34.2 令牌生命周期（D139/R151）

```
签发：POST /api/ext/oauth/token（client_id=keyId, client_secret=secret, grant_type=client_credentials）
  → 复用凭证验证（sha256 比对、未吊销、未过期；oauth 型与 api_key 型均可换发，D141）
  → token = "it_" + base64url(32B)
  → Redis SET acc:token:{sha256(token)} = credentialId，EX = access.tokenTtlSeconds（默认 3600）
  → Redis SADD acc:token:idx:{credId} {sha256(token)}（索引，不随 TTL——清理见下）
  → 请求配额 +1（R142 同口径）；审计 ext.oauth.token

使用：Bearer it_* → GET acc:token:{sha256} → credentialId → 同一 principal 管线
  （scope 实时读凭证行 → 签发后收窄 scope 立即生效，R153）

失效：吊销 / 轮换 secret / expiresAt 到期
  → SMEMBERS acc:token:idx:{credId} → 逐个 DEL → DEL 索引本身（即时，R154）
```

- 索引集合的孤儿成员（token 已自然过期但索引残留）：签发新 token 时顺带清（扫描开销极小，凭证级基数低），不建后台任务。
- 密钥学同 P15：secret 只存 sha256、仅创建/轮换时展示一次；token 同等对待（摘要入审计禁原文）。

## §34.3 守卫双形态（R153）

```
ExtAuthGuard.canActivate
  → Bearer 串形态分派：
      "ik_" 前缀含 "." → 既有 API Key 校验（type 须 api_key；oauth 型直连 → 401 invalid_token 口径同 50019）
      "it_" 前缀       → Redis 令牌查找（未命中/过期 → 401 error="invalid_token" + 50019）
  → 命中后写 request.principal = { kind:'credential', id } —— 下游（配额/审计/scope/rowFilter/MCP）零感知
```

- MCP 端点同守卫（§32.3），token 天然可用于 `/api/ext/mcp`；手动 MCP 配置仍推荐 API Key（token 1 小时过期，PRD §6 分工口径）。

## §34.4 token 端点契约（D140/R152/R155）

- 路径：`POST /api/ext/oauth/token`（与 `/api/ext/v1`、`/api/ext/mcp` 同族；路由顺序断言随 smoke 扩）。
- 入参：form-urlencoded 优先（RFC），JSON 宽容；`grant_type` 必填且仅 `client_credentials`。
- 成功：RFC 6749 §5.1 三字段；**不返回 scope**（scope 以凭证行为准，避免快照错觉）。
- 错误：RFC 6749 §5.2（`invalid_client` 401 / `invalid_request`、`unsupported_grant_type` 400）——**平台 envelope 与业务码在此端点刻意不适用**；401 同样由守卫留痕（ownerId=0 系统流水，端点名 `ext.oauth.token`）。
- secret 边界：secret/token 原文不进审计、不进日志（沿用 maskSensitiveQuery 出口）。

## §34.5 前端（T157，最小产品化）

- 凭证创建弹窗加「类型」radio：`API Key（默认）` / `OAuth2（client_credentials）`；编辑态类型只读（D141 不可变）+ 一句话提示。
- oauth 型创建成功同样走 secretOnce 一次性展示（复用既有组件）；列表类型列加标签。
- 界面文案准则（铁律 10）：不出现「client_credentials」原文以外的术语堆砌——说明语用「适合服务器程序自动取令牌（令牌 1 小时过期）」。

## §34.6 演进预留（本期不做）

- RFC 8414 发现端点 + MCP 自动 OAuth 流程（归 MCP 二期一并议）；
- 并发令牌数上限 / 令牌清单管理页（本期由请求配额兜底）；
- JWT 自校验令牌（需吊销名单配合，与即时失效姿态冲突，除非引入短 TTL + 宽限双活）；
- refresh_token / authorization_code（无交互场景）。
