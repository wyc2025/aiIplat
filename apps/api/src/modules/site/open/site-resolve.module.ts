import { Module } from '@nestjs/common'
import { CloudModule } from '../../cloud/cloud.module'
import { SiteResolveService } from './site-resolve.service'

/**
 * 站点解析独立模块（P14 T125）：`SiteResolveService`（slug → 站点、路径 → 云盘文件，均带缓存）
 * 由 open（静态文件 / 授权取数）与 manage（改 slug / 启停后失效缓存）**共用**。
 *
 * **为什么必须独立成模块**（P14 运行时实测定案）：本期的 `SiteOpenModule` 新增依赖
 * `DisplayFacadeModule`（展示应用静态服务与授权取数），而 display 域经
 * `SiteFacadeModule → SiteManageModule` 反向依赖 site 域——若 `SiteResolveService` 仍注册在
 * `SiteOpenModule` 内，则构成模块环：
 * `SiteFacadeModule → SiteManageModule → SiteOpenModule → DisplayFacadeModule → DisplayManageModule → SiteFacadeModule`，
 * 表现为**启动即崩**：`ReferenceError: Cannot access 'SiteFacadeModule' before initialization`（ESM TDZ；
 * `tsc` / `eslint` 均查不出，仅运行时暴露）。抽出本模块后依赖单向：
 * `site.open → display.facade → display.manage → site.facade → site.manage → site.resolve`（零回边）。
 */
@Module({
  imports: [CloudModule],
  providers: [SiteResolveService],
  exports: [SiteResolveService],
})
export class SiteResolveModule {}
