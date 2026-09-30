import { Module } from '@nestjs/common'
import { DisplayManageModule } from '../manage/display.module'
import { DisplayFacade } from './display-facade.service'

/**
 * display 域门面模块（P14 T125）：对外唯一出口（供 site 域开放层 / ai 域工具 / market 域物化注入）。
 * 依赖 DisplayManageModule（域内实现）；不反向依赖 site / app 域模块，无环。
 */
@Module({
  imports: [DisplayManageModule],
  providers: [DisplayFacade],
  exports: [DisplayFacade],
})
export class DisplayFacadeModule {}
