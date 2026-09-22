import { Module } from '@nestjs/common'
import { CloudFacadeModule } from '../../cloud/facade/cloud-facade.module'
import { UserModule } from '../../system/user/user.module'
import { CreditModule } from '../credit/credit.module'
import { EngineModule } from '../engine/engine.module'
import { ToolModule } from '../tool/tool.module'
import { ChatController } from './chat.controller'
import { ChatService } from './chat.service'
import { SystemPromptService } from './system-prompt.service'

/** P10 T96：imports CloudFacadeModule——附件解析链走云盘域门面（属主/白名单/读字节），不破域边界 */
@Module({
  imports: [EngineModule, CreditModule, ToolModule, UserModule, CloudFacadeModule],
  controllers: [ChatController],
  providers: [ChatService, SystemPromptService],
})
export class ChatModule {}
