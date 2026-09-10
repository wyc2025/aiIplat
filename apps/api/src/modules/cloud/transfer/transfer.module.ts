import { Module } from '@nestjs/common'
import { StorageModule } from '../../../infra/storage/storage.module'
import { FileModule } from '../file/file.module'
import { TransferController } from './transfer.controller'
import { TransferService } from './transfer.service'
import { UnzipService } from './unzip.service'

@Module({
  // FileService（归属校验/同名判定/配额/深度）+ StorageService（物理文件读写/tmp）均为域内/infra 复用
  imports: [FileModule, StorageModule],
  controllers: [TransferController],
  providers: [TransferService, UnzipService],
  exports: [TransferService],
})
export class TransferModule {}
