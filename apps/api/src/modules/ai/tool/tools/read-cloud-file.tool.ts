import type { CloudFacade } from '../../../cloud/facade/cloud-facade.service'
import type { AiTool } from '../tool.types'
import { feedCloudError } from './list-cloud-files.tool'
import { readStrParam } from './tool-params'

/** 读取我的云盘文件（read，自动执行）；站点内文件走 read_site_file（description 边界纪律 R63） */
export function createReadCloudFileTool(cloudFacade: CloudFacade): AiTool {
  return {
    name: 'read_cloud_file',
    title: '读取我的云盘文件',
    description:
      '读取当前用户云盘内的一个文本文件内容。path 为相对云盘根的完整文件路径（如 notes/todo.md、docs/spec.txt）。' +
      '仅支持文本白名单扩展名（html/htm/css/js/mjs/txt/md/json/svg/xml/yml/yaml/csv），单文件 ≤64KB，超出或非文本会回喂错误。' +
      '**若目标文件位于个人站点目录内（路径第一段就是站点标识，或 list_cloud_files 中标 inSite=true），请改用 read_site_file**：站点工具按站点根寻址并校验站点属主，语义更准确。',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '文件相对云盘根的路径，如 notes/todo.md、docs/spec.txt（禁止绝对路径与 ..）',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
    perms: 'cloud:file:list',
    risk: 'read',
    handler: async (ctx, params) => {
      const path = readStrParam(params, 'path') ?? ''
      try {
        const result = await cloudFacade.readUserFile(BigInt(ctx.user.userId), path)
        return { path: result.path, size: result.size, content: result.content }
      } catch (e) {
        return feedCloudError(e)
      }
    },
  }
}
