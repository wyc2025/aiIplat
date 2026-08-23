import { Module } from '@nestjs/common'

/**
 * AI 域聚合模块（P2a）
 * 子模块按任务拆分挂载：provider（T12）/ conversation（T13）/ chat+engine+credit（T14）/ plan+usage（T15）
 * 当前为骨架：仅提供 ai 域入口，各子模块随任务落地后逐一 import。
 */
@Module({})
export class AiModule {}
