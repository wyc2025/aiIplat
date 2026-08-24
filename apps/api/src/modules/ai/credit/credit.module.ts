import { Module } from '@nestjs/common'
import { CreditService } from './credit.service'

/** 积分模块：对外暴露 CreditService（预检/懒重置/结算） */
@Module({
  providers: [CreditService],
  exports: [CreditService],
})
export class CreditModule {}
