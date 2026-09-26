import { Module } from '@nestjs/common'
import { AppFacadeModule } from '../../app/facade/app-facade.module'
import { CloudModule } from '../../cloud/cloud.module'
import { MarketFacadeModule } from '../../market/facade/market-facade.module'
import { CreditModule } from '../credit/credit.module'
import { SiteModule } from '../../site/site.module'
import { OnlineModule } from '../../system/online/online.module'
import { RoleModule } from '../../system/role/role.module'
import { UserModule } from '../../system/user/user.module'
import { ToolBootstrap } from './tool.bootstrap'
import { ToolRegistry } from './tool.registry'

/**
 * 工具模块（P2b）：暴露 ToolRegistry。
 * 通过 ToolBootstrap 在启动时注册 37 个工具
 * （P2b 七个 + P4b 站点文件三件套 + P4e create_site + P5 云盘五件套 / CMS 七件套 / 生命周期两件套
 *  + P6 评论三件套 + P9 导入/排版两件套 + P11 数据应用七件套）；
 * handler 复用各域暴露的 Service（域门面纪律，见 ARCHITECTURE §12.3）：
 * 站点系列只注入 SiteFacade；云盘五件套只注入 CloudFacade；数据应用七件套只注入 AppFacade（P11 T105）。
 */
@Module({
  imports: [
    OnlineModule,
    UserModule,
    RoleModule,
    CreditModule,
    SiteModule,
    CloudModule,
    AppFacadeModule,
    MarketFacadeModule,
  ],
  providers: [ToolRegistry, ToolBootstrap],
  exports: [ToolRegistry],
})
export class ToolModule {}
