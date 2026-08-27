import { Module } from '@nestjs/common'
import { StorageModule } from '../../../infra/storage/storage.module'
import { FileModule } from '../file/file.module'
import { TransferController } from './transfer.controller'
import { TransferService } from './transfer.service'

@Module({
  // FileService（归属校验/同名判定/配额）+ StorageService（物理文件读写）均为域内/infra 复用
  imports: [FileModule, StorageModule],
  controllers: [TransferController],
  providers: [TransferService],
  exports: [TransferService],
})
export class TransferModule {}
