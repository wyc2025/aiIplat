import { Module } from '@nestjs/common'
import { StorageModule } from '../../../infra/storage/storage.module'
import { CloudFacadeModule } from '../../cloud/facade/cloud-facade.module'
import { AdminModule } from '../admin/admin.module'
import { DataModule } from '../data/data.module'
import { SchemaModule } from '../schema/schema.module'
import { ImportController } from './import.controller'
import { ImportService } from './import.service'

/**
 * CSV 导入导出 + 附件上传模块（P11 T103）。
 * 依赖：Admin（属主校验）/ Schema（表解析）/ Data（逐行写入经唯一入口）/ Storage（tmp 读取）
 * / CloudFacade（附件强制目录上传）。
 */
@Module({
  imports: [AdminModule, SchemaModule, DataModule, StorageModule, CloudFacadeModule],
  controllers: [ImportController],
  providers: [ImportService],
  exports: [ImportService],
})
export class ImportModule {}
