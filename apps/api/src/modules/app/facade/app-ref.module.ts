import { Module } from '@nestjs/common'
import { AppRefService } from './app-ref.service'

/**
 * app 域反向引用最小模块（P11 T100，D96）：
 * 对外暴露 AppRefService 供 cloud 域 imports（删除/彻底删除/回收站清理前预检）。
 * 本模块零跨域 import（PrismaModule 为全局），故 cloud 域 import 它不会与
 * AppFacadeModule（依赖 CloudFacadeModule）构成循环依赖（照 SiteRootModule 先例）。
 */
@Module({
  providers: [AppRefService],
  exports: [AppRefService],
})
export class AppRefModule {}
