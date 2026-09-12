import { Module } from '@nestjs/common'
import { SiteArticleModule } from './article/article.module'
import { SiteColumnModule } from './column/column.module'
import { SiteCommentModule } from './comment/comment.module'
import { SiteFacadeModule } from './facade/site-facade.module'
import { SiteRootModule } from './facade/site-root.module'
import { SiteManageModule } from './manage/manage.module'
import { SiteOpenModule } from './open/open.module'
import { SiteTagModule } from './tag/tag.module'
import { SiteTemplateModule } from './template/template.module'

/**
 * 个人网站域聚合模块（P4a T33~T38 + P4b T41~T44）
 * open（开放静态+开放数据 API）/ manage（站点设置）/ column / tag / article / comment / template（模板库）；
 * 域门面 SiteFacade（site-facade.module 独立注册，本模块 re-export 保持对外契约）：
 * hasSite（R13 删用户预检）+ P4b 站点语义校验层（ai 域工具三件套唯一通道）。
 */
@Module({
  imports: [
    SiteFacadeModule,
    SiteRootModule,
    SiteOpenModule,
    SiteManageModule,
    SiteColumnModule,
    SiteTagModule,
    SiteArticleModule,
    SiteCommentModule,
    SiteTemplateModule,
  ],
  exports: [SiteFacadeModule, SiteRootModule],
})
export class SiteModule {}
