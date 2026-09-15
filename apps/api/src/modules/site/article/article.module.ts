import { Module } from '@nestjs/common'
import { SiteArticleController } from './article.controller'
import { SiteArticleService } from './article.service'

/** 文章管理模块（架构增补 §14.1 article/；P5 T71 exports 供 SiteFacadeModule 同域直注） */
@Module({
  controllers: [SiteArticleController],
  providers: [SiteArticleService],
  exports: [SiteArticleService],
})
export class SiteArticleModule {}
