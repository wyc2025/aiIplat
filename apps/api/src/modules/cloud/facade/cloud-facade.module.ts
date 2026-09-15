import { Module } from '@nestjs/common'
import { StorageModule } from '../../../infra/storage/storage.module'
import { SiteRootModule } from '../../site/facade/site-root.module'
import { FileModule } from '../file/file.module'
import { CloudFacade } from './cloud-facade.service'

/**
 * CloudFacade 独立模块（P4c T46，照 P4b T44 SiteFacadeModule 先例）：
 * 原 CloudFacade 注册在 CloudModule 聚合层，cloud 域内子模块（public）无法注入父聚合的 provider；
 * 独立成模块后 CloudPublicModule 可直接 imports 本模块（同域直注，无循环依赖）。
 * CloudModule 仍 re-export CloudFacade，对外契约（SiteOpenModule / SiteFacadeModule import CloudModule 注入
 * CloudFacade 的既有路径）不变。
 *
 * P5 T71：imports SiteRootModule 以注入 SiteRootService——云盘根基点列表需标注条目是否位于站点子树内
 * （inSite，R46/R51 同口径）。SiteRootModule 零跨域 import，不会成环（同 FileModule 既有做法）。
 */
@Module({
  imports: [StorageModule, FileModule, SiteRootModule],
  providers: [CloudFacade],
  exports: [CloudFacade],
})
export class CloudFacadeModule {}
