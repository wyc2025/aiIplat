import { Module } from '@nestjs/common'
import { AppFacadeModule } from '../../app/facade/app-facade.module'
import { AuditModule } from '../audit/audit.module'
import { CredentialModule } from '../credential/credential.module'
import { QuotaModule } from '../quota/quota.module'
import { ExtAuthGuard } from './ext-auth.guard'
import { ExtContractService } from './ext-contract.service'
import { ExtDataController } from './ext-data.controller'

/**
 * 对外取数子模块（P15 T135，API-P15 §2）。
 *
 * 出向依赖：`CredentialModule`（守卫校验凭证）、`AppFacadeModule`（取数一律经门面 —— 铁律 5：
 * 与开放层共用同一 `DataService.queryForPublic` 执行器，**绝不新开直读通道**）。
 * 配额与审计拦截器随 T136 挂到 `ExtDataController` 上（本模块不重复实现）。
 *
 * **导出守卫与契约层**（P15-C T139）：`McpModule` 复用同一对实例——MCP 与 REST 共用
 * 同一凭证校验（401 语义一致）与同一取数内核（游标跨协议可混用，ARCH §32.4）。
 */
@Module({
  imports: [CredentialModule, AppFacadeModule, QuotaModule, AuditModule],
  controllers: [ExtDataController],
  providers: [ExtAuthGuard, ExtContractService],
  exports: [ExtAuthGuard, ExtContractService],
})
export class ExtModule {}
