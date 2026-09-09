import { Module } from '@nestjs/common'
import { CloudFacadeModule } from '../facade/cloud-facade.module'
import { PubController } from './pub.controller'
import { PubService } from './pub.service'

/**
 * 云盘公开访问子模块（P4c T46，架构增补 §16.2「实现归位」）：
 * /api/pub/ 七件套端点 + 公开访问判定链（token 校验/三态上溯/path 下行）。
 * 经 CloudFacadeModule 直注 CloudFacade 复用流式读取；不跨域 import site 域内部文件（域边界铁律）。
 */
@Module({
  imports: [CloudFacadeModule],
  controllers: [PubController],
  providers: [PubService],
})
export class CloudPublicModule {}
