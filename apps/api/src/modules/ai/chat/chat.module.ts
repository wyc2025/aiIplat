import { Module } from '@nestjs/common'
import { CreditModule } from '../credit/credit.module'
import { EngineModule } from '../engine/engine.module'
import { ChatController } from './chat.controller'
import { ChatService } from './chat.service'

@Module({
  imports: [EngineModule, CreditModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
