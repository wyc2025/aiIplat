import type { CloudFacade } from '../../../cloud/facade/cloud-facade.service'
import { AI_CLOUD_MAX_BATCH } from '../../../cloud/facade/cloud-facade.service'
import type { AiTool } from '../tool.types'
import { feedCloudError } from './list-cloud-files.tool'

/** 入参整形：模型可能给出畸形条目，逐项安全取值 */
function toMovesParam(raw: unknown): Array<{ from: string; to: string }> {
  const arr = Array.isArray(raw) ? raw : []
  return arr.map((item) => {
    const row = (item ?? {}) as Record<string, unknown>
    return {
      from: typeof row.from === 'string' ? row.from.trim() : '',
      to: typeof row.to === 'string' ? row.to.trim() : '',
    }
  })
}

/**
 * 批量移动我的云盘文件/文件夹（write，确认卡；R63 摘要 = 逐条 from→to + 公开目录标注）。
 * to 语义 = 目标目录路径（保留原文件名移入），目录不存在自动 mkdir -p（R64）。
 */
export function createMoveCloudFilesTool(cloudFacade: CloudFacade): AiTool {
  return {
    name: 'move_cloud_files',
    title: '移动我的云盘文件',
    description:
      '批量移动云盘里的文件/文件夹。每次 1~' +
      `${AI_CLOUD_MAX_BATCH} 条，每条给出 from（源相对路径，文件或文件夹）与 to（**目标目录**相对路径，保留原文件名移入；目录不存在会自动创建，to 传空串表示移到云盘根）。` +
      '同名冲突时自动追加 "(1)"。站点根目录不可移动、不能移入自身或其子目录、回收站中的项不可移动（都会逐条返回错误）。' +
      '若目标目录处于公开状态，结果中会标注 targetPublic=true（该内容将对外可见）。仅影响云盘文件位置，不修改文件内容。',
    parameters: {
      type: 'object',
      properties: {
        moves: {
          type: 'array',
          minItems: 1,
          maxItems: AI_CLOUD_MAX_BATCH,
          description:
            '待移动清单（1~' +
            `${AI_CLOUD_MAX_BATCH} 条）：from = 源相对路径，to = 目标目录相对路径（空串 = 云盘根）`,
          items: {
            type: 'object',
            properties: {
              from: { type: 'string', description: '源文件/文件夹的相对路径，如 docs/a.md' },
              to: { type: 'string', description: '目标目录的相对路径，如 backup、archive/2024；空串表示移到云盘根' },
            },
            required: ['from', 'to'],
            additionalProperties: false,
          },
        },
      },
      required: ['moves'],
      additionalProperties: false,
    },
    perms: 'cloud:file:upload',
    risk: 'write',
    /** 确认卡摘要（R63）：逐条 from → to，目标在公开目录的条目单独标注（R39 提示不阻断执行） */
    summarize: async (params, ctx) => {
      const moves = toMovesParam(params.moves)
      if (moves.length === 0) return null
      const userId = BigInt(ctx.user.userId)
      const lines: string[] = [`将移动 ${moves.length} 项：`]
      try {
        for (const [index, move] of moves.entries()) {
          const targetPublic = move.to
            ? await cloudFacade.isUserDirPublic(userId, move.to)
            : false
          const target = move.to === '' ? '云盘根目录' : move.to
          lines.push(
            `${index + 1}. ${move.from} → ${target}${targetPublic ? '（目标在公开目录，内容将对外可见）' : ''}`,
          )
        }
      } catch {
        return null
      }
      return lines.join('\n')
    },
    handler: async (ctx, params) => {
      const moves = toMovesParam(params.moves)
      try {
        return await cloudFacade.moveUserFiles(BigInt(ctx.user.userId), moves)
      } catch (e) {
        return feedCloudError(e)
      }
    },
  }
}
