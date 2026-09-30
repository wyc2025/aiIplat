import { Module } from '@nestjs/common'
import { QuotaInterceptor } from './quota.interceptor'
import { QuotaService } from './quota.service'

/**
 * 配额子模块（P15 T136，D121/R134）。
 *
 * 导出 `QuotaService`（凭证列表回填当日用量）与 `QuotaInterceptor`（`ExtModule` 挂到对外四端点）。
 * 匿名层既有「60 次/分/IP」限流在 site 域保留不动，与本模块是两层（R134）。
 */
@Module({
  providers: [QuotaService, QuotaInterceptor],
  exports: [QuotaService, QuotaInterceptor],
})
export class QuotaModule {}
