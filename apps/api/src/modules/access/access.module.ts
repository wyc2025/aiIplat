import { Module } from '@nestjs/common'
import { CredentialModule } from './credential/credential.module'
import { ExtModule } from './ext/ext.module'
import { AccessFacadeModule } from './facade/access-facade.module'
import { McpModule } from './mcp/mcp.module'

/**
 * access 域聚合模块（P15「对外开放接入层」，ARCHITECTURE §31 / ARCHITECTURE-P15 §1）。
 *
 * 职责：把对外访问从「站点 = 唯一隐式主体」升级为「多主体 + 凭证 + 范围授权 + 配额 + 审计」
 * 的统一接入层；本域持有凭证（`acc_credential`）与审计（`acc_audit`）两表。
 *
 * 域边界（铁律 3/6）：
 * - 本域**零跨域 import 业务模块**（只经 AppFacade / DisplayFacade 两个门面，铁律 3）；
 * - 对外只经 `AccessFacade`（site 域开放层埋匿名取数审计的唯一消费点）；
 * - 两表无物理 FK，跨域禁 JOIN；取数一律复用 `AppFacade` 五方法（绝不新开直读通道）。
 *
 * 子模块（随任务落地）：
 * - `credential/`（T134，已落地）：凭证生命周期 `/api/access/credentials/**`；
 * - `ext/`（T135，已落地）：对外取数面 `/api/ext/v1/app/:appCode/**` + 契约冻结层；
 * - `quota/` `audit/`（T136，已落地）：按 principal 的配额与审计横切；
 * - `facade/`（T136，已落地）：`AccessFacade.writeAudit`；
 * - `mcp/`（P15-C T139，已落地）：MCP 适配器 `POST /api/ext/mcp`（Streamable HTTP 无状态，
 *   复用 ext 的守卫与契约层，工具集三件套冻结 R143）。
 */
@Module({
  imports: [CredentialModule, ExtModule, AccessFacadeModule, McpModule],
  exports: [CredentialModule, AccessFacadeModule],
})
export class AccessModule {}
