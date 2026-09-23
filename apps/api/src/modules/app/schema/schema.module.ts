import { Module } from '@nestjs/common'
import { AdminModule } from '../admin/admin.module'
import { SchemaController } from './schema.controller'
import { SchemaService } from './schema.service'

/**
 * 结构管理模块（P11 T102）：表/字段/关系 CRUD + 中间表生成 + schema 缓存。
 * 依赖 AdminModule 复用属主校验与 schema 失效口径。对外导出 SchemaService：
 * AppFacade（AI 工具）与 DataService（T103）复用同一实现。
 */
@Module({
  imports: [AdminModule],
  controllers: [SchemaController],
  providers: [SchemaService],
  exports: [SchemaService],
})
export class SchemaModule {}
