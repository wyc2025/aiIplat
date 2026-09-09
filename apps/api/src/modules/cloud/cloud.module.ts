import { Module } from '@nestjs/common'
import { FileModule } from './file/file.module'
import { RecycleModule } from './recycle/recycle.module'
import { ShareModule } from './share/share.module'
import { TransferModule } from './transfer/transfer.module'
import { AdminModule } from './admin/admin.module'
import { CloudFacadeModule } from './facade/cloud-facade.module'
import { CloudPublicModule } from './public/pub.module'

/**
 * 云盘域聚合模块（P3~P4c）
 * 子模块：file / transfer / recycle / share / quota（admin）/ public（P4c 公开访问）；
 * 域门面 CloudFacade（cloud-facade.module 独立注册，本模块 re-export 保持对外契约，T46 照 T44 先例）：
 * hasFiles / saveAvatar / P4a 公开机制 / P4b 机械原语。
 */
@Module({
  imports: [FileModule, TransferModule, RecycleModule, ShareModule, AdminModule, CloudFacadeModule, CloudPublicModule],
  exports: [FileModule, TransferModule, RecycleModule, ShareModule, CloudFacadeModule],
})
export class CloudModule {}
