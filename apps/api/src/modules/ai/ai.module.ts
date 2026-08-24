import { Module } from '@nestjs/common'
import { ChatModule } from './chat/chat.module'
import { ConversationModule } from './conversation/conversation.module'
import { CreditModule } from './credit/credit.module'
import { EngineModule } from './engine/engine.module'
import { PlanModule } from './plan/plan.module'
import { AiProviderModule } from './provider/provider.module'
import { UsageModule } from './usage/usage.module'

/**
 * AI 域聚合模块（P2a）
 * 子模块：provider（T12）/ conversation（T13）/ chat+credit（T14）/ plan+usage（T15）
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
  ],
  exports: [AiProviderModule, EngineModule, ConversationModule, CreditModule, ChatModule, PlanModule, UsageModule],
})
export class AiModule {}
