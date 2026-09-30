import { Module } from '@nestjs/common'
import { AppFacadeModule } from '../../app/facade/app-facade.module'
import { QuotaModule } from '../quota/quota.module'
import { CredentialController } from './credential.controller'
import { CredentialService } from './credential.service'

/**
 * 凭证子模块（P15 T134，API-P15 §1）。
 *
 * 出向依赖：`AppFacadeModule`（应用属主校验 / 暴露清单 / 应用摘要回填）——经门面，无环（app 域不依赖 access）。
 * 导出：`CredentialService` 供 T135 的 ext 守卫（`verify`）与 T136 的配额 / 审计消费。
 */
@Module({
  imports: [AppFacadeModule, QuotaModule],
  controllers: [CredentialController],
  providers: [CredentialService],
  exports: [CredentialService],
})
export class CredentialModule {}
