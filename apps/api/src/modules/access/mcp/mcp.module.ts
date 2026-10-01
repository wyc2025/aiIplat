import { Module } from '@nestjs/common'
import { AppFacadeModule } from '../../app/facade/app-facade.module'
import { AuditModule } from '../audit/audit.module'
import { CredentialModule } from '../credential/credential.module'
import { ExtModule } from '../ext/ext.module'
import { QuotaModule } from '../quota/quota.module'
import { McpController } from './mcp.controller'
import { McpServerFactory } from './mcp-server.factory'

/**
 * MCP 适配器子模块（P15-C T139，D129~D132 / ARCH §32.1）。
 *
 * **协议适配层**：不新立域、不新表、不新错误码、不新配置键——在 `ext` 契约层之上加一层
 * 「REST 语义 → JSON-RPC 工具语义」的壳。出向依赖与 `ExtModule` 完全相同：
 * `CredentialModule`（守卫校验凭证）、`AppFacadeModule`（取数唯一通道，R146）、
 * `QuotaModule` / `AuditModule`（按 principal 记账）、`ExtModule`（复用契约层与守卫实例）。
 */
@Module({
  imports: [CredentialModule, AppFacadeModule, QuotaModule, AuditModule, ExtModule],
  controllers: [McpController],
  providers: [McpServerFactory],
})
export class McpModule {}
