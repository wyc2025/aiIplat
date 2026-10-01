# PRD-P15-C：MCP 适配器（对外开放接入层第三期）

版本：2026-09-30 ｜ 状态：已拍板，待转交 CodeBuddy
前置：P15（对外开放接入层）已交付并走查结清；本期的凭证、配额、审计、契约冻结层全部复用 P15 资产。

---

## 1. 背景与目标

P15 已冻结对外 REST 契约 v1（`/api/ext/v1/app/:appCode/**`，API Key + principal 配额 + 留痕）。MCP（Model Context Protocol）已成为外部 Agent 接入工具的事实标准，Streamable HTTP 为现行标准传输，协议核心已无状态化——与「每请求带 Bearer 凭证」的模型天然契合。

**本期目标**：在 ext-contract 之上加第二层协议适配（REST 语义 → JSON-RPC 工具语义），让外部 Agent（Claude Desktop / Cursor 等）可直接以 MCP 客户端身份读取已授权数据应用。**零新表、零新数据通道、零新错误码、零新配置键。**

## 2. 决策（D129/D130 预登记正式启用）

| 编号 | 决策                                                                                                                                | 说明                                                                                                                  |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| D129 | MCP 以**平台远程托管**形态提供，传输用 **Streamable HTTP**                                                                          | stdio 自托管为远期选项，本期不做                                                                                      |
| D130 | 安装 `@modelcontextprotocol/sdk`                                                                                                    | 特批 2026-09-30 已授予；本期唯一新依赖                                                                                |
| D131 | **单端点 + 无状态**：`POST /api/ext/mcp`，SDK 无会话模式（不发 sessionId、不存会话、不开启服务端推送）；GET/DELETE 一律 405         | 凭证即隐含应用（D126 推论），路径不带 appCode；无状态 = 横向扩容无障碍、Redis 零新增                                  |
| D132 | 工具集冻结为**只读三件套**：`iplat_get_schema` / `iplat_query_records` / `iplat_get_record`，语义与 REST v1 契约一一对应            | 名称加 `iplat_` 前缀，防客户端多 MCP 服务器命名冲突（工具名日后改名会破坏外部集成，本期一次定死）；写操作与聚合不提供 |
| D133 | **最小产品化**：不动后台 UI；API 文档给 Claude Desktop / Cursor / curl 配置示例；PLATFORM-GUIDE 不动（合注余量 7 字不足，且非必要） | —                                                                                                                     |
| D134 | 验收资产**独立新建 `smoke:mcp`**，与 smoke:ext 并列                                                                                 | JSON-RPC 与 REST 协议差异不混在一个脚本                                                                               |

## 3. 规则（R142 起）

- **R142 端点与传输冻结**：仅 `POST /api/ext/mcp`；无状态装配（每请求独立 server+transport 实例，响应结束即销毁）；GET/DELETE → HTTP 405。注册顺序 + 静态双保险核对（铁律：路由声明顺序是行为的一部分）。
- **R143 工具集冻结**：三件套名称/签名冻结；输入约束沿用 R104（size≤50 / sort≤2 / filter≤3 / expand≤1），默认值与 REST 契约对齐（不在本增补重复定义）；输出双形态——`structuredContent`（JSON 对象）+ `content[0].text`（同内容 JSON 字符串，兼容旧客户端）；工具描述精炼（面向外部 LLM，参照手册纪律从简）。
- **R144 错误映射**：认证/配额失败在 **HTTP 层**（401 + `WWW-Authenticate` + 50019；429 + `Retry-After` + 业务码按 API §22 现行口径）；工具执行期业务错误 → `result.isError=true` + 文本含业务码（40001/40400/50021 等，语义同 REST）；JSON-RPC 协议错误用标准码（-32601/-32602，SDK 自理）。
- **R145 配额与审计记账**：每个 JSON-RPC POST = 1 次请求配额（initialize / tools/list / tools/call 均计）；行数配额仅 `iplat_query_records`（按返回行数）与 `iplat_get_record`（1 行）事后记账；审计 event = `mcp.initialize` / `mcp.tools.list` / `mcp.tools.call`，参数摘要含工具名 + 参数（≤512 字，不含响应内容）；owner 隔离不变。
- **R146 数据通道零改**：工具实现只经 AppFacade 既有通道 + access 域凭证/scope/配额/审计管线；不得为 MCP 新开数据通路；内部 AI 工具表 43 个不变，check:ai / smoke:ai 不受影响。

