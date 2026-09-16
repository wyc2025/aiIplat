import { Module } from '@nestjs/common'
import { SiteCommentController } from './comment.controller'
import { SiteCommentService } from './comment.service'

/**
 * 评论管理模块（架构增补 §14.1 comment/）。
 * P6 T78：exports SiteCommentService 供 SiteFacadeModule 同域直注（AI 评论工具经门面调用）。
 */
@Module({
  controllers: [SiteCommentController],
  providers: [SiteCommentService],
  exports: [SiteCommentService],
})
export class SiteCommentModule {}
