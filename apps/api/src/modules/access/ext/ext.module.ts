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
 */
@Module({
  imports: [CredentialModule, AppFacadeModule, QuotaModule, AuditModule],
  controllers: [ExtDataController],
  providers: [ExtAuthGuard, ExtContractService],
})
export class ExtModule {}
