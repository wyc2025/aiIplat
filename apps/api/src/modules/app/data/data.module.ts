import { Module } from '@nestjs/common'
import { CloudFacadeModule } from '../../cloud/facade/cloud-facade.module'
import { AdminModule } from '../admin/admin.module'
import { SchemaModule } from '../schema/schema.module'
import { DataController } from './data.controller'
import { DataService } from './data.service'

/**
 * 沙箱数据服务模块（P11 T103）：唯一数据入口（写校验/白名单查询/事务/r_cN/附件引用）。
 * 依赖 AdminModule（属主校验）+ SchemaModule（表解析）+ CloudFacadeModule（附件权属校验/上传）。
 * 对外导出 DataService：PageService（T104 动作事务）与 AppFacade 复用。
 */
@Module({
  imports: [AdminModule, SchemaModule, CloudFacadeModule],
  controllers: [DataController],
  providers: [DataService],
  exports: [DataService],
})
export class DataModule {}
