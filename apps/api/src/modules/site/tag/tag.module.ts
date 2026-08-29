import { Module } from '@nestjs/common'
import { SiteTagController } from './tag.controller'
import { SiteTagService } from './tag.service'

/** 标签管理模块（架构增补 §14.1 tag/） */
@Module({
  controllers: [SiteTagController],
  providers: [SiteTagService],
})
export class SiteTagModule {}
