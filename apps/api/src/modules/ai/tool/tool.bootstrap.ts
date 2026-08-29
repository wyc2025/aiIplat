import { Injectable, type OnModuleInit } from '@nestjs/common'
import { CreditService } from '../credit/credit.service'
import { SiteFacade } from '../../site/facade/site-facade.service'
import { OnlineService } from '../../system/online/online.service'
import { RoleService } from '../../system/role/role.service'
import { UserService } from '../../system/user/user.service'
import { ToolRegistry } from './tool.registry'
import { createGetOnlineUsersTool } from './tools/get-online-users.tool'
import { createKickUserTool } from './tools/kick-user.tool'
import { createSearchUsersTool } from './tools/search-users.tool'
import { createListRolesTool } from './tools/list-roles.tool'
import { createGetMyProfileTool } from './tools/get-my-profile.tool'
import { createUpdateMyProfileTool } from './tools/update-my-profile.tool'
import { createGetMyCreditsTool } from './tools/get-my-credits.tool'
import { createListSiteFilesTool } from './tools/list-site-files.tool'
import { createReadSiteFileTool } from './tools/read-site-file.tool'
import { createWriteSiteFilesTool } from './tools/write-site-files.tool'

/**
 * 工具装配器：注入各域暴露的 Service，在模块启动时把 10 个工具注册到 ToolRegistry。
 * 新增工具 = tools/ 下加一个工厂 + 在此处 register。
 * P4b 站点三件套只注入 site 域门面 SiteFacade（域门面纪律：零跨域 import 内部实现）。
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
  ) {}

  onModuleInit(): void {
    this.registry.register(createGetOnlineUsersTool(this.onlineService))
    this.registry.register(createKickUserTool(this.onlineService, this.userService))
    this.registry.register(createSearchUsersTool(this.userService))
    this.registry.register(createListRolesTool(this.roleService))
    this.registry.register(createGetMyProfileTool(this.userService))
    this.registry.register(createUpdateMyProfileTool(this.userService))
    this.registry.register(createGetMyCreditsTool(this.creditService))
    this.registry.register(createListSiteFilesTool(this.siteFacade))
    this.registry.register(createReadSiteFileTool(this.siteFacade))
    this.registry.register(createWriteSiteFilesTool(this.siteFacade))
  }
}
