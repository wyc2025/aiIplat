# ARCHITECTURE-P15-C 增补（§32：access/mcp 协议适配层）

版本：2026-09-30 ｜ 对应 PRD-P15-C（D129~~D134 / R142~~R146 / T139~T143）
地位：主文档 ARCHITECTURE.md §32 的入库蓝本；CodeBuddy 实施后可原样收编并按实测补注。

---

## §32.1 模块结构（access 域内，不新立域）

```
apps/api/src/modules/access/mcp/
├── mcp.controller.ts        # POST /api/ext/mcp 入口；GET/DELETE → 405
├── mcp-server.factory.ts    # 每请求构建 McpServer + StreamableHTTPServerTransport（无状态）
├── tools/
│   ├── get-schema.tool.ts   # iplat_get_schema
│   ├── query-records.tool.ts# iplat_query_records
│   └── get-record.tool.ts   # iplat_get_record
└── tool-errors.ts           # 业务错误 → isError 文本（含业务码）的统一格式化
```

工具层与传输层解耦：三个工具是纯函数式注册（接收 principal 上下文），工厂可复用于远期 stdio 形态。

## §32.2 无状态请求生命周期（D131/R142）

```
POST /api/ext/mcp
  → CredentialGuard（P15 既有：Bearer 校验，失败 401+WWW-Authenticate+50019+守卫留痕）
  → 请求配额预检（+1，P15 既有管线）
  → factory.create()：new McpServer({name,version}) + new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  → server.connect(transport) → transport.handleRequest(req,res,body)
  → 响应结束 close()（server 与 transport 均销毁，零残留状态）
```

- 无 sessionId → 无会话存储、无 Redis 新增键、无横向扩容障碍。
- GET（SSE 流）/ DELETE（会话终止）→ 405；无状态模式本就不支持，明确拒绝优于静默。
- 客户端 initialize 握手按每请求独立处理（无状态模式下 server capabilities 是确定性的）。

## §32.3 认证链（零改动复用）

- 守卫、401 语义、`WWW-Authenticate: Bearer realm="iplat-ext"`、守卫层 401 留痕（principal=`cred:{keyId}`、ownerId=0）全部沿用 P15 §31 既有实现。
- MCP 客户端的标准认证发现行为即 401 + WWW-Authenticate，与远期 OAuth 2.1 方向兼容。
- **secret 边界**：secret 不进 initialize 响应、不进工具描述、不进审计参数摘要。

## §32.4 工具 → AppFacade 调用链（R146 数据通道零改）

```
tool 调用（principal=credential）
  → 凭证行解析 appId（D126 一凭证一应用）
  → AppFacade.assertCanRead(appId, principal)（§31 既有，credential 分支）
  → scope 收窄（R132/R133：表/字段/ops 三纵深，fields 禁通配）
  → 复用 ext-contract 同一取数实现（R104 约束：size≤50/sort≤2/filter≤3/expand≤1，默认 rowId ASC + rowId tiebreaker，keyset 游标）
  → envelope 输出（structuredContent + content[0].text 双形态）
```

- **三个工具与 REST v1 端点共用同一取数实现**（协议壳不同，内核同一函数），保证验收 #3/#4 的逐字段一致与游标跨协议混用——游标编码器是同一份代码。
- 行数配额事后记账：query_records 按返回行数、get_record 记 1 行（P15 既有 post-response 计数钩子复用）。

## §32.5 错误映射（R144）

| 层                     | 场景                                | 表现                                                                            |
| ---------------------- | ----------------------------------- | ------------------------------------------------------------------------------- |
| HTTP 层（守卫/拦截器） | 无/伪/吊销凭证                      | 401 + WWW-Authenticate + body code 50019                                        |
| HTTP 层                | 请求/行数配额超限                   | 429 + Retry-After + X-RateLimit-* + 业务码（口径同 API §22）                    |
| 工具执行期             | 表未暴露/字段通配/ops 越界/参数违例 | result.isError=true，text 含业务码（40400/50021/50009/40001），语义与 REST 相同 |
| JSON-RPC 协议层        | 未知方法/参数形状非法               | 标准 -32601/-32602（SDK 自理，不手写）                                          |

原则：**认证与配额在 HTTP 层解决（客户端可自动发现/重试），业务语义在工具结果内解决（Agent 可读文本自纠）**。

## §32.6 配额与审计记账点（R145）

- 请求配额：controller 层每个 JSON-RPC POST 计 1（initialize/tools/list/tools/call 均计）——防「空握手刷接口」。
- 行数配额：仅两个数据工具事后记账（见 §32.4）。
- 审计 event：`mcp.initialize` / `mcp.tools.list` / `mcp.tools.call`；params 摘要 = 工具名 + 入参摘要（≤512 字，截断口径同 §31.7，不含响应内容）；principal/ownerId/quota 快照字段沿用 acc_audit 现有列。

## §32.7 路由注册与静态双保险（铁律：声明顺序是行为的一部分）

- `/api/ext/mcp` 与 P15 的 `/api/ext/v1/**` 同族，注册在开放层静态通配之前；`/api` 首段本就在静态处理器排除清单内（P14/P15 双保险），本期只需**把新端点的顺序断言加进 smoke:mcp**（正例可达 + 伪路径 40400）。
- controller 上同时声明 GET/DELETE → 405，避免落到全局 404 歧义。

## §32.8 安全注意

- 若 SDK transport 提供 Origin 校验开关，按默认开启；认证兜底始终是 Bearer 凭证，不依赖 Origin。
- 无会话 = 无会话劫持面；不开启服务端推送 = 无 SSE 长连接资源占用面。
- SDK 为唯一新依赖（D130 特批）；锁定版本，不走 latest。

## §32.9 演进预留（本期不做）

- **stdio 自托管**：工具层已解耦，工厂换 transport 即可；届时单独立项。
- **OAuth 2.1**：acc_credential 加 type 列 + WWW-Authenticate 发现已兼容；演进路径同 §31.9。
- **通知/订阅能力**：需要有状态会话 + 会话存储，届时独立立项并推翻 D131 无状态口径（文档先行）。
