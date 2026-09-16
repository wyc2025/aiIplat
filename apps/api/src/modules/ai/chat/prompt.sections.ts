/**
 * system prompt 分段拼装（P6 T77 / D67，ARCHITECTURE §21.1）。
 *
 * system prompt = 助手设定（静态）
 *               + 通用版手册（静态，docs/PLATFORM-GUIDE.md，平台简介/角色与权限语义/通用规则/工具原则）
 *               + 能力清单（动态，按当前用户权限逐项注入，一行一项，capability.manifest.ts）
 *               + 用户上下文（昵称/角色/当前日期，现状不变）
 *
 * 分段字数阈值（scripts/check-ai-prompt.ts 机械核查，UTF-8 `[...text].length` 口径）：
 *   通用版 ≤1000 / 能力清单 ≤1200 / 总长 ≤2000。
 * 本文件只放纯函数与静态文案（零 Nest 依赖），供核查脚本直接 import（不启应用）。
 */

/** 助手设定（固定文案） */
export const ASSISTANT_IDENTITY =
  '你是 iplat 平台内置 AI 助手，可使用提供的工具帮助用户查询信息、操作系统。'

/** system prompt 分段（拼装顺序固定，不得调整） */
export interface SystemPromptParts {
  /** 通用版手册（静态段，读 docs/PLATFORM-GUIDE.md） */
  guide: string
  /** 能力清单段（动态段，按权限注入；无可用能力时传空串） */
  capabilityList: string
  /** 用户上下文段（昵称/角色/当前日期） */
  userContext: string
}

/** 分段拼装完整 system prompt（空段自动跳过，靠空行分隔） */
export function composeSystemPrompt(parts: SystemPromptParts): string {
  return [ASSISTANT_IDENTITY, parts.guide, parts.capabilityList, parts.userContext]
    .filter((segment) => segment && segment.trim().length > 0)
    .join('\n\n')
}

/** 分段字数统计口径（与手册核查脚本、PROGRESS 记录一致：按 UTF-8 字符数） */
export function textLength(text: string): number {
  return [...text].length
}
