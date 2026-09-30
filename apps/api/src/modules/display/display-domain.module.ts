import { Module } from '@nestjs/common'
import { DisplayFacadeModule } from './facade/display-facade.module'
import { DisplayManageModule } from './manage/display.module'

/**
 * display 域聚合模块（P14「展示应用与数据授权」，ARCHITECTURE §30）。
 *
 * 域边界（铁律 3/6）：
 * - 本域**零跨域 import**（只经 CloudFacade / SiteFacade / AppFacade 三个门面）；
 * - 对外只经 `DisplayFacade`（site 域开放层 / ai 域工具 / market 域物化）；
 * - 两表 `disp_display` / `disp_grant` 无物理 FK，跨域禁 JOIN。
 */
@Module({
  imports: [DisplayManageModule, DisplayFacadeModule],
  exports: [DisplayFacadeModule],
})
export class DisplayDomainModule {}
