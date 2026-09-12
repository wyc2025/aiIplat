import { Module } from '@nestjs/common'
import { SiteRootService } from './site-root.service'

/**
 * 站点根锚点查询独立模块（P4d T52）：
 * 对外暴露 SiteRootService 供 cloud 域 imports（cloud 需要判定 inSite / 站点根移动保护）。
 * 本模块零跨域 import（仅全局 PrismaService），故 cloud 域 import 它不会与 SiteFacadeModule
 * （依赖 CloudModule）构成循环依赖。
 */
@Module({
  providers: [SiteRootService],
  exports: [SiteRootService],
})
export class SiteRootModule {}
