import { Injectable } from '@nestjs/common'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { ErrorCode } from '../../../common/constants/error-code'
import { BusinessException } from '../../../common/exceptions/business.exception'
import { AppFacade } from '../../app/facade/app-facade.service'
import type { CredentialPrincipal } from '../credential/credential.service'
import { ExtContractService } from '../ext/ext-contract.service'
import { registerGetRecordTool } from './tools/get-record.tool'
import { registerGetSchemaTool } from './tools/get-schema.tool'
import { registerQueryRecordsTool } from './tools/query-records.tool'
import type { McpRequestContext } from './tool-errors'

/** server 自述（`initialize` 响应回给客户端；对外身份，不含任何内部信息与 secret） */
const MCP_SERVER_NAME = 'iplat-ext'
const MCP_SERVER_VERSION = '1.0.0'

/**
 * MCP server 工厂（P15-C T139 / D131/R142 / ARCH §32.2）。
 *
 * **无状态装配**：每次 POST 构建一套 `McpServer` + `StreamableHTTPServerTransport`，响应结束即销毁。
 * 三个推论：① 无 `sessionId` → 无会话存储、Redis 零新增键、横向扩容无障碍；
 * ② 无 SSE 长连接（`enableJsonResponse`）→ 无推送能力、无连接资源占用面；
 * ③ principal 经闭包注入工具（每请求新实例）→ 无跨请求状态泄漏可能。
 *
 * **认证链复用 P15**（ARCH §32.3）：凭证由 `ExtAuthGuard` 在进入本工厂前完成校验，
 * 本工厂只做「凭证绑定应用是否可见」（R132 第 3 步）——MCP 路径不带 `appCode`
 * （D126 凭证即隐含应用），故比 REST 少一步「appCode 一致性」校验。
 */
@Injectable()
export class McpServerFactory {
  constructor(
    private readonly appFacade: AppFacade,
    private readonly contract: ExtContractService,
  ) {}

  /** 构建一次性 server + transport（失败一律 40400：应用不可见，不泄露存在性） */
  async create(
    principal: CredentialPrincipal,
    ctx: McpRequestContext,
  ): Promise<{ server: McpServer; transport: StreamableHTTPServerTransport }> {
    const app = await this.resolveVisibleApp(principal)

    const server = new McpServer({ name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION })
    const transport = new StreamableHTTPServerTransport({
      // 无 sessionIdGenerator = 无状态模式（D131）；不开启服务端推送（无 SSE 流）
      sessionIdGenerator: undefined,
      // 一次性请求-响应：响应体为 application/json，避免 SSE 长连接（ARCH §32.8）
      enableJsonResponse: true,
    })

    const deps = {
      principal,
      appCode: app.code,
      appFacade: this.appFacade,
      contract: this.contract,
      ctx,
    }
    registerGetSchemaTool(server, deps)
    registerQueryRecordsTool(server, deps)
    registerGetRecordTool(server, deps)

    await server.connect(transport)
    return { server, transport }
  }

  /**
   * 凭证绑定应用必须**未软删且 `is_public=1`**（R132 第 3 步）——
   * 未发布（`is_public=0`）或已删除 → 40400，与 REST 端点的第 ③ 步同口径。
   */
  private async resolveVisibleApp(
    principal: CredentialPrincipal,
  ): Promise<{ code: string; name: string }> {
    const apps = await this.appFacade.appBriefByIds(principal.ownerId, [principal.appId])
    const app = apps.find((item) => item.id === principal.appId.toString())
    if (!app || app.isPublic !== 1) {
      throw new BusinessException(ErrorCode.NotFound, '资源不存在')
    }
    return app
  }
}
