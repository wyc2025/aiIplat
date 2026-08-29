import { Module } from '@nestjs/common'
import { CreditModule } from '../credit/credit.module'
import { SiteModule } from '../../site/site.module'
import { OnlineModule } from '../../system/online/online.module'
import { RoleModule } from '../../system/role/role.module'
import { UserModule } from '../../system/user/user.module'
import { ToolBootstrap } from './tool.bootstrap'
import { ToolRegistry } from './tool.registry'

/**
 * 工具模块（P2b）：暴露 ToolRegistry。
 * 通过 ToolBootstrap 在启动时注册 10 个工具（P2b 七个 + P4b 站点三件套）；
 * handler 复用各域暴露的 Service（域门面纪律，见 ARCHITECTURE §12.3）：
 * 站点三件套只注入 site 域 exports 的 SiteFacade（§15.3）。
 */
@Module({
  imports: [OnlineModule, UserModule, RoleModule, CreditModule, SiteModule],
  providers: [ToolRegistry, ToolBootstrap],
  exports: [ToolRegistry],
})
export class ToolModule {}
