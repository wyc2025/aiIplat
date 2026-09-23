import { Module } from '@nestjs/common'
import { AdminModule } from './admin/admin.module'
import { DataModule } from './data/data.module'
import { AppFacadeModule } from './facade/app-facade.module'
import { AppRefModule } from './facade/app-ref.module'
import { ImportModule } from './import/import.module'
import { PageModule } from './page/page.module'
import { SchemaModule } from './schema/schema.module'

/**
 * app 域聚合模块（P11「应用平台 · 数据应用 A 全链」）。
 *
 * 命名说明：类名用 AppDomainModule 而非 AppModule——避免与根模块 `src/app.module.ts`
 * 的 AppModule 同名冲突（同文件 import 会重复声明）。子域模块随 T101~T104 逐期加入：
 * admin（应用 CRUD，T101✓）/ schema（表字段关系，T102✓）/ data（沙箱数据服务，T103✓）/
 * import（CSV + 附件，T103✓）/ page（功能页，T104）。
 *
 * 对外契约：
 * - AppRefModule（最小，供 cloud 域删除预检注入）；
 * - AppFacadeModule（完整，供 ai 域工具注入）。
 */
@Module({
  imports: [
    AdminModule,
    SchemaModule,
    DataModule,
    ImportModule,
    PageModule,
    AppRefModule,
    AppFacadeModule,
  ],
  exports: [AppRefModule, AppFacadeModule],
})
export class AppDomainModule {}
