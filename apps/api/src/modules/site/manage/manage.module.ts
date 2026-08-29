import { Module } from '@nestjs/common'
import { StorageModule } from '../../../infra/storage/storage.module'
import { CloudModule } from '../../cloud/cloud.module'
import { SiteOpenModule } from '../open/open.module'
import { SiteManageController } from './manage.controller'
import { SiteManageService } from './manage.service'

/**
 * 站点设置模块（架构增补 §14.1 manage/）：
 * 复用 CloudFacade 建目录/登记模板文件（域边界：site 不直操 cloud_file）；
 * 模板写正式区经 StorageService（infra 全局能力）；缓存失效复用 SiteResolveService。
 */
@Module({
  imports: [StorageModule, CloudModule, SiteOpenModule],
  controllers: [SiteManageController],
  providers: [SiteManageService],
})
export class SiteManageModule {}
