import { Module } from '@nestjs/common'
import { ListingModule } from '../listing/listing.module'
import { MarketFacade } from './market-facade.service'

/**
 * market 域门面模块（P13 T120）：供 ai 域 ToolBootstrap 注入 MarketFacade。
 * 防环：market → app 单向（经 AppFacadeModule）；ai → market 单向（本模块）。
 */
@Module({
  imports: [ListingModule],
  providers: [MarketFacade],
  exports: [MarketFacade],
})
export class MarketFacadeModule {}
