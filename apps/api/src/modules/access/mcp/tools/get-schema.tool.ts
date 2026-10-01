import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerTool } from '../tool-registry'
import { toolError, toolErrorCode, toolOk } from '../tool-errors'
import type { McpToolDeps } from './tool-deps'

/**
 * `iplat_get_schema`（R143 冻结）：读取应用暴露结构。
 *
 * 输出为 REST `GET /api/ext/v1/app/:appCode/schema` 的 `data` 段**逐字段一致**
 * （`{ app, tables }`，验收 #3）：同一 `publicSchema` + 同一 `projectSchema`（scope 收窄）。
 * 无入参；结构查询不占行数配额（`rows` 保持 0）。
 */
export function registerGetSchemaTool(server: McpServer, deps: McpToolDeps): void {
  registerTool(server, {
    name: 'iplat_get_schema',
    title: '读取应用数据结构',
    description:
      '返回本凭证所授权数据应用的表与字段清单（字段已按授权范围收窄）。无入参；建议先调用它了解可用表名与字段名，再调用 iplat_query_records。',
    inputSchema: {},
    handler: async () => {
      try {
        const payload = await deps.appFacade.publicSchema(deps.principal.ownerId, deps.appCode)
        const projected = deps.contract.projectSchema(payload, deps.principal.scope)
        return toolOk(projected as unknown as Record<string, unknown>)
      } catch (error) {
        deps.ctx.resultCode = toolErrorCode(error)
        return toolError(error)
      }
    },
  })
}
