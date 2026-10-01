import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { registerTool } from '../tool-registry'
import { toolError, toolErrorCode, toolOk } from '../tool-errors'
import type { McpToolDeps } from './tool-deps'

/** 入参类型（handler 收口用；形状见 `inputSchema`） */
interface GetRecordArgs {
  table: string
  rowId: string
}

/**
 * `iplat_get_record`（R143 冻结）：按 `rowId` 读取单行。
 *
 * 与 REST `GET .../tables/:table/records/:rowId` 同源（同一 `publicDetail` + 同一投影）；
 * 行不存在 / 越权表一律 `isError` + `40400`（不暴露存在性，口径同 REST）。
 * 成功后 `rows` 记 1（R145：单行读取同样占用行数配额）。
 */
export function registerGetRecordTool(server: McpServer, deps: McpToolDeps): void {
  registerTool(server, {
    name: 'iplat_get_record',
    title: '读取单行记录',
    description:
      '按行主键 rowId 读取一条记录（字段已按授权范围收窄）。rowId 可从 iplat_query_records 的结果行取得。',
    inputSchema: {
      table: z.string().describe('逻辑表名，须在凭证授权范围内'),
      rowId: z.string().describe('行主键 rowId（字符串形态）'),
    },
    handler: async (raw) => {
      const args = raw as unknown as GetRecordArgs
      deps.ctx.tableName = args.table
      try {
        deps.contract.assertTableInScope(args.table, deps.principal.scope)
        const detail = await deps.appFacade.publicDetail(
          deps.principal.ownerId,
          deps.appCode,
          args.table,
          args.rowId,
          {},
        )
        deps.ctx.rows = 1
        return toolOk({
          data: deps.contract.projectRow(detail.row, args.table, deps.principal.scope),
        })
      } catch (error) {
        deps.ctx.resultCode = toolErrorCode(error)
        return toolError(error)
      }
    },
  })
}
