import { Module } from '@nestjs/common'
import { SiteColumnController } from './column.controller'
import { SiteColumnService } from './column.service'

/** 栏目管理模块（架构增补 §14.1 column/；P5 T71 exports 供 SiteFacadeModule 同域直注） */
@Module({
  controllers: [SiteColumnController],
  providers: [SiteColumnService],
  exports: [SiteColumnService],
})
export class SiteColumnModule {}
