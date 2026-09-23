import { Module } from '@nestjs/common'
import { CloudFacadeModule } from '../../cloud/facade/cloud-facade.module'
import { DataModule } from '../data/data.module'
import { SchemaModule } from '../schema/schema.module'
import { PubAppController } from './pub.controller'
import { PubDataService } from './pub-data.service'

/**
 * 数据应用公开面模块（P12 T112，ARCHITECTURE §28.1）：
 * `/api/pub/app/{pubCode}/**` 五端点（manifest / 页 schema / 数据列表 / 数据详情 / 附件流）。
 * 免登录（@Public）+ 独立限流（60/分/IP → 42900）+ 资源类失败统一 40400（防探测）。
 *
 * 依赖：DataModule（复用 A 侧查询执行器）、SchemaModule（表解析）、CloudFacadeModule（附件流）。
 * 站点域与云盘域零改动；不新增反向 Facade。
 */
@Module({
  imports: [DataModule, SchemaModule, CloudFacadeModule],
  controllers: [PubAppController],
  providers: [PubDataService],
  exports: [PubDataService],
})
export class PubModule {}