## 4. 任务（T139 起）

| 编号 | 任务                                     | 要点                                                               |
| ---- | ---------------------------------------- | ------------------------------------------------------------------ |
| T139 | 依赖安装 + `access/mcp/` 骨架 + 端点注册 | 无状态 transport 装配；GET/DELETE 405；注册顺序与静态双保险断言    |
| T140 | 工具三件套实现                           | schema 映射 AppFacade；输入校验沿用 R104；envelope 双形态输出      |
| T141 | 配额/审计接入                            | 请求计数、行数事后记账、`mcp.*` 事件落 acc_audit                   |
| T142 | smoke:mcp 资产                           | initialize/list/call 正例 + 401/429 + 审计核对 + cursor 跨协议一致 |
| T143 | 文档入库                                 | API §23 + ARCHITECTURE §32 + 客户端配置示例 + PROGRESS 更新        |

## 5. 验收标准（8 条）

1. 无凭证/伪凭证/已吊销凭证调 MCP 端点 → HTTP 401 + `WWW-Authenticate: Bearer realm="iplat-ext"` + 50019（与 REST 一致）。
2. `tools/list` 恰好返回三件套，名称带 `iplat_` 前缀，inputSchema 合法，无第四个工具。
3. 同一凭证下，`iplat_get_schema` 返回与 REST `GET /api/ext/v1/app/:appCode/schema` 逐字段一致。
4. `iplat_query_records` 与 REST records 同参同结果；**nextCursor 跨协议可混用**（REST 拉的游标可直接喂 MCP 续拉，反之亦然）。
5. `iplat_get_record` 正例通过；越界表/通配字段 → `isError=true` 且文本含对应业务码（40400/50021）。
6. tools/call 计入请求配额窗；query_records 返回行数计入行数窗；超限 → HTTP 429 + `Retry-After` + X-RateLimit-*。
7. `mcp.*` 事件落 acc_audit：归属者仅见本人流水，参数摘要 ≤512 字、无响应内容；401 由守卫层留痕（ownerId=0）。
8. 回归全绿：check:ai 19/19、smoke:ai 8/8、smoke:ext 35/35、smoke:mcp 全通过。

## 6. 增量清单

| 项            | 增量                                               |
| ------------- | -------------------------------------------------- |
| 数据表        | +0                                                 |
| 端点          | +1（POST /api/ext/mcp；GET/DELETE 405 为行为说明） |
| 新依赖        | +1（@modelcontextprotocol/sdk，特批已授予）        |
| 内部 AI 工具  | +0（43 不变；MCP 工具不进入内部工具表）            |
| 对外 MCP 工具 | +3（iplat_ 前缀三件套）                            |
| 错误码        | +0（下一可用仍为 50022）                           |
| 配置键        | +0                                                 |
| 验收资产      | +1（smoke:mcp）                                    |

## 7. 边界与非目标

- 不做写操作工具；不做 aggregate；不做 resources/prompts 能力（capabilities 仅 tools）。
- 不做有状态会话与服务端推送（SSE 流）；演进路径见 ARCH §32.9。
- 不做 stdio 自托管包；不做 OAuth 2.1（WWW-Authenticate 发现机制已与之兼容，属远期）。
- 不动 PLATFORM-GUIDE、不动后台 UI、不动数据层。
