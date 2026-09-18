import { Module } from '@nestjs/common'
import { CloudFacadeModule } from '../../cloud/facade/cloud-facade.module'
import { SiteArticleController } from './article.controller'
import { SiteArticleService } from './article.service'

/**
 * 文章管理模块（架构增补 §14.1 article/；P5 T71 exports 供 SiteFacadeModule 同域直注）。
 *
 * P8 T88：imports CloudFacadeModule —— 「从云盘已有文件导入文章」需读云盘文件，
 * 跨域只经门面（CloudFacadeModule 零 site 依赖，无循环风险）。
 */
@Module({
  imports: [CloudFacadeModule],
  controllers: [SiteArticleController],
  providers: [SiteArticleService],
  exports: [SiteArticleService],
})
export class SiteArticleModule {}
