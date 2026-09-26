import { Module } from '@nestjs/common'
import { MarketFacadeModule } from './facade/market-facade.module'
import { ListingModule } from './listing/listing.module'
import { ReviewModule } from './review/review.module'

/**
 * market 域聚合模块（P13「应用市场：快照式发布 / 审核 / 复制」，ARCHITECTURE §29）。
 *
 * 域边界（铁律 6）：
 * - market → app 仅经 `AppFacade`（结构导出 / 演示数据读取 / 复制物化），零跨域 import app 内部；
 * - ai 域仅经 `MarketFacade`（submit_market_app）；
 * - 审核/浏览只读 market 自有表（market_listing），无跨域 JOIN。
 */
@Module({
  imports: [ListingModule, ReviewModule, MarketFacadeModule],
  exports: [MarketFacadeModule],
})
export class MarketDomainModule {}
