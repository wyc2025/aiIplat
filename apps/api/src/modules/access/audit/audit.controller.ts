import { Controller, Get, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../../gateway/decorators/current-user.decorator'
import { AuditService } from './audit.service'
import { AuditQueryDto } from './dto/audit.dto'

/**
 * 接入审计检索端点（P15 T136，API-P15 §1-7 / §3.5）。
 *
 * 登录态自服务（无 `@RequirePermission`，照 display 先例）；**属主隔离**——只见自己的凭证流水
 * 与自己展示应用（匿名层）的流水。检索为只读，不挂 `@OperationLog`（与列表查询同口径）。
 */
@ApiTags('应用平台-接入审计')
@ApiBearerAuth()
@Controller('access/audits')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @ApiOperation({
    summary: '审计检索（?credentialId=&from=&to=&resultCode=&pageNo=&pageSize=；pageSize ≤50）',
  })
  search(@CurrentUser('userId') userId: string, @Query() query: AuditQueryDto) {
    return this.auditService.search(BigInt(userId), {
      ...(query.credentialId ? { credentialId: BigInt(query.credentialId) } : {}),
      ...(query.from ? { from: new Date(query.from) } : {}),
      ...(query.to ? { to: new Date(query.to) } : {}),
      ...(query.resultCode !== undefined ? { resultCode: query.resultCode } : {}),
      pageNo: query.pageNo ?? 1,
      pageSize: query.pageSize ?? 20,
    })
  }
}
