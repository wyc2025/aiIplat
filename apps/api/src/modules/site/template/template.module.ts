import { Module } from '@nestjs/common'
import { SiteFacadeModule } from '../facade/site-facade.module'
import { SiteTemplateApplyController, SiteTemplateController } from './template.controller'
import { SiteTemplateService } from './template.service'

/**
 * 模板库子模块（P4b T44，架构增补 §15.1/§15.7）：
 * 同域直注 SiteFacade（独立模块形态，见 site-facade.module.ts）；
 * 不直接碰 StorageService——机械写入全在 SiteFacade → CloudFacade。
 *
 * 两个控制器同模块共存（T65 后）：列表 `GET /api/site/templates`（平台级资源，留顶层）
 * 与应用 `POST /api/site/manage/:id/apply-template`（站点级写操作，收进 manage 命名空间）。
 */
@Module({
  imports: [SiteFacadeModule],
  controllers: [SiteTemplateController, SiteTemplateApplyController],
  providers: [SiteTemplateService],
  exports: [SiteTemplateService],
})
export class SiteTemplateModule {}
