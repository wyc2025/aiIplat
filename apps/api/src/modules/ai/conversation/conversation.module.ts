import { Module } from '@nestjs/common'
import { ToolModule } from '../tool/tool.module'
import { ConversationController } from './conversation.controller'
import { ConversationService } from './conversation.service'

@Module({
  imports: [ToolModule],
  controllers: [ConversationController],
  providers: [ConversationService],
  exports: [ConversationService],
})
export class ConversationModule {}
