import { Module } from '@nestjs/common'
import { ReviewController } from './review.controller'
import { ReviewService } from './review.service'

/** 市场审核模块（P13 T119）：admin 面（`market:review` + @OperationLog），只读写 market 自有表。 */
@Module({
  controllers: [ReviewController],
  providers: [ReviewService],
  exports: [ReviewService],
})
export class ReviewModule {}
