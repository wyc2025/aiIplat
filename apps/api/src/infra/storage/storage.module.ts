import { Module } from '@nestjs/common'
import { StorageService } from './storage.service'

/** 文件存储基础设施模块（P3 起就绪；CloudModule 经此出口注入 StorageService） */
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
