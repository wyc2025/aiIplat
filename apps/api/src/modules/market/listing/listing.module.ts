import { Module } from '@nestjs/common'
import { AppFacadeModule } from '../../app/facade/app-facade.module'
import { DisplayFacadeModule } from '../../display/facade/display-facade.module'
import { UserModule } from '../../system/user/user.module'
import { ListingService } from './listing.service'
import { MarketController } from './market.controller'

/**
 * 市场用户侧模块（P13 T118；P14 T129 增依赖）：
 * 依赖 AppFacadeModule（结构导出 / 演示数据读取 / 复制物化全部经门面，铁律 6）、
 * DisplayFacadeModule（D117 bundle：快照连展示应用 + 授权一起打包与重建）
 * 与 UserModule（发布者昵称快照，用其 exports 的 UserService）。
 */
@Module({
  imports: [AppFacadeModule, DisplayFacadeModule, UserModule],
  controllers: [MarketController],
  providers: [ListingService],
  exports: [ListingService],
})
export class ListingModule {}
