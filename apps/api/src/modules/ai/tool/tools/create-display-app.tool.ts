import type { DisplayFacade } from '../../../display/facade/display-facade.service'
import type { AiTool } from '../tool.types'
import { feedDisplayError, readStr } from './display-error.util'

/**
 * 创建展示应用（write，P14 T130 / D112 / ARCHITECTURE §30.7 工具 42）。
 *
 * 展示应用 = AI 生成的**静态展示页**（HTML/CSS/JS）容器：默认落云盘暂存区，可挂靠到某个站点对外访问
 * （挂靠后入口 `/api/open/{slug}/disp/{id}/`）。文件由 `write_cloud_file` 写到 `writePath` 下
 * （建议 `index.html` 为入口），数据读取经 `authorize_data_app` 授权后，在页面内以同源相对路径
 * `./api/app/{appCode}/...` 调取数面（D123：取数按展示应用判定，非按站点）。
 */
export function createCreateDisplayAppTool(displayFacade: DisplayFacade): AiTool {
  return {
    name: 'create_display_app',
    title: '创建展示应用',
    description:
      '创建一个「展示应用」：用对话生成的静态展示页（HTML/CSS/JS）容器，可挂靠到站点上对外访问。' +
      'siteSlug 可选：填站点 slug 则创建即挂靠该站点（站点须是自己的）；不填则创建在云盘暂存区（稍后可换挂靠）。' +
      '创建成功后返回 writePath（写文件的云盘路径）与 urlPreview（挂靠后的访问入口）：' +
      '用 write_cloud_file 把页面文件写到 writePath 下（建议 index.html 作入口，页面内用相对路径引用素材），' +
      '再用 authorize_data_app 授权数据应用，页面内即可经同源相对路径读取该应用已暴露的数据（只读）。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '展示应用名（属主内唯一，≤40 字）' },
        siteSlug: { type: 'string', description: '挂靠站点 slug（可选；缺省 = 云盘暂存区）' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    risk: 'write',
    summarize: (params) => {
      const name = readStr(params, 'name')
      const siteSlug = readStr(params, 'siteSlug')
      return siteSlug
        ? `创建展示应用「${name}」并挂靠站点「${siteSlug}」`
        : `创建展示应用「${name}」（云盘暂存区，稍后可挂靠站点）`
    },
    handler: async (ctx, params) => {
      const name = readStr(params, 'name')
      if (!name) {
        return { ok: false, errorCode: 40001, message: 'name 必填' }
      }
      const siteSlug = readStr(params, 'siteSlug')
      try {
        const view = await displayFacade.createDisplay(BigInt(ctx.user.userId), {
          name,
          ...(siteSlug ? { siteSlug } : {}),
        })
        return {
          ok: true,
          id: view.id,
          name: view.name,
          siteSlug: view.siteSlug,
          writePath: view.writePath,
          urlPreview: view.urlPreview,
          nextSteps: [
            `用 write_cloud_file 把页面文件写到 ${view.writePath}/（建议 index.html）`,
            '需要数据时用 authorize_data_app 把数据应用授权给本展示应用（displayId=' + view.id + '）',
            view.siteSlug
              ? `挂靠已完成，文件写好即可访问 ${view.urlPreview}`
              : '当前在云盘暂存区（不对外访问）：挂靠站点后才可访问',
          ],
        }
      } catch (e) {
        return feedDisplayError(e)
      }
    },
  }
}
