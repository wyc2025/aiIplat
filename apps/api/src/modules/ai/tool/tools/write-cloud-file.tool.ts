import type { CloudFacade } from '../../../cloud/facade/cloud-facade.service'
import { AI_CLOUD_WRITE_MAX_FILE_BYTES } from '../../../cloud/facade/cloud-facade.service'
import type { AiTool } from '../tool.types'
import { feedCloudError } from './list-cloud-files.tool'
import { readStrParam } from './tool-params'

const MAX_KB = Math.floor(AI_CLOUD_WRITE_MAX_FILE_BYTES / 1024)

/**
 * 写入我的云盘文件（write，确认卡；R63 摘要 = 路径 + 大小 + 覆盖与否）。
 * description 边界纪律（R63）：与 write_site_files 互写对方名字做排除式描述——
 * 本工具 = 云盘任意路径、不影响站点；write_site_files = 站点目录内的**工作文件**（对访客生效需先发布版本）。
 */
export function createWriteCloudFileTool(cloudFacade: CloudFacade): AiTool {
  return {
    name: 'write_cloud_file',
    title: '写入我的云盘文件',
    description:
      '在云盘里新建或覆盖**一个文本文件**。path 为相对云盘根的完整路径（如 notes/a.md、docs/x/y.txt），中间目录不存在会自动创建；同路径已存在同名文件时**温和覆盖**（旧文件移入回收站，可在回收站还原），同名文件夹存在则失败。' +
      `仅文本白名单扩展名（html/htm/css/js/mjs/txt/md/json/svg/xml/yml/yaml/csv），单文件内容 ≤${MAX_KB}KB。` +
      '本工具作用于**云盘任意路径、不影响任何线上站点**；若要修改个人站点的页面/样式/脚本（站点目录内的工作文件，对访客生效需先发布版本），请改用 write_site_files。',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '文件相对云盘根的路径（如 notes/a.md、docs/x/y.txt），禁止绝对路径与 ..',
        },
        content: {
          type: 'string',
          description: `完整文件内容（UTF-8 纯文本，单文件 ≤${MAX_KB}KB）`,
        },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
    perms: 'cloud:file:upload',
    risk: 'write',
    /**
     * 确认卡摘要（R63）：复用既有「文件清单」表格形态（path / action / size），
     * action 由父目录现状预判（created 新建 / overwritten 覆盖，覆盖时 size 取旧文件大小）。
     */
    summarize: async (params, ctx) => {
      const path = readStrParam(params, 'path')
      if (!path) return null
      const content = typeof params.content === 'string' ? params.content : ''
      const newSize = Buffer.byteLength(content, 'utf-8')

      const segments = path.split('/')
      const name = segments[segments.length - 1]
      const dir = segments.slice(0, -1).join('/')
      try {
        const listing = await cloudFacade.listUserFiles(BigInt(ctx.user.userId), {
          path: dir || undefined,
        })
        const hit = listing.items.find((item) => item.name === name)
        if (hit?.isDir) {
          return `⚠️ ${path} 已存在同名文件夹，写入会失败：请换文件名重试，或先用 move_cloud_files 移走该文件夹。`
        }
        return [{ path, action: hit ? 'overwritten' : 'created', size: hit ? hit.size : newSize }]
      } catch {
        // 父目录不存在（执行时会自动创建）→ 按新建处理
        return [{ path, action: 'created', size: newSize }]
      }
    },
    handler: async (ctx, params) => {
      const path = readStrParam(params, 'path') ?? ''
      const content = typeof params.content === 'string' ? params.content : ''
      try {
        return await cloudFacade.writeUserFile(BigInt(ctx.user.userId), path, content)
      } catch (e) {
        return feedCloudError(e)
      }
    },
  }
}
