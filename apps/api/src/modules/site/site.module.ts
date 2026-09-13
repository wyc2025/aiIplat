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
 * 个人网站域聚合模块（P4a T33~T38 + P4b T41~T44 + P4E T59~T63）
 * open（开放静态+开放数据 API）/ manage（站点 CRUD + admin 配额）/ column / tag / article / comment /
 * template（模板库）；域门面 SiteFacade（site-facade.module 独立注册，本模块 re-export 保持对外契约）：
 * hasSite（R13 删用户预检）+ 多站解析/建站 + P4b 站点语义校验层（ai 域工具三件套唯一通道）。
 *
 * 路由口径（P4E T60/T65）：站点级资源（含应用模板）全部收在 `/api/site/manage/*`——
 * `GET|POST /api/site/manage`、`GET|PUT|DELETE /api/site/manage/:id`、`POST /api/site/manage/:id/apply-template`；
 * `/api/site/*` 顶层只剩静态段：平台级模板库 `templates`、内容子资源 `column|tag|article|comment`、
 * 管理员能力 `admin/quota`。**顶层无任何参数段**，故静态路由不会被吞、后续新增顶层路由也安全。
 */
@Module({
  imports: [
    SiteFacadeModule,
    SiteRootModule,
    SiteOpenModule,
    SiteTemplateModule,
    SiteManageModule,
    SiteColumnModule,
    SiteTagModule,
    SiteArticleModule,
    SiteCommentModule,
  ],
  exports: [SiteFacadeModule, SiteRootModule],
})
export class SiteModule {}
