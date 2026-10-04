import { Module } from '@nestjs/common'
import { StorageModule } from '../../../infra/storage/storage.module'
import { CloudModule } from '../../cloud/cloud.module'
import { SiteResolveModule } from '../open/site-resolve.module'
import { SiteQuotaService } from '../quota/quota.service'
import { SiteAdminController } from './admin.controller'
import { SiteManageController } from './manage.controller'
import { SiteManageService } from './manage.service'

/**
 * 站点管理模块（架构增补 §14.1 manage/ + P4E §18.2）：
 * 站点 CRUD（SiteManageController）+ admin 配额（SiteAdminController）；
 * 复用 CloudFacade 建目录/登记模板文件（域边界：site 不直操 cloud_file）；
 * 模板写正式区经 StorageService（infra 全局能力）；缓存失效复用 SiteResolveService。
 * SiteQuotaService（配额懒创建/校验/admin 调整）随本模块注册（仅本站点管理链使用，不外泄）。
 * 对外导出 SiteManageService：SiteFacade.createSite 委托同一创建链（R57/D55）。
 *
 * P14 T125 调整：依赖由 `SiteOpenModule` 改为 `SiteResolveModule`（解析服务已抽出）——
 * 否则 open 依赖 display 门面时构成 `SiteFacadeModule → SiteManageModule → SiteOpenModule →
 * DisplayFacadeModule → DisplayManageModule → SiteFacadeModule` 模块环（运行时 TDZ 崩）。
 *
 * P20 T166 调整：**移除对 `SiteReleaseModule` 的依赖**——发布侧（P20 B2）需经
 * `DisplayFacade` 拿展示应用工作区清单，而其反向链
 * `display.facade → display.manage → SiteFacadeModule → SiteManageModule` 会回指本站点域；
 * 若此处仍 import release 模块即构成环。删站级联清理已降为纯函数
 * （`release/release-cleanup.util.ts`），故不需 DI，环断开。
 */
@Module({
  imports: [StorageModule, CloudModule, SiteResolveModule],
  controllers: [SiteManageController, SiteAdminController],
  providers: [SiteManageService, SiteQuotaService],
  exports: [SiteManageService],
})
export class SiteManageModule {}
