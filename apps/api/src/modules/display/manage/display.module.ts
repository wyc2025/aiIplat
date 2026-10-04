import { Module } from '@nestjs/common'
import { StorageModule } from '../../../infra/storage/storage.module'
import { AppFacadeModule } from '../../app/facade/app-facade.module'
import { CloudFacadeModule } from '../../cloud/facade/cloud-facade.module'
import { SiteFacadeModule } from '../../site/facade/site-facade.module'
import { DisplayReleaseController } from './display-release.controller'
import { DisplayReleaseService } from './display-release.service'
import { DisplayController } from './display.controller'
import { DisplayService } from './display.service'

/**
 * display 域实现模块（P14 T125）：展示应用 CRUD + 挂靠 + 授权 + 开放层支撑。
 *
 * 跨域依赖全部走门面（铁律 3/6）：
 * - `CloudFacadeModule`：目录物理移动 / 存在性判定（机械原语）；
 * - `SiteFacadeModule`：站点解析（slug → id/名）与属主校验；
 * - `AppFacadeModule`：数据应用属主校验、appId 解析与取数面缓存失效。
 *
 * 防环：三者均不依赖本模块（site 开放层依赖的是 DisplayFacadeModule，而非本模块）。
 */
@Module({
  imports: [StorageModule, CloudFacadeModule, SiteFacadeModule, AppFacadeModule],
  controllers: [DisplayController, DisplayReleaseController],
  providers: [DisplayService, DisplayReleaseService],
  exports: [DisplayService, DisplayReleaseService],
})
export class DisplayManageModule {}
