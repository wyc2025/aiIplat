import { Module } from '@nestjs/common'
import { StorageModule } from '../../infra/storage/storage.module'
import { FileModule } from './file/file.module'
import { RecycleModule } from './recycle/recycle.module'
import { ShareModule } from './share/share.module'
import { TransferModule } from './transfer/transfer.module'
import { AdminModule } from './admin/admin.module'
import { CloudFacade } from './facade/cloud-facade.service'

/**
 * 云盘域聚合模块（P3）
 * 子模块规划：file（T26）/ transfer（T27）/ recycle（T28）/ share（T29）/ quota（T30）
 * 域门面 CloudFacade（hasFiles / saveAvatar / P4a 公开机制）随 T30/T34 落地；StorageService 已于 T27 在 infra/storage 就绪。
 */
@Module({
  imports: [StorageModule, FileModule, TransferModule, RecycleModule, ShareModule, AdminModule],
  providers: [CloudFacade],
  exports: [FileModule, TransferModule, RecycleModule, ShareModule, CloudFacade],
})
export class CloudModule {}
