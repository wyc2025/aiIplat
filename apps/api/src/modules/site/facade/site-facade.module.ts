import { Module } from '@nestjs/common'
import { StorageModule } from '../../../infra/storage/storage.module'
import { CloudModule } from '../../cloud/cloud.module'
import { SiteArticleModule } from '../article/article.module'
import { SiteColumnModule } from '../column/column.module'
import { SiteCommentModule } from '../comment/comment.module'
import { SiteManageModule } from '../manage/manage.module'
import { SiteTagModule } from '../tag/tag.module'
import { SiteFacade } from './site-facade.service'

/**
 * SiteFacade 独立模块（P4b T44，架构增补 §15.1「template 同域直注 facade」的落地形态）：
 * 原 SiteFacade 注册在 SiteModule 聚合层，子模块（template）无法注入父聚合的 provider；
 * 独立成模块后 SiteTemplateModule 可直接 imports 本模块（同域直注，无循环依赖）。
 * SiteModule 仍 re-export SiteFacade，对外契约（ToolModule / SystemModule import SiteModule）不变。
 *
 * P4E T60/T62：imports SiteManageModule 以获得 SiteManageService（createSite 委托同一创建链 R57）；
 * SiteManageModule 不依赖 SiteFacadeModule，故无循环（SiteFacadeModule → SiteManageModule → CloudModule）。
 *
 * P5 T71：imports SiteArticleModule / SiteColumnModule / SiteTagModule 以获得 CMS 三服务
 * （同域直注，照 template 先例）；三者均零 imports，无循环风险。
 *
 * P6 T78：再 imports SiteCommentModule 以获得 SiteCommentService（评论 list/audit/reply），
 * CommentModule 零 imports，无循环风险。
 *
 * P21.1 T179：imports StorageModule（publishedDisplayIds 读发布快照 manifest 用）；
 * StorageModule 零 imports，无循环风险。CloudModule 虽内部使用 StorageService 但不转出口，
 * 故需显式引入。
 */
@Module({
  imports: [
    CloudModule,
    SiteManageModule,
    SiteArticleModule,
    SiteColumnModule,
    SiteTagModule,
    SiteCommentModule,
    StorageModule,
  ],
  providers: [SiteFacade],
  exports: [SiteFacade],
})
export class SiteFacadeModule {}
