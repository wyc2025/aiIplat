import { Module } from '@nestjs/common'
import { CloudModule } from '../../cloud/cloud.module'
import { OpenApiController } from './open-api.controller'
import { OpenStaticController } from './open-static.controller'
import { SiteOpenService } from './open.service'
import { SiteResolveService } from './site-resolve.service'

/**
 * 开放层模块（架构增补 §14.1 open/）：访客侧唯一出口，全部 @Public 免登录。
 * 路由顺序（§14.4 铁律）：OpenApiController（:slug/api/* 具体路由）必须先于 OpenStaticController
 * （:slug 通配）注册；静态层首段 api 双保险兜底（T35）。
 * SiteResolveService 一并导出：site 域内 manage（改 slug/启停失效缓存）复用。
 */
@Module({
  imports: [CloudModule],
  controllers: [OpenApiController, OpenStaticController],
  providers: [SiteResolveService, SiteOpenService],
  exports: [SiteResolveService],
})
export class SiteOpenModule {}
