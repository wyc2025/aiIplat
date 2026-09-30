import { Module } from '@nestjs/common'
import { CloudFacadeModule } from '../../cloud/facade/cloud-facade.module'
import { DataModule } from '../data/data.module'
import { SchemaModule } from '../schema/schema.module'
import { PubDataService } from './pub-data.service'

/**
 * 授权取数面模块（P12 T112 建公开面 → P14 T126 退役匿名端点）。
 *
 * P14 D115：`/api/pub/app/{pubCode}/**` 五端点整体退役（匿名公开面废除，控制器已删）；
 * 本模块只保留**取数语义实现**（暴露校验 + R104 参数白名单 + R101 投影 + 缓存 + 附件三道闸），
 * 由 `AppFacade` 封装后供 site 域开放层在 R125 授权校验链（站点 → 授权 → is_public → 暴露）之后调用。
 *
 * 依赖：DataModule（复用 A 侧查询执行器）、SchemaModule（表解析）、CloudFacadeModule（附件流）。
 */
@Module({
  imports: [DataModule, SchemaModule, CloudFacadeModule],
  providers: [PubDataService],
  exports: [PubDataService],
})
export class PubModule {}
