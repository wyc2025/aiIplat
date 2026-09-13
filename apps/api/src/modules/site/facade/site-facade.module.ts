import { Module } from '@nestjs/common'
import { CloudModule } from '../../cloud/cloud.module'
import { SiteManageModule } from '../manage/manage.module'
import { SiteFacade } from './site-facade.service'

/**
 * SiteFacade 独立模块（P4b T44，架构增补 §15.1「template 同域直注 facade」的落地形态）：
 * 原 SiteFacade 注册在 SiteModule 聚合层，子模块（template）无法注入父聚合的 provider；
 * 独立成模块后 SiteTemplateModule 可直接 imports 本模块（同域直注，无循环依赖）。
 * SiteModule 仍 re-export SiteFacade，对外契约（ToolModule / SystemModule import SiteModule）不变。
 *
 * P4E T60/T62：imports SiteManageModule 以获得 SiteManageService（createSite 委托同一创建链 R57）；
 * SiteManageModule 不依赖 SiteFacadeModule，故无循环（SiteFacadeModule → SiteManageModule → CloudModule）。
 */
@Module({
  imports: [CloudModule, SiteManageModule],
  providers: [SiteFacade],
  exports: [SiteFacade],
})
export class SiteFacadeModule {}
