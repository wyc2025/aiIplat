import { Module } from '@nestjs/common'
import { SiteArticleController } from './article.controller'
import { SiteArticleService } from './article.service'

/** 文章管理模块（架构增补 §14.1 article/） */
@Module({
  controllers: [SiteArticleController],
  providers: [SiteArticleService],
})
export class SiteArticleModule {}
