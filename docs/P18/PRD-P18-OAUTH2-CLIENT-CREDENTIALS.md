# PRD-P18：OAuth2 client_credentials（接入凭证第二形态）

版本：2026-10-02 ｜ 状态：已拍板，待转交 CodeBuddy
拍板记录：立项方向经 ask_user 连续两次「No preference」，按角色卡纪律由需求方（Kimi）拍板并记录——选择 OAuth2 client_credentials（§31.9 演进预留第 2 条，D120 的 OAuth 承诺兑现）。
前置：P15 / P15-C / P17 全部结清；type 列、WWW-Authenticate 发现机制、配额/审计管线均已在架构上预留。

---

## 1. 背景与目标

P15 Q2 拍板「先 API Key、架构预留 OAuth」。P15~P17 后，对外读取面（REST + MCP + rowFilter）已完整，唯认证只有 API Key 一种形态：长期有效、手动粘贴友好，但对**程序化机器集成**不合行业标准（无过期、无 RFC 6749 互操作）。

本期为 acc_credential 增加第二形态 **OAuth2 client_credentials**：客户端用 client_id/client_secret 在 token 端点换**短时效 access token**，再以 Bearer 使用现有全部对外端点。**API Key 与 OAuth2 并存，互不影响。**

增量：+1 列（type）/+1 端点（token）/**零新错误码**（token 端点走 RFC 6749 错误格式；资源端点复用 50019/42900）/零新依赖/+1 配置键/工具 43+3 不变。

## 2. 决策（D139 起）

| 编号 | 决策                                                                                                                                                         | 说明                                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| D139 | **不透明令牌 + Redis 存储**：access token = `it_` + 32 字节 base64url，sha256 作 Redis 键、TTL = expires_in，不落 DB                                         | 吊销/轮换即时失效（删键即死），与 P15「验证不缓存」姿态一致；JWT 无吊销能力，否掉 |
| D140 | **token 端点说 RFC 6749**（`error`/`error_description` + HTTP 400/401），资源端点维持平台码（50019/42900）——刻意分治                                         | token 端点的互操作对象是 OAuth 客户端库，必须 RFC 格式；资源端点是我方契约        |
| D141 | **type 不可变**：`acc_credential.type ∈ {api_key, oauth}`，创建后不可改；**任何有效凭证均可换 token**（api_key 型也可），但 oauth 型 secret 不能直连资源端点 | 给迁移路径（老凭证可渐进换 token 用）；oauth 型强制走换发，语义干净               |
| D142 | **token 签发计请求配额**（每次 +1，不计行数），审计 event `ext.oauth.token`（正负例都记，摘要不含 secret）                                                   | 防空转刷令牌；配额兜底即令牌风暴兜底，本期不设并发令牌数上限                      |

## 3. 规则（R151 起）

- **R151 令牌存储**：Redis 键 `acc:token:{sha256(token)}` → credentialId，TTL = `access.tokenTtlSeconds`（默认 3600，ACCESS_* 配置组新增该键）；每凭证索引集合 `acc:token:idx:{credId}` 存活跃令牌哈希，吊销/轮换时按索引全删（即时失效）。
- **R152 token 端点**：`POST /api/ext/oauth/token`；接受 `application/x-www-form-urlencoded`（RFC 要求）与 JSON（宽容）；唯一支持 `grant_type=client_credentials`；`client_id` = keyId、`client_secret` = 完整 secret；成功响应 RFC 6749 §5.1：`{ access_token, token_type: "Bearer", expires_in }`（不返回 scope 细节——scope 永以凭证行为准）。
- **R153 双形态校验链（ExtAuthGuard）**：`Bearer ik_*.*` → 既有 API Key 校验（type=api_key 专属；type=oauth 的 secret 直连 → 401）；`Bearer it_*` → Redis 查令牌 → 解析为同一 principal（`cred:{id}`）→ 配额/审计/scope/rowFilter 管线零改动。**scope 读取以凭证行为准**：签发后收窄 scope，存量 token 立即按新 scope 生效（无需重新签发）。
- **R154 失效语义**：凭证吊销 / 轮换 secret / expiresAt 到期 → 该凭证全部 token 即时死（按 R151 索引删）；token 自然过期 → 401 + `WWW-Authenticate: Bearer realm="iplat-ext", error="invalid_token"` + 50019（与凭证失效同表现）。
- **R155 token 端点错误（RFC 6749 §5.2）**：认证失败 → HTTP 401 `{ "error": "invalid_client" }`（+ WWW-Authenticate）；`grant_type` 缺/不支持 → HTTP 400 `invalid_request` / `unsupported_grant_type`；**不用平台 envelope**，errmsg 不含 secret 任何片段。

## 4. 任务（T155 起）

| 编号 | 任务                                         | 要点                                                                                                                                                           |
| ---- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T155 | 迁移 + type 列 + token 端点 + Redis 令牌存取 | `acc_credential` 加 `type varchar(16) NOT NULL DEFAULT 'api_key'`；R151/R152/R155                                                                              |
| T156 | ExtAuthGuard 双形态 + 失效级联               | R153/R154；吊销/轮换路径删 token 索引                                                                                                                          |
| T157 | 管理 UI：创建凭证选类型                      | radio 二选一（默认 API Key）+ 类型不可改提示；oauth 型同样 secretOnce 展示；界面文案准则                                                                       |
| T158 | 验证与文档                                   | smoke:ext 新增 OAuth 段；**随本期销 P17 走查 C1/C2**（rowFilter 下游标翻页实测 + vite build 证据）；卫生项 S-1（§31.9 第 3 条）；API §25 / ARCH §34 / PROGRESS |

## 5. 验收标准（8 条）

1. 正确 client_id/secret + `grant_type=client_credentials` → 200 + RFC 6749 §5.1 响应三字段齐全。
2. 错 secret → 401 + `invalid_client`（RFC 格式，非平台 envelope）；`grant_type` 缺失/不支持 → 400 `invalid_request`/`unsupported_grant_type`。
3. 持有 token 可调 REST 四端点与 MCP 三件套：与 API Key 完全同管线（scope/rowFilter 收窄、配额、审计一致），同一凭证两种形态取数结果一致。
4. 过期 token → 401 + `WWW-Authenticate` 含 `error="invalid_token"` + body 50019。
5. 吊销凭证 / 轮换 secret → 已签发 token **即时** 401（不等 TTL）。
6. 签发后收窄 scope（去表/加 rowFilter）→ 存量 token 立即按新 scope 生效。
7. token 签发计请求配额（X-RateLimit-* 递减可证）；审计 `ext.oauth.token` 正负例落表、摘要 ≤512 且不含 secret。
8. 回归全绿 + 上期销项：smoke:ext（57+OAuth 段）、smoke:mcp 39/39、check:ai 19/19、smoke:ai 正常浮动、双端 tsc/ESLint 零错；**P17-C1（rowFilter 下游标翻页/跨协议混用）实测单列、P17-C2 vite build 证据随附**。

## 6. 边界与非目标

- 不做 refresh_token（client_credentials 按 RFC 本就不用）；不做 authorization_code / PKCE（无交互式用户）；不做 RFC 8414 发现端点与 introspection 端点（本期手动配置，MCP 自动 OAuth 发现归 MCP 二期再议）；不做 JWT。
- 手动配置场景（MCP 客户端、curl）仍推荐 API Key——token 会过期，手贴体验差；文档明示分工。
- 手册与 PLATFORM-GUIDE 不动（合注余量 7 字）。
