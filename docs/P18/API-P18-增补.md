# API-P18 增补（§25：OAuth2 token 端点契约）

版本：2026-10-02 ｜ 对应 PRD-P18；本节为 API.md §25 的入库蓝本。
资源端点（§22 REST / §23 MCP）契约不变——唯一变化是 Authorization 头接受两种 Bearer 形态。

---

## §25.1 新端点（+1）

### `POST /api/ext/oauth/token`

请求（form-urlencoded 优先，JSON 宽容）：

```
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&client_id=ik_3f9ab2c7d1&client_secret=X7k...
```

成功 `200`（RFC 6749 §5.1，**非平台 envelope**）：

```json
{ "access_token": "it_9f2...", "token_type": "Bearer", "expires_in": 3600 }
```

错误（RFC 6749 §5.2，**非平台 envelope**）：

| 场景                                 | HTTP | body                                                                           |
| ------------------------------------ | ---- | ------------------------------------------------------------------------------ |
| client_id/secret 错、凭证已吊销/过期 | 401  | `{ "error": "invalid_client" }` + `WWW-Authenticate: Bearer realm="iplat-ext"` |
| `grant_type` 缺失                    | 400  | `{ "error": "invalid_request" }`                                               |
| `grant_type` 非 client_credentials   | 400  | `{ "error": "unsupported_grant_type" }`                                        |
| 签发计入请求配额超限                 | 429  | 平台口径（42900 + Retry-After + X-RateLimit-*）                                |

- 每次签发计该凭证请求配额 +1（不计行数）；审计 event `ext.oauth.token`（正负例落表，摘要不含 secret）。
- `access.tokenTtlSeconds`（默认 3600）为 ACCESS_* 配置组本期唯一新增键。

## §25.2 资源端点双形态（R153/R154）

| Authorization 头                | 形态                         | 校验                                    |
| ------------------------------- | ---------------------------- | --------------------------------------- |
| `Bearer ik_xxxxxxxxxx.{secret}` | API Key（type=api_key 专属） | 既有 sha256 比对（不缓存）              |
| `Bearer it_...`                 | access token                 | Redis 查 `acc:token:{sha256}`，即时失效 |

- type=oauth 凭证的 secret **直连资源端点 → 401**（必须走 token 端点换发）。
- 失败统一：`401` + `WWW-Authenticate: Bearer realm="iplat-ext", error="invalid_token"` + body `{ code: 50019 }`（§22 口径不变）。
- 吊销/轮换/凭证到期 → 该凭证全部 token 即时死（按 `acc:token:idx:{credId}` 级联删除）。
- token 使用期 scope 以凭证行实时为准：签发后收窄 scope，存量 token 立即按新 scope 生效。

## §25.3 管理侧契约变化（端点号沿用 §22.4，零新增）

| 端点                              | 变化                                                                               |
| --------------------------------- | ---------------------------------------------------------------------------------- |
| `POST /api/access/credentials`    | body 增 `type?: "api_key" \| "oauth"`（默认 api_key）；响应同构（secretOnce 不变） |
| `PUT /api/access/credentials/:id` | **type 不可变**（D141），带 type 字段 → 40001                                      |
| `GET /api/access/credentials*`    | 响应增 `type` 字段                                                                 |

## §25.4 客户端示例

```bash
# 换 token
curl -X POST https://<你的域名>/api/ext/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=<keyId>&client_secret=<secret>"

# 用 token（REST 与 MCP 同）
curl https://<你的域名>/api/ext/v1/app/<appCode>/tables/book/records \
  -H "Authorization: Bearer it_9f2..."
```

分工口径：程序化集成用 OAuth2（自动换发、短时效）；手动配置（MCP 客户端、 curl 调试）仍推荐 API Key。

## §25.5 编号登记（本期后）

| 系列               | 本期使用                                              | 下一个可用 |
| ------------------ | ----------------------------------------------------- | ---------- |
| 决策               | D139~D142                                             | D143       |
| 规则               | R151~R155                                             | R156       |
| 任务               | T155~T158                                             | T159       |
| HTTP 端点          | +1（`/api/ext/oauth/token`）                          | —          |
| 错误码             | +0（token 端点走 RFC 格式；资源端点复用 50019/42900） | 50022      |
| 配置键             | +1（`access.tokenTtlSeconds`）                        | —          |
| DB                 | +1 列（`acc_credential.type`，迁移）                  | —          |
| 新依赖             | +0                                                    | —          |
| AI 工具 / MCP 工具 | 43 / 3 不变                                           | —          |
