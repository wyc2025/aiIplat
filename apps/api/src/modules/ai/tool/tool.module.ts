import { Module } from '@nestjs/common'
import { CloudModule } from '../../cloud/cloud.module'
import { CreditModule } from '../credit/credit.module'
import { SiteModule } from '../../site/site.module'
import { OnlineModule } from '../../system/online/online.module'
import { RoleModule } from '../../system/role/role.module'
import { UserModule } from '../../system/user/user.module'
import { ToolBootstrap } from './tool.bootstrap'
import { ToolRegistry } from './tool.registry'

/**
 * 工具模块（P2b）：暴露 ToolRegistry。
 * 通过 ToolBootstrap 在启动时注册 25 个工具
 * （P2b 七个 + P4b 站点文件三件套 + P4e create_site + P5 云盘五件套 / CMS 七件套 / 生命周期两件套）；
 * handler 复用各域暴露的 Service（域门面纪律，见 ARCHITECTURE §12.3）：
 * 站点系列只注入 site 域 exports 的 SiteFacade（§15.3 / §20.1），云盘五件套只注入 cloud 域 CloudFacade（§20.1）。
 */
@Module({
  imports: [OnlineModule, UserModule, RoleModule, CreditModule, SiteModule, CloudModule],
  providers: [ToolRegistry, ToolBootstrap],
  exports: [ToolRegistry],
})
export class ToolModule {}
