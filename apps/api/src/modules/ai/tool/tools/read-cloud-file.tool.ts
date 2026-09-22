import type { CloudFacade } from '../../../cloud/facade/cloud-facade.service'
import type { AiTool } from '../tool.types'
import { feedCloudError } from './list-cloud-files.tool'
import { readNumParam, readStrParam } from './tool-params'

/** 单次读取字符数默认值（P10 R85） */
const DEFAULT_MAX_CHARS = 20_000
/** 单次读取字符数上限（P10 R85，防模型一次拉爆上下文） */
const MAX_CHARS_LIMIT = 50_000

/**
 * 读取我的云盘文件（read，自动执行；站点内文件走 read_site_file，description 边界纪律 R63）。
 * P10 R85 起支持**分页**：offsetChars / maxChars 切片 + totalChars / truncated / nextOffset 回喂，
 * 引导模型「大文件分段自读」（附件清单场景 D83/R84 依赖此能力）。
 */
export function createReadCloudFileTool(cloudFacade: CloudFacade): AiTool {
  return {
    name: 'read_cloud_file',
    title: '读取我的云盘文件',
    description:
      '读取当前用户云盘内的一个文本文件内容。path 为相对云盘根的完整文件路径（如 notes/todo.md、docs/spec.txt）。' +
      '仅支持文本白名单扩展名（html/htm/css/js/mjs/txt/md/json/svg/xml/yml/yaml/csv），单文件 ≤2MB，超出或非文本会回喂错误。' +
      '**大文件请分段读取**：先读开头判断结构，若 truncated=true 表示还有未读内容，用返回的 nextOffset 作为 offsetChars 继续读（单次 maxChars 默认 2 万、上限 5 万字符）；' +
      'truncated=true 时**不得假定已读全文**，也不要凭空猜测未读部分。' +
      '**若目标文件位于个人站点目录内（路径第一段就是站点标识，或 list_cloud_files 中标 inSite=true），请改用 read_site_file**：站点工具按站点根寻址并校验站点属主，语义更准确。',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '文件相对云盘根的路径，如 notes/todo.md、docs/spec.txt（禁止绝对路径与 ..）',
        },
        offsetChars: {
          type: 'number',
          description: '起始字符偏移（默认 0）；续读时传上一次返回的 nextOffset',
        },
        maxChars: {
          type: 'number',
          description: '本次最多读取的字符数（默认 20000，上限 50000）',
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
        const totalChars = result.content.length
        const offset = Math.min(Math.max(readNumParam(params, 'offsetChars') ?? 0, 0), totalChars)
        const maxChars = Math.min(Math.max(readNumParam(params, 'maxChars') ?? DEFAULT_MAX_CHARS, 1), MAX_CHARS_LIMIT)
        const content = result.content.slice(offset, offset + maxChars)
        const truncated = offset + content.length < totalChars
        // 字段顺序刻意把「分页元信息」放前、`content` 放最后：
        // 工具留痕（ai_tool_call.result）只截断前 2000 字符，元信息前置才能在留痕与冒烟断言里可见。
        return {
          path: result.path,
          size: result.size,
          totalChars,
          offsetChars: offset,
          truncated,
          ...(truncated ? { nextOffset: offset + content.length } : {}),
          content,
        }
      } catch (e) {
        return feedCloudError(e)
      }
    },
  }
}
