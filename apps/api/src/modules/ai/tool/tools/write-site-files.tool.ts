import type { SiteFacade } from '../../../site/facade/site-facade.service'
import type { AiTool } from '../tool.types'
import { feedSiteError } from './list-site-files.tool'

/** 入参整形：模型可能给出畸形条目，逐项安全取值（畸形项经 SiteFacade 校验回喂 per-file error） */
function toFilesParam(raw: unknown): Array<{ path: string; content: string }> {
  const arr = Array.isArray(raw) ? raw : []
  return arr.map((f) => ({
    path: f && typeof (f as Record<string, unknown>).path === 'string' ? ((f as Record<string, unknown>).path as string) : '',
    content:
      f && typeof (f as Record<string, unknown>).content === 'string'
        ? ((f as Record<string, unknown>).content as string)
        : '',
  }))
}

/**
 * 批量写入我的站点文件（write，site:site:manage，走确认卡）。
 * 站点语义校验与逐文件机械写入都在 SiteFacade.writeFiles（部分成功语义 R18）：
 * - 顶层门禁失败（未开通 40101 / 单次 >10 个 40115）→ { ok:false, errorCode, message } 回喂
 * - 逐文件失败（路径 40113 / 白名单 40114 / 大小 40115 / cloud 段 30001/30003/30006）
 *   → 该项 { ok:false, error } 记入明细，其余文件不受影响
 */
export function createWriteSiteFilesTool(siteFacade: SiteFacade): AiTool {
  return {
    name: 'write_site_files',
    title: '写入我的站点文件',
    description:
      '批量写入当前用户自己的个人站点文件（站点根 = 云盘「我的站点」目录）。' +
      '改写站点前先 read_site_file("README.txt") 了解开放 API 契约；' +
      '若 README.txt 不存在（P4a 旧站点），按 PLATFORM-GUIDE 摘要保守操作。' +
      '同路径已存在文件会被覆盖（旧版进回收站可还原）；本工具需用户确认后才会执行；' +
      '只能写文本文件，图片等二进制资源写不了——需要图片时引导用户在云盘页手动上传到 media/ 目录。' +
      '单次 1~10 个文件（每批一张确认卡），需写更多请分批调用，不要试图一轮塞完。',
    parameters: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          minItems: 1,
          maxItems: 10,
          description:
            '本次写入的文件列表（1~10 个）。仅文本白名单扩展名：html/htm/css/js/mjs/txt/md/json/svg/xml/yml/yaml/csv',
          items: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: '站点根相对路径（如 index.html、pages/about.html），禁止绝对路径与 ..',
              },
              content: {
                type: 'string',
                description: '完整文件内容（UTF-8 文本，单文件 ≤256KB）',
              },
            },
            required: ['path', 'content'],
            additionalProperties: false,
          },
        },
      },
      required: ['files'],
      additionalProperties: false,
    },
    perms: 'site:site:manage',
    risk: 'write',
    /**
     * 确认卡结构化摘要（P4b §15.6）：复用 listFiles（属主视角文件树，只读）逐路径预判
     * action——树中已存在同名文件 → overwritten（带旧文件大小），否则 created（带入参内容字节大小）。
     * 未开通站点 / 无有效文件 / 查询失败 → 返回 null，chat.service 回退 P2b 字符串摘要。
     * action 为预判，以执行结果为准（前端卡片已标注）。
     */
    summarize: async (params, ctx) => {
      const files = toFilesParam(params.files)
      if (files.length === 0) return null
      try {
        const tree = await siteFacade.listFiles(BigInt(ctx.user.userId))
        if (!tree) return null
        const known = new Map(tree.files.filter((f) => !f.isDir).map((f) => [f.path, f.size]))
        return files.map((f) => {
          const oldSize = known.get(f.path)
          return oldSize !== undefined
            ? { path: f.path, action: 'overwritten', size: oldSize }
            : { path: f.path, action: 'created', size: Buffer.byteLength(f.content, 'utf-8') }
        })
      } catch {
        return null
      }
    },
    handler: async (ctx, params) => {
      const files = toFilesParam(params.files)
      try {
        const results = await siteFacade.writeFiles(BigInt(ctx.user.userId), files)
        // 部分成功语义：逐文件明细数组回喂（§15.2 契约形态）
        return results
      } catch (e) {
        return feedSiteError(e)
      }
    },
  }
}
