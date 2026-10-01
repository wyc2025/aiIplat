import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { registerTool } from '../tool-registry'
import { toolError, toolErrorCode, toolOk } from '../tool-errors'
import type { McpToolDeps } from './tool-deps'

/** 入参上限（R104：size ≤ 50 / sort ≤ 2 / filter ≤ 3 / expand ≤ 1；与 REST v1 同口径） */
const MAX_SIZE = 50
const MAX_SORT = 2
const MAX_FILTER = 3

/**
 * 入参 schema（R143 冻结）。
 *
 * 约束写进 zod（→ 转 JSON Schema 下发客户端，LLM 可读到边界），**运行时同样生效**：
 * 取数层 `resolveSize` / `parseListParams` 对同一批上限再做一次校验（越界 40001，语义同 REST）。
 */
const INPUT_SCHEMA = {
  table: z.string().describe('逻辑表名，须在凭证授权范围内（见 iplat_get_schema）'),
  size: z
    .number()
    .int()
    .min(1)
    .max(MAX_SIZE)
    .optional()
    .describe(`每页行数，1~${MAX_SIZE}，缺省 20`),
  cursor: z.string().optional().describe('上一页返回的 paging.nextCursor，原样回传；首页不传'),
  sort: z
    .array(z.string())
    .max(MAX_SORT)
    .optional()
    .describe(`排序项，形如 "字段:asc" 或 "字段:desc"，最多 ${MAX_SORT} 项`),
  filter: z
    .array(z.string())
    .max(MAX_FILTER)
    .optional()
    .describe(`过滤项，形如 "字段:eq:值" 或 "字段:contains:值"，最多 ${MAX_FILTER} 项`),
  expand: z.string().optional().describe('需展开的关联字段名，最多 1 个'),
}

/** 入参类型（handler 收口用；与 `INPUT_SCHEMA` 对应） */
interface QueryArgs {
  table: string
  size?: number
  cursor?: string
  sort?: string[]
  filter?: string[]
  expand?: string
}

/**
 * `iplat_query_records`（R143 冻结）：分页读取表记录。
 *
 * **与 REST records 端点共用同一取数实现**（R146）：同一 `publicListAll`（内部仍走
 * `DataService.queryForPublic`）、同一 `ExtContractService`（size / sort / cursor / 投影），
 * 故带出两个可验收性质（#4）：同参同结果 + **`nextCursor` 与 REST 的 `after` 跨协议可混用**。
 *
 * 入参形态刻意与 REST query 同形（`sort` / `filter` 为字符串数组），使两协议可逐参对照；
 * 行数在成功后写回 `ctx.rows`，由 controller 事后记账（R145）。
 */
export function registerQueryRecordsTool(server: McpServer, deps: McpToolDeps): void {
  registerTool(server, {
    name: 'iplat_query_records',
    title: '查询表记录',
    description:
      `分页读取授权范围内某张表的数据行。可选排序（最多 ${MAX_SORT} 项）、过滤（最多 ${MAX_FILTER} 项）与关联展开（1 项），每页最多 ${MAX_SIZE} 行；` +
      '翻页时把上一页返回的 paging.nextCursor 原样传给 cursor。表名可用 iplat_get_schema 获取。',
    inputSchema: INPUT_SCHEMA,
    handler: async (raw) => {
      const args = raw as unknown as QueryArgs
      deps.ctx.tableName = args.table
      try {
        deps.contract.assertTableInScope(args.table, deps.principal.scope)
        const size = deps.contract.resolveSize(args.size)
        const query: Record<string, unknown> = {}
        if (args.cursor) query.after = args.cursor
        if (args.sort) query.sort = args.sort
        if (args.filter) query.filter = args.filter
        if (args.expand) query.expand = [args.expand]

        const { rows, sort } = await deps.appFacade.publicListAll(
          deps.principal.ownerId,
          deps.appCode,
          args.table,
          query,
        )
        const { keys, signature } = deps.contract.resolveSort(sort)
        const cursor = deps.contract.decodeCursor(args.cursor ?? '', signature)
        const page = deps.contract.paginate(rows, keys, signature, cursor, size)
        const data = page.data.map((row) =>
          deps.contract.projectRow(row, args.table, deps.principal.scope),
        )
        deps.ctx.rows = data.length
        return toolOk({ data, paging: { nextCursor: page.nextCursor, size } })
      } catch (error) {
        deps.ctx.resultCode = toolErrorCode(error)
        return toolError(error)
      }
    },
  })
}
