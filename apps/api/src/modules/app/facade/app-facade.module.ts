import { Module } from '@nestjs/common'
import { CloudFacadeModule } from '../../cloud/facade/cloud-facade.module'
import { AdminModule } from '../admin/admin.module'
import { DataModule } from '../data/data.module'
import { PageModule } from '../page/page.module'
import { PubModule } from '../pub/pub.module'
import { SchemaModule } from '../schema/schema.module'
import { AppFacade } from './app-facade.service'

/**
 * app 域完整门面模块（P11 T101~T104 + P13 复制物化 + P14 授权取数面）：
 * 供 ai 域（工具 handler）、market 域（列表复制编排）与 site 域开放层（授权取数）注入 AppFacade；
 * 依赖 app 子模块（Admin/Schema/Page/Data/Pub）与 CloudFacadeModule（附件上传链）。
 *
 * 防环：cloud 域不 import 本模块（它只 import 最小 AppRefModule），故本模块 → CloudFacadeModule 不成环；
 * PubModule 不含控制器（P14 D115 匿名端点已退役），只提供取数语义实现。
 */
@Module({
  imports: [AdminModule, SchemaModule, PageModule, DataModule, PubModule, CloudFacadeModule],
  providers: [AppFacade],
  exports: [AppFacade],
})
export class AppFacadeModule {}
