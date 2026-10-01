import type { AppFacade } from '../../../app/facade/app-facade.service'
import type { CredentialPrincipal } from '../../credential/credential.service'
import type { ExtContractService } from '../../ext/ext-contract.service'
import type { McpRequestContext } from '../tool-errors'

/**
 * 工具层依赖（工厂注入，ARCH §32.1）。
 *
 * 三个工具是**纯函数式注册**：接收本对象（含 principal 上下文）后把工具挂到 server 上，
 * 与传输层完全解耦——工厂换 transport 即可产出远期 stdio 形态，工具代码零改。
 *
 * 取数一律经 `AppFacade` + `ExtContractService`（R146 数据通道零改）：
 * 与 REST v1 端点**共用同一取数实现与同一游标编码器**，故带出「逐字段一致」与
 * 「nextCursor 跨协议可混用」两个性质。
 */
export interface McpToolDeps {
  /** 凭证主体（守卫解析；`appId` 即凭证绑定应用，D126 凭证即授权） */
  principal: CredentialPrincipal
  /** 凭证绑定应用的 code（工厂预解析；工具无需再带 appCode 入参） */
  appCode: string
  appFacade: AppFacade
  contract: ExtContractService
  /** 每请求上下文（工具写回行数 / 业务码，controller 事后记账） */
  ctx: McpRequestContext
}
