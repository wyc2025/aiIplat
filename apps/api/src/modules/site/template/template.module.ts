import { Module } from '@nestjs/common'
import { SiteFacadeModule } from '../facade/site-facade.module'
import { SiteTemplateController } from './template.controller'
import { SiteTemplateService } from './template.service'

/**
 * 模板库子模块（P4b T44，架构增补 §15.1/§15.7）：
 * 同域直注 SiteFacade（独立模块形态，见 site-facade.module.ts）；
 * 不直接碰 StorageService——机械写入全在 SiteFacade → CloudFacade。
 */
@Module({
  imports: [SiteFacadeModule],
  controllers: [SiteTemplateController],
  providers: [SiteTemplateService],
  exports: [SiteTemplateService],
})
export class SiteTemplateModule {}
