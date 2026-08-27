import { Module } from '@nestjs/common'
import { StorageModule } from '../../../infra/storage/storage.module'
import { FileModule } from '../file/file.module'
import { RecycleController } from './recycle.controller'
import { RecycleService } from './recycle.service'

@Module({
  // FileService（同名判定 resolveNameConflict）+ StorageService（物理文件删除）复用
  imports: [FileModule, StorageModule],
  controllers: [RecycleController],
  providers: [RecycleService],
  exports: [RecycleService],
})
export class RecycleModule {}
