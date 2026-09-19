import { ErrorCode } from '../../../../common/constants/error-code'
import type { SiteFacade } from '../../../site/facade/site-facade.service'
import type { AiTool } from '../tool.types'
import { feedSiteError } from './list-site-files.tool'
import { readNumParam } from './tool-params'

/**
 * 导入文章文件（read，自动执行；P9 T92 / D79 / R79）。
 *
 * 包装 P8 已落地的纯解析模块（article-import.parser.ts，经 SiteFacade → articleService.importFromFile），
 * **工具内零业务逻辑复写**；只解析不落库、不出确认卡——落库由模型随后走 create_site_article（write，需确认）。
 */
export function createImportSiteArticleTool(siteFacade: SiteFacade): AiTool {
  return {
    name: 'import_site_article',
    title: '导入文章文件',
    description:
      '把**云盘里的 md / markdown / txt 文件**解析成文章素材：标题、markdown 正文、摘要、标签建议（matchedTags / unmatchedTags）、字数、编码与格式。' +
      '**只解析、不落库、不创建文章**：拿到结果后请把要点复述给用户（标题、字数、命中的标签），确认后再用 create_site_article 落库（默认草稿）。' +
      'fileId 需先用 list_cloud_files 取得；文件须为本人未删除的 md/markdown/txt 且 ≤2MB（解析不出内容时回喂原因）。' +
      '标签只做**匹配不创建**：matchedTags 可直接作为 create_site_article 的 tagNames 传回，unmatchedTags 需用户确认后再处理。',
    parameters: {
      type: 'object',
      properties: {
        fileId: { type: 'integer', description: '云盘文件 id（从 list_cloud_files 获取）' },
      },
      required: ['fileId'],
      additionalProperties: false,
    },
    perms: 'site:article:create',
    risk: 'read',
    handler: async (ctx, params) => {
      const fileId = readNumParam(params, 'fileId')
      if (fileId === undefined || fileId < 1) {
        return {
          ok: false,
          errorCode: ErrorCode.ParamInvalid,
          message: '请提供云盘文件 id（fileId，可用 list_cloud_files 获取）',
        }
      }
      try {
        const result = await siteFacade.importArticle(BigInt(ctx.user.userId), BigInt(fileId))
        return { ok: true, ...result }
      } catch (e) {
        return feedSiteError(e)
      }
    },
  }
}
