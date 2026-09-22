import { Module } from '@nestjs/common'
import { CloudFacadeModule } from '../../cloud/facade/cloud-facade.module'
import { ToolModule } from '../tool/tool.module'
import { ConversationController } from './conversation.controller'
import { ConversationService } from './conversation.service'

/** P10 T96：imports CloudFacadeModule——消息列表附件失效标注（invalid）经云盘门面批量判定 */
@Module({
  imports: [ToolModule, CloudFacadeModule],
  controllers: [ConversationController],
  providers: [ConversationService],
  exports: [ConversationService],
})
export class ConversationModule {}
