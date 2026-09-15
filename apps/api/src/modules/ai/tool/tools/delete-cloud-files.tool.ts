import type { CloudFacade } from '../../../cloud/facade/cloud-facade.service'
import { AI_CLOUD_MAX_BATCH } from '../../../cloud/facade/cloud-facade.service'
import type { AiTool } from '../tool.types'
import { feedCloudError } from './list-cloud-files.tool'
import { readStrArrayParam } from './tool-params'

/**
 * 批量删除我的云盘文件（write，确认卡；R63 摘要 = 逐条路径 + 「进回收站可还原」）。
 * 仅软删（R64）：不物理删除、不释放配额，站点根 30020 拦截。
 */
export function createDeleteCloudFilesTool(cloudFacade: CloudFacade): AiTool {
  return {
    name: 'delete_cloud_files',
    title: '删除我的云盘文件',
    description:
      '批量删除云盘里的文件/文件夹（**仅移入回收站，不会物理删除**，用户可在「云盘 → 回收站」还原或彻底删除）。' +
      `每次 1~${AI_CLOUD_MAX_BATCH} 条，paths 为相对云盘根（以 / 分隔）的路径数组。` +
      '站点根目录不能直接删除（会返回错误，需用户到「个人网站 → 站点列表」删除站点）；文件夹整棵子树一并进回收站。' +
      '删除后站点目录内对应内容立即对访客不可见，请谨慎使用。',
    parameters: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          minItems: 1,
          maxItems: AI_CLOUD_MAX_BATCH,
          description: `待删除的相对路径清单（1~${AI_CLOUD_MAX_BATCH} 条），如 ["docs/old.md","tmp"]`,
          items: { type: 'string' },
        },
      },
      required: ['paths'],
      additionalProperties: false,
    },
    perms: 'cloud:file:delete',
    risk: 'write',
    /** 确认卡摘要（R63）：逐条路径 + 回收站可还原提示 */
    summarize: (params) => {
      const paths = readStrArrayParam(params, 'paths')
      if (paths.length === 0) return null
      return [
        `将删除 ${paths.length} 项（移入回收站，可还原）：`,
        ...paths.map((path, index) => `${index + 1}. ${path}`),
      ].join('\n')
    },
    handler: async (ctx, params) => {
      const paths = readStrArrayParam(params, 'paths')
      try {
        return await cloudFacade.deleteUserFiles(BigInt(ctx.user.userId), paths)
      } catch (e) {
        return feedCloudError(e)
      }
    },
  }
}
