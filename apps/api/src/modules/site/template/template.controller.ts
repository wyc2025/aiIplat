import { Body, Controller, Get, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../../gateway/decorators/current-user.decorator'
import { OperationLog } from '../../../gateway/decorators/operation-log.decorator'
import { RequirePermission } from '../../../gateway/decorators/require-permission.decorator'
import { ApplyTemplateDto } from './dto/template.dto'
import { SiteTemplateService } from './template.service'

@ApiTags('个人网站-模板库')
@ApiBearerAuth()
@Controller('site')
export class SiteTemplateController {
  constructor(private readonly templateService: SiteTemplateService) {}

  @Get('templates')
  @RequirePermission('site:site:manage')
  @ApiOperation({ summary: '模板列表（读 assets/site-templates，实时不缓存）' })
  list() {
    return this.templateService.listTemplates()
  }

  @Post('mine/apply-template')
  @RequirePermission('site:site:manage')
  @OperationLog('个人网站', '应用模板')
  @ApiOperation({ summary: '应用模板（温和覆盖：同名文件软删进回收站，media/ 与模板外文件不动）' })
  apply(@CurrentUser('userId') userId: string, @Body() dto: ApplyTemplateDto) {
    return this.templateService.applyTemplate(BigInt(userId), dto)
  }
}
