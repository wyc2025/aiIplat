import { Module } from '@nestjs/common'
import { AdminModule } from '../admin/admin.module'
import { DataModule } from '../data/data.module'
import { SchemaModule } from '../schema/schema.module'
import { PageActionController, PageController } from './page.controller'
import { PageService } from './page.service'

/**
 * 功能页引擎模块（P11 T104）：page schema 存取 + 校验 + 动作事务执行。
 * 依赖 Admin（属主校验）/ Schema（表解析与 schema 缓存失效口径）/ Data（唯一写入口）。
 * 对外导出 PageService：AppFacade（AI 工具 gen_admin_page / adjust_page）复用。
 */
@Module({
  imports: [AdminModule, SchemaModule, DataModule],
  controllers: [PageController, PageActionController],
  providers: [PageService],
  exports: [PageService],
})
export class PageModule {}
