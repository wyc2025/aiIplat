import { Module } from '@nestjs/common'
import { StorageModule } from '../../../infra/storage/storage.module'
import { PackService } from './pack.service'

/**
 * 流式打包独立模块（P4d T54）：
 * 对外暴露 PackService 供 transfer（管理侧 pack-download）与 share（文件夹分享整包）复用；
 * 仅依赖 infra StorageModule，不依赖 FileModule，故与二者均不成环。
 */
@Module({
  imports: [StorageModule],
  providers: [PackService],
  exports: [PackService],
})
export class PackModule {}
