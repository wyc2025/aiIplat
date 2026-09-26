import { Injectable } from '@nestjs/common'
import { ListingService } from '../listing/listing.service'

/**
 * market 域门面（P13 T120 / R122，ARCH §29.1）：
 * ai 域工具（`submit_market_app`）经本门面提交市场，禁止绕过门面直读 market 表。
 * 后续市场相关只读能力（如市场运营数据）同样在此扩展。
 */
@Injectable()
export class MarketFacade {
  constructor(private readonly listingService: ListingService) {}

  /** AI 工具 submit_market_app：提交应用上架审核（50013 重复活跃条目 / 50015 内容不合规） */
  async submitMarketApp(
    userId: bigint,
    appCode: string,
    withDemoData?: boolean,
  ): Promise<{ ok: true; listingCode: string; status: string }> {
    return this.listingService.submit(userId, { appCode, withDemoData })
  }
}
