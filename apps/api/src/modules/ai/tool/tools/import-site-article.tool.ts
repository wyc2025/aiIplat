import { ErrorCode } from '../../../../common/constants/error-code'
import type { SiteFacade } from '../../../site/facade/site-facade.service'
import type { AiTool } from '../tool.types'
import { feedSiteError } from './list-site-files.tool'
import { readNumParam, readStrParam } from './tool-params'

/**
 * 导入文章文件（read，自动执行；P9 T92 / D79 / R79）。
 *
 * 包装 P8 已落地的纯解析模块（article-import.parser.ts，经 SiteFacade → articleService.importFromPath/File），
 * **工具内零业务逻辑复写**；只解析不落库、不出确认卡——落库由模型随后走 create_site_article（write，需确认）。
 *
 * 寻址（P9 实测修订）：**推荐 `path`** —— `list_cloud_files` 按设计只回 name/path、不回 id，
 * 若只收 fileId，模型列完目录也喂不进参数（首次 AI 冒烟实测卡在这一步）。
 * `fileId` 保留兼容（与 REST `{ fileId }` 契约一致），path 优先。
 */
export function createImportSiteArticleTool(siteFacade: SiteFacade): AiTool {
  return {
    name: 'import_site_article',
    title: '导入文章文件',
    description:
      '把**云盘里的 md / markdown / txt 文件**解析成文章素材：标题、markdown 正文、摘要、标签建议（matchedTags / unmatchedTags）、字数、编码与格式。' +
      '**只解析、不落库、不创建文章**：拿到结果后请把要点复述给用户（标题、字数、命中的标签），确认后再用 create_site_article 落库（默认草稿）。' +
      '文件用 `path` 指定（如 products/README.txt，由 list_cloud_files 取得，**推荐**），也可用 fileId（二选一，path 优先）；' +
      '文件须为本人未删除的 md/markdown/txt 且 ≤2MB（类型不符/超限/不存在都回喂可读原因）。' +
      '标签只做**匹配不创建**：matchedTags 可直接作为 create_site_article 的 tagNames 传回，unmatchedTags 需用户确认后再处理。',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '云盘相对路径（相对云盘根，如 docs/note.md、products/README.txt），由 list_cloud_files 获取',
        },
        fileId: { type: 'integer', description: '云盘文件 id（可选；与 path 二选一，path 优先）' },
      },
      additionalProperties: false,
    },
    perms: 'site:article:create',
    risk: 'read',
    handler: async (ctx, params) => {
      const path = readStrParam(params, 'path')
      const fileId = readNumParam(params, 'fileId')
      if (!path && (fileId === undefined || fileId < 1)) {
        return {
          ok: false,
          errorCode: ErrorCode.ParamInvalid,
          message: '请提供云盘文件 path（推荐，先用 list_cloud_files 查看）或 fileId',
        }
      }
      try {
        const result = await siteFacade.importArticle(
          BigInt(ctx.user.userId),
          path ? { path } : { fileId: BigInt(fileId as number) },
        )
        return { ok: true, ...result }
      } catch (e) {
        return feedSiteError(e)
      }
    },
  }
}
