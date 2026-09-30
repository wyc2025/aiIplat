import { Module } from '@nestjs/common'
import { AuditModule } from '../audit/audit.module'
import { AccessFacade } from './access-facade.service'

/**
 * access 域门面模块（P15 T136）：对外唯一出口，供 site 域开放层注入（匿名层取数埋点）。
 * 依赖 `AuditModule`（域内实现）；不反向依赖 site / app / display 域模块，无环。
 */
@Module({
  imports: [AuditModule],
  providers: [AccessFacade],
  exports: [AccessFacade],
})
export class AccessFacadeModule {}
