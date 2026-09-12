import { Module } from '@nestjs/common'
import { StorageModule } from '../../../infra/storage/storage.module'
import { PackModule } from '../transfer/pack.module'
import { SharePublicController } from './share-public.controller'
import { ShareController } from './share.controller'
import { ShareService } from './share.service'

@Module({
  // StorageService（访客下载流式读文件）+ PackService（文件夹分享整包 zip，P4d T55）复用
  imports: [StorageModule, PackModule],
  controllers: [ShareController, SharePublicController],
  providers: [ShareService],
  exports: [ShareService],
})
export class ShareModule {}
