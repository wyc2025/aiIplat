import { Module } from '@nestjs/common'
import { SiteTagController } from './tag.controller'
import { SiteTagService } from './tag.service'

/** 标签管理模块（架构增补 §14.1 tag/；P5 T71 exports 供 SiteFacadeModule 同域直注） */
@Module({
  controllers: [SiteTagController],
  providers: [SiteTagService],
  exports: [SiteTagService],
})
export class SiteTagModule {}
