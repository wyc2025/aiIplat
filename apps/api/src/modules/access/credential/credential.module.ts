import { Module } from '@nestjs/common'
import { AppFacadeModule } from '../../app/facade/app-facade.module'
import { QuotaModule } from '../quota/quota.module'
import { CredentialController } from './credential.controller'
import { CredentialService } from './credential.service'
import { TokenStore } from './token-store'

/**
 * 凭证子模块（P15 T134，API-P15 §1；P18 T155 加 OAuth2 令牌存储）。
 *
 * 出向依赖：`AppFacadeModule`（应用属主校验 / 暴露清单 / 应用摘要回填）——经门面，无环（app 域不依赖 access）。
 * 导出：`CredentialService` 供 ext 守卫（`verify` / `verifyForToken` / `principalOf`）与配额 / 审计消费；
 * `TokenStore` 供 ext 守卫（令牌解析）与 OAuth token 控制器（签发）消费——放本模块而非 ext，
 * 是因为 `ExtModule` 已依赖 `CredentialModule`，反向依赖会成环（P18 §34.1 归属说明）。
 */
@Module({
  imports: [AppFacadeModule, QuotaModule],
  controllers: [CredentialController],
  providers: [CredentialService, TokenStore],
  exports: [CredentialService, TokenStore],
})
export class CredentialModule {}
