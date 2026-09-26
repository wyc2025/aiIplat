import type { AppFacade } from '../../../app/facade/app-facade.service'
import type { AiTool } from '../tool.types'
import { feedAppError } from './app-error.util'

/**
 * 列出我的数据应用（**只读**，P12-PATCH2 T116 / R114 / D106）。
 *
 * 解决「模型不知道公开面 / 拿不到 pubCode」：一次性给出应用清单 + 公开态 + 公开凭证 + 发布缺项。
 * 纪律：
 * - **零参数、零写副作用**（risk=read，无 perms，不走确认卡）；
 * - **不代发布**：`missing` 非空时模型只做引导（去应用中心「公开」补齐缺项），发布/暴露写工具按 D106 归 P13；
 * - 数据经 AppFacade 取（铁律 6：AI 域不直读 app 表）。
 */
export function createListDataAppsTool(appFacade: AppFacade): AiTool {
  return {
    name: 'list_data_apps',
    title: '列出我的数据应用',
    description:
      '列出当前用户的全部数据应用：appCode、名称、状态（draft 草稿 / active 已入册）、' +
      'isPublic（是否已公开发布）、pubCode（公开只读凭证）、pubUrl（公开页链接）、' +
      'missing（发布缺项清单，如「至少需要 1 张已暴露的表」）。' +
      '拿到 pubCode 后可直接拼公开只读接口给站点页面取数（五端点清单与 fetch 示例见站点 README 的「数据应用公开接口」节）。' +
      'missing 非空 = 还不满足发布条件：**不要代发布**，把缺项原样告诉用户，并引导其到「应用中心 → 该应用 → 公开」按缺项补齐后自行开启。' +
      '本工具只读、零参数、不修改任何状态；建表/加字段/生成页面请用其它数据应用工具。',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
    risk: 'read',
    handler: async (ctx) => {
      try {
        return await appFacade.listDataApps(BigInt(ctx.user.userId))
      } catch (e) {
        return feedAppError(e)
      }
    },
  }
}
