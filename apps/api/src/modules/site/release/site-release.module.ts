import { Module } from '@nestjs/common'
import { StorageModule } from '../../../infra/storage/storage.module'
import { CloudModule } from '../../cloud/cloud.module'
import { DisplayFacadeModule } from '../../display/facade/display-facade.module'
import { SitePreviewService } from './site-preview.service'
import { SiteReleaseController } from './site-release.controller'
import { SiteReleaseService } from './site-release.service'

/**
 * 站点发布与版本管理模块（P19 T160/T161/T162）。
 *
 * 依赖：`StorageModule`（快照区读写：拷贝/rename/删树/出流）、`CloudModule`（工作副本路径解析，
 * 铁律 5：不直操 cloud_file）、`DisplayFacadeModule`（P20 B2：取「挂靠本站的展示应用工作区清单」
 * 以便聚合进快照）。
 *
 * **模块环的处理**（P20 T166）：本模块 import `DisplayFacadeModule`，其反向链
 * `display.facade → display.manage → SiteFacadeModule → SiteManageModule` 回指 site 域，
 * 因此 `SiteManageModule` **不得**再 import 本模块 —— 原先它是为 `purgeForSite` 而依赖；
 * 该清理已降为纯函数（`release-cleanup.util.ts`），故 `SiteManageService` 直接调用即可，环断开。
 *
 * 导出 `SiteReleaseService`：开放层（快照轨解析）消费。
 */
@Module({
  imports: [StorageModule, CloudModule, DisplayFacadeModule],
  controllers: [SiteReleaseController],
  providers: [SiteReleaseService, SitePreviewService],
  exports: [SiteReleaseService],
})
export class SiteReleaseModule {}
