import { Module } from '@nestjs/common'
import { AccessFacadeModule } from '../../access/facade/access-facade.module'
import { AppFacadeModule } from '../../app/facade/app-facade.module'
import { CloudModule } from '../../cloud/cloud.module'
import { DisplayFacadeModule } from '../../display/facade/display-facade.module'
import { StorageModule } from '../../../infra/storage/storage.module'
import { OpenAppDataController } from './open-app-data.controller'
import { OpenApiController } from './open-api.controller'
import { OpenStaticController } from './open-static.controller'
import { SiteReleaseTrackService } from './site-release-track.service'
import { SiteResolveModule } from './site-resolve.module'
import { SiteOpenService } from './open.service'

/**
 * 开放层模块（架构增补 §14.1 open/）：访客侧唯一出口，全部 @Public 免登录。
 * 路由顺序（§14.4 铁律）：具体路由控制器（`:slug/api/*`、`:slug/disp/*`）必须先于
 * OpenStaticController（`:slug` 通配）注册；静态层首段 api 双保险兜底（T35）。
 *
 * P14 T125：新增 `OpenAppDataController`（授权取数面）与展示应用静态路由
 * （`:slug/disp/:id/**`，经 `DisplayFacade.resolveForOpen`）。
 * P15 T133（D123）：取数路径收窄为 `/api/open/:slug/disp/:id/api/app/:appCode/**`，判定粒度由
 * 站点级 → **展示应用级**（旧 `:slug/api/app/**` 退役）；静态侧加 `disp/:id/api/` 子前缀排除双保险。
 *
 * **依赖方向（P14 运行时定案）**：`SiteResolveService` 已抽到独立的 `SiteResolveModule`
 * （open 与 manage 共用）——否则 `SiteFacadeModule → SiteManageModule → SiteOpenModule →
 * DisplayFacadeModule → DisplayManageModule → SiteFacadeModule` 成环，启动即 TDZ 崩。
 * 现依赖单向：site.open → display.facade → display.manage → site.facade → site.manage → site.resolve。
 */
@Module({
  imports: [
    CloudModule,
    // P19 T162：快照轨读 site-releases 区（StorageService 平台自营区，不经云盘文件树暴露）
    StorageModule,
    SiteResolveModule,
    DisplayFacadeModule,
    AppFacadeModule,
    // P15 T136：匿名层取数审计经 AccessFacade.writeAudit（site → access 的唯一依赖，铁律 3）
    AccessFacadeModule,
  ],
  controllers: [OpenAppDataController, OpenApiController, OpenStaticController],
  providers: [SiteOpenService, SiteReleaseTrackService],
})
export class SiteOpenModule {}
