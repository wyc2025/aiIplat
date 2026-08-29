import { Module } from '@nestjs/common'
import { SiteColumnController } from './column.controller'
import { SiteColumnService } from './column.service'

/** 栏目管理模块（架构增补 §14.1 column/） */
@Module({
  controllers: [SiteColumnController],
  providers: [SiteColumnService],
})
export class SiteColumnModule {}
