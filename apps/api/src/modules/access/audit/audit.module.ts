import { Module } from '@nestjs/common'
import { AccessCleanTask } from './access-clean.task'
import { AuditController } from './audit.controller'
import { AuditInterceptor } from './audit.interceptor'
import { AuditService } from './audit.service'

/**
 * 审计子模块（P15 T136，D122/R135）。
 *
 * 导出 `AuditService`（`AccessFacade.writeAudit` 与 ext 拦截器消费）与 `AuditInterceptor`
 * （`ExtModule` 挂到对外四端点）。清理 cron 在本模块以 provider 形式注册（随 access 域加载）。
 */
@Module({
  controllers: [AuditController],
  providers: [AuditService, AuditInterceptor, AccessCleanTask],
  exports: [AuditService, AuditInterceptor],
})
export class AuditModule {}
