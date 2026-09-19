import { Injectable, Logger, type OnModuleInit } from '@nestjs/common'
import { CloudFacade } from '../../cloud/facade/cloud-facade.service'
import { CreditService } from '../credit/credit.service'
import { SiteFacade } from '../../site/facade/site-facade.service'
import { OnlineService } from '../../system/online/online.service'
import { RoleService } from '../../system/role/role.service'
import { UserService } from '../../system/user/user.service'
import { ToolRegistry } from './tool.registry'
import { checkToolGroupCoverage, groupedToolCount } from './tool.groups'
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
// P6 T78：评论三件套（代审 + 代回）
import { createAuditSiteCommentsTool } from './tools/audit-site-comments.tool'
import { createListSiteCommentsTool } from './tools/list-site-comments.tool'
import { createReplySiteCommentTool } from './tools/reply-site-comment.tool'
// P9 T92：文章导入 / 排版两件套（read 级：只解析/排版、不落库、不出确认卡）
import { createFormatSiteArticleTool } from './tools/format-site-article.tool'
import { createImportSiteArticleTool } from './tools/import-site-article.tool'

/**
 * 工具装配器：注入各域暴露的门面 Service，在模块启动时把注册表内全部工具（P9 起 30 个）注册到 ToolRegistry。
 * 新增工具 = tools/ 下加一个工厂 + 在此处 register + 在 tool.groups.ts 归组（R70）。
 * 域门面纪律（见 ARCHITECTURE §12.3）：handler 只注入域 exports 的 Service，零跨域 import 内部实现——
 * 站点系列（文件三件套 + create_site + CMS 七件套 + 评论三件套 + 生命周期两件套）只注入 SiteFacade；
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

  private readonly logger = new Logger(ToolBootstrap.name)

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
    // P6 T78：评论三件套（代审 list/audit + 代回 reply，D69/R71/R74）
    this.registry.register(createListSiteCommentsTool(this.siteFacade))
    this.registry.register(createAuditSiteCommentsTool(this.siteFacade))
    this.registry.register(createReplySiteCommentTool(this.siteFacade))
    // P9 T92：文章导入 + 排版两件套（D79/R79：包装 P8 纯函数，read 级，工具内零业务复写）
    this.registry.register(createImportSiteArticleTool(this.siteFacade))
    this.registry.register(createFormatSiteArticleTool(this.siteFacade))

    // P6 T77：工具归组校验（R70）——孤儿工具会让组路由漏发工具，启动即告警
    this.assertToolGroups()
  }

  /**
   * 分组覆盖校验（T77 验收 3）：注册表中的每个工具必须有组归属，分组表也不能登记不存在的工具。
   * 运行期只告警不中断（宁可多下发也不让服务起不来）；scripts/check-ai-prompt.ts 为硬失败版。
   */
  private assertToolGroups(): void {
    const names = this.registry.getAll().map((tool) => tool.name)
    const { orphans, stale } = checkToolGroupCoverage(names)
    if (orphans.length > 0) {
      this.logger.warn(
        `工具未归组（组路由会漏发，请在 tool.groups.ts 的 TOOL_GROUPS 中登记）：${orphans.join('、')}`,
      )
    }
    if (stale.length > 0) {
      this.logger.warn(`分组表登记了未注册的工具（请同步清理）：${stale.join('、')}`)
    }
    this.logger.log(`工具注册完成：${names.length} 个（分组覆盖 ${groupedToolCount()} 条）`)
  }
}
