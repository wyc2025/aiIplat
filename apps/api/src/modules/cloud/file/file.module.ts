import { Module } from '@nestjs/common'
import { FileController } from './file.controller'
import { FileService } from './file.service'
import { StorageModule } from '../../../infra/storage/storage.module'
import { SiteRootModule } from '../../site/facade/site-root.module'

/**
 * 我的文件子模块。
 * imports SiteRootModule（site 域暴露的站点根锚点查询，P4d T52）：inSite 标记（R46）与
 * 站点根移动保护（R37）需要站点根 id，按域边界纪律经对方暴露的 Service 获取；
 * 该模块零跨域依赖，故与本域 FileModule 不成环（SiteFacadeModule 依赖 CloudModule 不可用于此）。
 */
@Module({
  imports: [StorageModule, SiteRootModule],
  controllers: [FileController],
  providers: [FileService],
  exports: [FileService],
})
export class FileModule {}
