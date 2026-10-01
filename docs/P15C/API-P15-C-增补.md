# API-P15-C 增补（§23：MCP 端点契约）

版本：2026-09-30 ｜ 对应 PRD-P15-C；本节为 API.md §23 的入库蓝本。
未在本节出现的字段语义，一律以 §22（REST 对外契约 v1）为权威，本增补不重复定义。

---

## §23.1 端点

| 方法         | 路径           | 行为                                         |
| ------------ | -------------- | -------------------------------------------- |
| POST         | `/api/ext/mcp` | Streamable HTTP（无状态模式），JSON-RPC 2.0  |
| GET / DELETE | `/api/ext/mcp` | **405**（无状态模式不支持 SSE 流与会话终止） |

请求头：

```
Authorization: Bearer {keyId}.{secret}     # P15 接入凭证（ik_xxxxxxxxxx.{secret}）
Content-Type: application/json
Accept: application/json, text/event-stream
```

- 凭证即隐含应用（D126）：端点不带 appCode，凭证行解析应用。
- initialize 握手每请求独立（无状态）；server capabilities 仅声明 `tools`。

## §23.2 JSON-RPC 方法

| 方法               | 说明                                                |
| ------------------ | --------------------------------------------------- |
| `initialize`       | 握手；返回 server name/version + capabilities.tools |
| `tools/list`       | 返回恰好三个工具（§23.3），无第四个                 |
| `tools/call`       | 调用工具；入参 `name` + `arguments`                 |
| 其余/notifications | 忽略或标准协议错误（SDK 自理）                      |

## §23.3 工具定义（R143 冻结）

### iplat_get_schema

- 入参：`{}`（无参数）
- 返回：`{ appCode, tables: [...] }`——与 REST `GET /api/ext/v1/app/:appCode/schema` 逐字段一致（§22.2）。

### iplat_query_records

- 入参（JSON Schema）：
  - `table`：string，必填，scope 内暴露表；
  - `size`：number，可选，上限 50（R104）；
  - `cursor`：string，可选，上一页 `paging.nextCursor` 原样回传；
  - `sort`：array，可选，≤2 项（R104）；
  - `filter`：array，可选，≤3 项（R104）；
  - `expand`：string，可选，≤1 项（R104）。
- 返回：`{ data: [...], paging: { nextCursor, size } }`——与 REST records 端点同参同结果；**游标跨协议可混用**。
- 行数配额按返回行数事后记账。

### iplat_get_record

- 入参：`table`（必填）、`rowId`（必填）。
- 返回：`{ data: {...} }`——与 REST 单条端点一致；行数配额记 1 行。

### 输出双形态（R143）

每个工具结果同时给：

- `structuredContent`：JSON 对象（上表结构）；
- `content: [{ type: "text", text: "<同一对象的 JSON 字符串>" }]`（兼容旧客户端）。

### 工具描述

面向外部 LLM，中文、精炼（参照手册纪律从简），只陈述用途 + 关键约束（上限/必填项），不泄露内部实现、不出现 secret。

## §23.4 错误映射（R144）

| 场景                    | 层       | 表现                                                                   |
| ----------------------- | -------- | ---------------------------------------------------------------------- |
| 无/伪/吊销凭证          | HTTP     | 401 + `WWW-Authenticate: Bearer realm="iplat-ext"` + `{ code: 50019 }` |
| 请求/行数配额超限       | HTTP     | 429 + `Retry-After` + `X-RateLimit-*` + 业务码（口径同 §22）           |
| 表未暴露 / 越权行       | 工具结果 | `isError=true`，text 含 `40400`                                        |
| 字段通配 `*`            | 工具结果 | `isError=true`，text 含 `50021`                                        |
| ops 越界 / 参数违例     | 工具结果 | `isError=true`，text 含 `50009` / `40001`                              |
| 未知方法 / 参数形状非法 | JSON-RPC | 标准 `-32601` / `-32602`（SDK 自理）                                   |

## §23.5 配额与审计口径（R145）

- 每个 JSON-RPC POST 计 1 次请求配额（含 initialize / tools/list）。
- 审计 event：`mcp.initialize` / `mcp.tools.list` / `mcp.tools.call`；params 摘要 = 工具名 + 入参摘要（≤512 字，不含响应内容）。
- 查询入口：`GET /api/access/audits`（P15 既有，owner 隔离），按 event 前缀筛 `mcp.`。

## §23.6 客户端配置示例（D133 最小产品化）

> 示例以各客户端当期官方文档为准；`<keyId>.<secret>` 为创建凭证时一次性展示的完整 Key。

**Claude Desktop**（经 mcp-remote 代理）：

```json
{
  "mcpServers": {
    "iplat": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://<你的域名>/api/ext/mcp",
        "--header",
        "Authorization: Bearer <keyId>.<secret>"
      ]
    }
  }
}
```

**Cursor**（`.cursor/mcp.json`，原生支持远程 + 头）：

```json
{
  "mcpServers": {
    "iplat": {
      "url": "https://<你的域名>/api/ext/mcp",
      "headers": { "Authorization": "Bearer <keyId>.<secret>" }
    }
  }
}
```

**curl 冒烟**：

```bash
curl -X POST https://<你的域名>/api/ext/mcp \
  -H "Authorization: Bearer <keyId>.<secret>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## §23.7 编号登记（本期后）

| 系列          | 已用到                                   | 下一个可用          |
| ------------- | ---------------------------------------- | ------------------- |
| 决策 D        | D134                                     | D135                |
| 规则 R        | R146                                     | R147                |
| 任务 T        | T143                                     | T144                |
| 错误码 50xxx  | 50021（不变）                            | 50022               |
| 内部 AI 工具  | 43（不变）                               | —                   |
| 对外 MCP 工具 | 3（iplat_ 前缀冻结）                     | 加工具须先修订 R143 |
| 依赖          | +@modelcontextprotocol/sdk（特批已授予） | —                   |
