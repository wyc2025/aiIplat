import type { AppFacade } from '../../../app/facade/app-facade.service'
import type { DisplayFacade } from '../../../display/facade/display-facade.service'
import type { AiTool } from '../tool.types'
import { feedAppError } from './app-error.util'

/**
 * 列出我的数据应用与展示应用（**只读**，P12-PATCH2 T116 建 / P14 T130 改授权口径）。
 *
 * 解决「模型不知道读取前置链」：一次给出
 * ① 应用清单（可被授权读取开关 + 发布缺项 + 已授权的展示应用）与
 * ② 展示应用清单（id / 名称 / 挂靠站点 / 入口 + 已授权应用），使 `authorize_data_app` 能直接取 displayId。
 * 纪律：
 * - **零参数、零写副作用**（risk=read，无 perms，不走确认卡）；
 * - **不代发布/不代授权**：`missing` 非空时模型只做引导；
 * - 数据经 AppFacade 与 DisplayFacade 取（铁律 6：AI 域不直读 app / display 表）。
 */
export function createListDataAppsTool(appFacade: AppFacade, displayFacade: DisplayFacade): AiTool {
  return {
    name: 'list_data_apps',
    title: '列出我的数据应用与展示应用',
    description:
      '列出当前用户的全部数据应用与展示应用：' +
      'apps[] 每项含 appCode、名称、status（draft/active）、isPublic（是否已开启可被授权读取）、' +
      'missing（发布缺项清单）、grantedDisplays（已授权读取该应用的展示应用）；' +
      'displayApps[] 每项含 id（授权时用）、名称、siteSlug（挂靠站点，null=未挂靠则不对外）、urlPreview、grantedApps（已授权的应用 code）。' +
      '展示应用页面读取数据的完整前置链：展示应用已挂靠站点 → authorize_data_app 授权 → publish_data_app 开启 isPublic → ' +
      'expose_data_app 暴露表/字段（缺一，取数即 40400）。' +
      'missing 非空 = 还不满足读取条件：**不要代发布**，把缺项原样告诉用户并引导补齐。',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
    risk: 'read',
    handler: async (ctx) => {
      try {
        const userId = BigInt(ctx.user.userId)
        const [apps, displays] = await Promise.all([
          appFacade.listDataApps(userId),
          displayFacade.listDisplays(userId),
        ])
        const displayItems = displays.map((display) => ({
          id: display.id,
          name: display.name,
          siteSlug: display.siteSlug,
          urlPreview: display.urlPreview,
          grantedApps: display.grants.map((grant) => grant.appCode),
        }))
        return {
          ok: true,
          apps: apps.apps.map((app) => ({
            ...app,
            grantedDisplays: displayItems.filter((item) => item.grantedApps.includes(app.appCode)),
          })),
          displayApps: displayItems,
        }
      } catch (e) {
        return feedAppError(e)
      }
    },
  }
}
