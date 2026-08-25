import { Module } from '@nestjs/common'
import { ChatModule } from './chat/chat.module'
import { ConversationModule } from './conversation/conversation.module'
import { CreditModule } from './credit/credit.module'
import { EngineModule } from './engine/engine.module'
import { PlanModule } from './plan/plan.module'
import { AiProviderModule } from './provider/provider.module'
import { ToolModule } from './tool/tool.module'
import { UsageModule } from './usage/usage.module'

/**
 * AI 域聚合模块
 * 子模块：provider（T12）/ conversation（T13）/ chat+credit（T14）/ plan+usage（T15）/ tool（T19）
 */
@Module({
  imports: [
    AiProviderModule,
    EngineModule,
    ConversationModule,
    CreditModule,
    ChatModule,
    PlanModule,
    UsageModule,
    ToolModule,
  ],
  exports: [
    AiProviderModule,
    EngineModule,
    ConversationModule,
    CreditModule,
    ChatModule,
    PlanModule,
    UsageModule,
    ToolModule,
  ],
})
export class AiModule {}
