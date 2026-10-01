import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

/**
 * 工具定义（入参形状由各工具文件自行收口）。
 *
 * `inputSchema` 为 zod raw shape（`{ 字段名: ZodType }`），运行时由 SDK 转 JSON Schema 下发给
 * MCP 客户端（客户端据此构造 `tools/call` 的 `arguments`，并由 SDK 在调用前做 zod 校验）。
 */
export interface McpToolRegistration {
  /** 工具名（`iplat_` 前缀冻结，R143；改名会破坏外部集成） */
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  /** 工具实现（`args` 已由 SDK 按 schema 校验/填充；形状由工具内 cast 收口） */
  handler: (args: unknown) => Promise<CallToolResult>
}

/**
 * 工具注册出口（P15-C 技术决定，唯一一处类型切断点）。
 *
 * **为什么需要它**：SDK 的 `McpServer.registerTool` 泛型会在入参上做逐键 `ShapeOutput` 展开，
 * 并与 zod v3/v4 双版本兼容类型叠加；本项目（TS 5.8 / zod 3.25）实测**任何** `registerTool`
 * 调用都触发 TS2589（type instantiation is excessively deep），加大编译堆内存至 4GB 后仍然
 * 失败（`z.array(z.string()).optional()` 这种最浅的链式类型也会炸）。这是 SDK 的类型表达问题，
 * 不是调用方写错。
 *
 * **切断范围刻意最小**：`registerTool` 仍是 SDK 原方法（原样调用、原样绑定），
 * 运行时行为**零差异**——zod 校验照常、JSON Schema 照常生成、协议握手照常；
 * 仅不再由 TS 静态推导 handler 的入参形状，改由各工具文件的显式 `QueryArgs` 类型 + cast 收口。
 * 若后续 SDK 修好类型，删掉本文件、各工具直接调 `server.registerTool` 即可（工具实现不动）。
 */
export function registerTool(server: McpServer, tool: McpToolRegistration): void {
  const register = server.registerTool.bind(server) as unknown as (
    name: string,
    config: { title: string; description: string; inputSchema: Record<string, unknown> },
    handler: (args: unknown, extra: unknown) => Promise<CallToolResult>,
  ) => unknown
  register(
    tool.name,
    { title: tool.title, description: tool.description, inputSchema: tool.inputSchema },
    tool.handler,
  )
}
