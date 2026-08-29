import { Module } from '@nestjs/common'
import { SiteCommentController } from './comment.controller'
import { SiteCommentService } from './comment.service'

/** 评论管理模块（架构增补 §14.1 comment/） */
@Module({
  controllers: [SiteCommentController],
  providers: [SiteCommentService],
})
export class SiteCommentModule {}
