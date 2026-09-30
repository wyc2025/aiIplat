import { Module } from '@nestjs/common'
import { AppFacadeModule } from '../../app/facade/app-facade.module'
import { CloudModule } from '../../cloud/cloud.module'
import { DisplayFacadeModule } from '../../display/facade/display-facade.module'
import { OpenAppDataController } from './open-app-data.controller'
import { OpenApiController } from './open-api.controller'
import { OpenStaticController } from './open-static.controller'
import { SiteResolveModule } from './site-resolve.module'
import { SiteOpenService } from './open.service'

/**
 * 开放层模块（架构增补 §14.1 open/）：访客侧唯一出口，全部 @Public 免登录。
 * 路由顺序（§14.4 铁律）：具体路由控制器（`:slug/api/*`、`:slug/disp/*`）必须先于
 * OpenStaticController（`:slug` 通配）注册；静态层首段 api 双保险兜底（T35）。
 *
 * P14 T125：新增 `OpenAppDataController`（授权取数面 `/api/open/:slug/api/app/:appCode/**`，
 * R125 校验链经 `DisplayFacade.assertCanRead` + `AppFacade`）与展示应用静态路由
 * （`:slug/disp/:id/**`，经 `DisplayFacade.resolveForOpen`）。
 *
 * **依赖方向（P14 运行时定案）**：`SiteResolveService` 已抽到独立的 `SiteResolveModule`
 * （open 与 manage 共用）——否则 `SiteFacadeModule → SiteManageModule → SiteOpenModule →
 * DisplayFacadeModule → DisplayManageModule → SiteFacadeModule` 成环，启动即 TDZ 崩。
 * 现依赖单向：site.open → display.facade → display.manage → site.facade → site.manage → site.resolve。
 */
@Module({
  imports: [CloudModule, SiteResolveModule, DisplayFacadeModule, AppFacadeModule],
  controllers: [OpenAppDataController, OpenApiController, OpenStaticController],
  providers: [SiteOpenService],
})
export class SiteOpenModule {}
