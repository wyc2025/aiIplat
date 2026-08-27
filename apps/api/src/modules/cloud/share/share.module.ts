import { Module } from '@nestjs/common'
import { StorageModule } from '../../../infra/storage/storage.module'
import { SharePublicController } from './share-public.controller'
import { ShareController } from './share.controller'
import { ShareService } from './share.service'

@Module({
  // StorageService（访客下载流式读文件）复用
  imports: [StorageModule],
  controllers: [ShareController, SharePublicController],
  providers: [ShareService],
  exports: [ShareService],
})
export class ShareModule {}
