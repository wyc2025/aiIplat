import { Module } from '@nestjs/common'
import { StorageModule } from '../../../infra/storage/storage.module'
import { CloudModule } from '../../cloud/cloud.module'
import { SiteOpenModule } from '../open/open.module'
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
 */
@Module({
  imports: [StorageModule, CloudModule, SiteOpenModule],
  controllers: [SiteManageController, SiteAdminController],
  providers: [SiteManageService, SiteQuotaService],
  exports: [SiteManageService],
})
export class SiteManageModule {}
