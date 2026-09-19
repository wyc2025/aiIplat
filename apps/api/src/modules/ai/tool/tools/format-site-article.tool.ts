import { ErrorCode } from '../../../../common/constants/error-code'
import type { FormatOptionsDto } from '../../../site/article/dto/article-tools.dto'
import type { SiteFacade } from '../../../site/facade/site-facade.service'
import type { AiTool } from '../tool.types'
import { feedSiteError } from './list-site-files.tool'
import { readStrParam } from './tool-params'

/** 正文上限（与 FormatArticleDto 同口径：20 万字符） */
const CONTENT_MAX = 200000

/** 布尔档位安全取值（非布尔 → undefined，交给域内默认值兜底） */
function readBoolParam(params: Record<string, unknown>, key: string): boolean | undefined {
  const raw = params[key]
  return typeof raw === 'boolean' ? raw : undefined
}

/**
 * 一键排版（read，自动执行；P9 T92 / D79 / R79）。
 *
 * 包装 P8 的 markdown-format.ts（保护区机制 + 三档规则 + 幂等），**只排版不落库**；
 * 结果需用户确认后才由模型走 update_site_article 落库——本工具**不提供 diff 视图**，
 * 故 description 明确要求模型自行核对或复述 stats.rules，不得假装有 diff。
 */
export function createFormatSiteArticleTool(siteFacade: SiteFacade): AiTool {
  return {
    name: 'format_site_article',
    title: '排版文章正文',
    description:
      '对 markdown 正文做一键排版（三档可分别开关：结构规整 / 标点统一 / 中英文间距），返回**排版后全文** contentMd、是否改动 changed，以及 stats（命中规则 rules、行数、字数变化）。' +
      '**只排版、不落库、不改任何文章**；本工具不返回 diff 视图——请你自己核对前后差异，或直接向用户复述 stats.rules 说明改了哪些地方（不要声称有可视化对比）。' +
      '排版结果是否采用、以及是否保存到文章，由用户确认后再用 update_site_article 落库；' +
      '适合用于用户粘贴的草稿或 read_site_article 读到的正文。幂等：已规整的正文再排版 changed=false。',
    parameters: {
      type: 'object',
      properties: {
        contentMd: { type: 'string', description: '待排版的 markdown 正文（≤20 万字符）' },
        options: {
          type: 'object',
          description: '排版档位（缺省三档全开）',
          properties: {
            structure: { type: 'boolean', description: '结构规整（标题/引用/列表符号/围栏/块间空行）' },
            punctuation: { type: 'boolean', description: '标点与符号统一（强调符号、中文省略号）' },
            cjkSpacing: { type: 'boolean', description: '中英文/中文数字之间补空格（跳过代码与链接）' },
          },
          additionalProperties: false,
        },
      },
      required: ['contentMd'],
      additionalProperties: false,
    },
    perms: 'site:article:update',
    risk: 'read',
    handler: async (_ctx, params) => {
      const contentMd = readStrParam(params, 'contentMd')
      if (contentMd === undefined) {
        return { ok: false, errorCode: ErrorCode.ParamInvalid, message: '请提供待排版的正文 contentMd' }
      }
      if (contentMd.length > CONTENT_MAX) {
        return {
          ok: false,
          errorCode: ErrorCode.ParamInvalid,
          message: `正文不能超过 ${CONTENT_MAX} 字符（可分段排版）`,
        }
      }
      const rawOptions = params.options
      const source = rawOptions && typeof rawOptions === 'object' ? (rawOptions as Record<string, unknown>) : {}
      const options: FormatOptionsDto = {}
      const structure = readBoolParam(source, 'structure')
      const punctuation = readBoolParam(source, 'punctuation')
      const cjkSpacing = readBoolParam(source, 'cjkSpacing')
      if (structure !== undefined) options.structure = structure
      if (punctuation !== undefined) options.punctuation = punctuation
      if (cjkSpacing !== undefined) options.cjkSpacing = cjkSpacing
      try {
        const result = await siteFacade.formatArticle(
          contentMd,
          Object.keys(options).length > 0 ? options : undefined,
        )
        return { ok: true, ...result }
      } catch (e) {
        return feedSiteError(e)
      }
    },
  }
}
