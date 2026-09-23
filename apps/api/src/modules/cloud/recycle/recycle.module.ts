import { Module } from '@nestjs/common'
import { StorageModule } from '../../../infra/storage/storage.module'
import { AppRefModule } from '../../app/facade/app-ref.module'
import { FileModule } from '../file/file.module'
import { RecycleCleanTask } from './recycle-clean.task'
import { RecycleController } from './recycle.controller'
import { RecycleService } from './recycle.service'

@Module({
  // FileService（同名判定 resolveNameConflict）+ StorageService（物理文件删除）复用
  // AppRefModule（P11 T103/D96）：彻底删除/清空/超期清理前预检应用引用（30021）
  imports: [FileModule, StorageModule, AppRefModule],
  controllers: [RecycleController],
  // RecycleCleanTask：回收站超期自动清理 cron（P4F T67，编排链在 RecycleService.cleanExpired）
  providers: [RecycleService, RecycleCleanTask],
  exports: [RecycleService],
})
export class RecycleModule {}
