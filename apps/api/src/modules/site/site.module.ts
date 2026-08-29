import { Module } from '@nestjs/common'
import { CloudModule } from '../cloud/cloud.module'
import { SiteArticleModule } from './article/article.module'
import { SiteColumnModule } from './column/column.module'
import { SiteCommentModule } from './comment/comment.module'
import { SiteFacade } from './facade/site-facade.service'
import { SiteManageModule } from './manage/manage.module'
import { SiteOpenModule } from './open/open.module'
import { SiteTagModule } from './tag/tag.module'

/**
 * 个人网站域聚合模块（P4a T33~T38 + P4b T41 门面扩展）
 * open（开放静态+开放数据 API）/ manage（站点设置）/ column / tag / article / comment；
 * 域门面 SiteFacade：hasSite（R13 删用户预检）+ P4b 站点语义校验层（ai 域工具三件套唯一通道，
 * 机械执行经 CloudFacade，故 imports CloudModule）。
 */
@Module({
  imports: [
    CloudModule,
    SiteOpenModule,
    SiteManageModule,
    SiteColumnModule,
    SiteTagModule,
    SiteArticleModule,
    SiteCommentModule,
  ],
  providers: [SiteFacade],
  exports: [SiteFacade],
})
export class SiteModule {}
