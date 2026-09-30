import { Injectable } from '@nestjs/common'
import { AuditService, type AuditEntry } from '../audit/audit.service'

/**
 * access 域门面（P15 T136 / ARCHITECTURE-P15 §1）：跨域唯一出口（铁律 3/6）。
 *
 * 唯一消费方：**site 域开放层** —— 匿名层取数（`display` 主体）的审计埋点经 `writeAudit` 投递
 * （R135/R141：开放层不直读 `acc_audit`，也不自行实现审计链路；`AccessFacade` 是 access 域对外
 * 唯一跨域消费点）。下期 MCP 适配器（D129）复用 `ExtAuthGuard` / `QuotaInterceptor` /
 * `AuditInterceptor` 即可，无需新增门面方法。
 */
@Injectable()
export class AccessFacade {
  constructor(private readonly auditService: AuditService) {}

  /** 写一条审计（异步缓冲批量落表，不阻断取数；写库失败只记日志） */
  writeAudit(entry: AuditEntry): void {
    this.auditService.record(entry)
  }
}
