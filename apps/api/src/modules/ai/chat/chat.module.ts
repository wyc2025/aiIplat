import { Module } from '@nestjs/common'
import { UserModule } from '../../system/user/user.module'
import { CreditModule } from '../credit/credit.module'
import { EngineModule } from '../engine/engine.module'
import { ToolModule } from '../tool/tool.module'
import { ChatController } from './chat.controller'
import { ChatService } from './chat.service'
import { SystemPromptService } from './system-prompt.service'

@Module({
  imports: [EngineModule, CreditModule, ToolModule, UserModule],
  controllers: [ChatController],
  providers: [ChatService, SystemPromptService],
})
export class ChatModule {}
