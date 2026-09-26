import { Module } from '@nestjs/common'
import { AppFacadeModule } from '../../app/facade/app-facade.module'
import { UserModule } from '../../system/user/user.module'
import { ListingService } from './listing.service'
import { MarketController } from './market.controller'

/**
 * 市场用户侧模块（P13 T118）：
 * 依赖 AppFacadeModule（结构导出 / 演示数据读取 / 复制物化全部经门面，铁律 6）
 * 与 UserModule（发布者昵称快照，用其 exports 的 UserService）。
 */
@Module({
  imports: [AppFacadeModule, UserModule],
  controllers: [MarketController],
  providers: [ListingService],
  exports: [ListingService],
})
export class ListingModule {}
