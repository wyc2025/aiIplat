import { Injectable, type OnModuleInit } from '@nestjs/common'
import { CloudFacade } from '../../cloud/facade/cloud-facade.service'
import { CreditService } from '../credit/credit.service'
import { SiteFacade } from '../../site/facade/site-facade.service'
import { OnlineService } from '../../system/online/online.service'
import { RoleService } from '../../system/role/role.service'
import { UserService } from '../../system/user/user.service'
import { ToolRegistry } from './tool.registry'
import { createCreateSiteTool } from './tools/create-site.tool'
import { createGetMyCreditsTool } from './tools/get-my-credits.tool'
import { createGetMyProfileTool } from './tools/get-my-profile.tool'
import { createGetOnlineUsersTool } from './tools/get-online-users.tool'
import { createKickUserTool } from './tools/kick-user.tool'
import { createListRolesTool } from './tools/list-roles.tool'
import { createListSiteFilesTool } from './tools/list-site-files.tool'
import { createReadSiteFileTool } from './tools/read-site-file.tool'
import { createSearchUsersTool } from './tools/search-users.tool'
import { createUpdateMyProfileTool } from './tools/update-my-profile.tool'
import { createWriteSiteFilesTool } from './tools/write-site-files.tool'
// P5 T72：云盘五件套
import { createDeleteCloudFilesTool } from './tools/delete-cloud-files.tool'
import { createListCloudFilesTool } from './tools/list-cloud-files.tool'
import { createMoveCloudFilesTool } from './tools/move-cloud-files.tool'
import { createReadCloudFileTool } from './tools/read-cloud-file.tool'
import { createWriteCloudFileTool } from './tools/write-cloud-file.tool'
// P5 T73：站点 CMS 七件套
import { createCreateSiteArticleTool } from './tools/create-site-article.tool'
import { createEnsureSiteColumnTool } from './tools/ensure-site-column.tool'
import { createEnsureSiteTagsTool } from './tools/ensure-site-tags.tool'
import { createListSiteArticlesTool } from './tools/list-site-articles.tool'
import { createPublishSiteArticleTool } from './tools/publish-site-article.tool'
import { createReadSiteArticleTool } from './tools/read-site-article.tool'
import { createUpdateSiteArticleTool } from './tools/update-site-article.tool'
// P5 T74：站点生命周期两件套
import { createDeleteSiteTool } from './tools/delete-site.tool'
import { createUpdateSiteTool } from './tools/update-site.tool'

/**
 * 工具装配器：注入各域暴露的门面 Service，在模块启动时把 25 个工具注册到 ToolRegistry。
 * 新增工具 = tools/ 下加一个工厂 + 在此处 register。
 * 域门面纪律（见 ARCHITECTURE §12.3）：handler 只注入域 exports 的 Service，零跨域 import 内部实现——
 * 站点系列（文件三件套 + create_site + CMS 七件套 + 生命周期两件套）只注入 SiteFacade；
 * 云盘五件套只注入 CloudFacade（P5 T72 起）。
 */
@Injectable()
export class ToolBootstrap implements OnModuleInit {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly onlineService: OnlineService,
    private readonly userService: UserService,
    private readonly roleService: RoleService,
    private readonly creditService: CreditService,
    private readonly siteFacade: SiteFacade,
    private readonly cloudFacade: CloudFacade,
  ) {}

  onModuleInit(): void {
    // P2b 七个（系统/用户/角色/资料/积分）
    this.registry.register(createGetOnlineUsersTool(this.onlineService))
    this.registry.register(createKickUserTool(this.onlineService, this.userService))
    this.registry.register(createSearchUsersTool(this.userService))
    this.registry.register(createListRolesTool(this.roleService))
    this.registry.register(createGetMyProfileTool(this.userService))
    this.registry.register(createUpdateMyProfileTool(this.userService))
    this.registry.register(createGetMyCreditsTool(this.creditService))
    // P4b + P4E：站点文件三件套 + 建站
    this.registry.register(createListSiteFilesTool(this.siteFacade))
    this.registry.register(createReadSiteFileTool(this.siteFacade))
    this.registry.register(createWriteSiteFilesTool(this.siteFacade))
    this.registry.register(createCreateSiteTool(this.siteFacade))
    // P5 T72：云盘五件套（站点之外的能力盲区，R64）
    this.registry.register(createListCloudFilesTool(this.cloudFacade))
    this.registry.register(createReadCloudFileTool(this.cloudFacade))
    this.registry.register(createWriteCloudFileTool(this.cloudFacade))
    this.registry.register(createMoveCloudFilesTool(this.cloudFacade))
    this.registry.register(createDeleteCloudFilesTool(this.cloudFacade))
    // P5 T73：站点 CMS 七件套（代发内容语义，D63/R65）
    this.registry.register(createListSiteArticlesTool(this.siteFacade))
    this.registry.register(createReadSiteArticleTool(this.siteFacade))
    this.registry.register(createCreateSiteArticleTool(this.siteFacade))
    this.registry.register(createUpdateSiteArticleTool(this.siteFacade))
    this.registry.register(createPublishSiteArticleTool(this.siteFacade))
    this.registry.register(createEnsureSiteColumnTool(this.siteFacade))
    this.registry.register(createEnsureSiteTagsTool(this.siteFacade))
    // P5 T74：站点生命周期两件套（D64/R66）
    this.registry.register(createUpdateSiteTool(this.siteFacade))
    this.registry.register(createDeleteSiteTool(this.siteFacade))
  }
}
