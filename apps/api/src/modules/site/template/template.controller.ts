import { Body, Controller, Get, Param, ParseIntPipe, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger'
import { CurrentUser } from '../../../gateway/decorators/current-user.decorator'
import { OperationLog } from '../../../gateway/decorators/operation-log.decorator'
import { RequirePermission } from '../../../gateway/decorators/require-permission.decorator'
import { ApplyTemplateDto } from './dto/template.dto'
import { SiteTemplateService, type SiteTemplateItem } from './template.service'

/**
 * 模板库读取（P4b T44）：`GET /api/site/templates`。
 * 模板库是**平台级静态资源**（读 assets/site-templates，与具体站点无关），故按命名空间规则
 * 留在 `/api/site/*` 顶层；站点级的「应用模板」见下方 SiteTemplateApplyController。
 */
@ApiTags('个人网站-模板库')
@ApiBearerAuth()
@Controller('site')
export class SiteTemplateController {
  constructor(private readonly templateService: SiteTemplateService) {}

  @Get('templates')
  @RequirePermission('site:site:manage')
  @ApiOperation({ summary: '模板列表（读 assets/site-templates，实时不缓存）' })
  listTemplates(): Promise<SiteTemplateItem[]> {
    return this.templateService.listTemplates()
  }
}

/**
 * 应用模板（P4b T44 → P4E T61 站点化 → T65 后收进 manage 命名空间）：
 * `POST /api/site/manage/:id/apply-template`，路径参数即目标站点。
 * 与列表分开成两个控制器，是为了「站点级写操作全在 `/api/site/manage/*`」的命名空间规则，
 * 同时避免把 SiteTemplateService 注入 manage 模块造成
 * SiteManageModule → SiteTemplateModule → SiteFacadeModule → SiteManageModule 的循环依赖。
 */
@ApiTags('个人网站-模板库')
@ApiBearerAuth()
@Controller('site/manage')
export class SiteTemplateApplyController {
  constructor(private readonly templateService: SiteTemplateService) {}

  @Post(':id/apply-template')
  @RequirePermission('site:site:manage')
  @OperationLog('个人网站', '应用模板')
  @ApiParam({ name: 'id', description: '站点 ID' })
  @ApiOperation({
    summary: '应用模板（温和覆盖：同名文件软删进回收站，media/ 与模板外文件不动）',
  })
  apply(
    @CurrentUser('userId') userId: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ApplyTemplateDto,
  ) {
    return this.templateService.applyTemplate(BigInt(userId), BigInt(id), dto)
  }
}
