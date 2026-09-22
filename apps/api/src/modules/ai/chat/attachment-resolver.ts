import * as iconv from 'iconv-lite'
import { ErrorCode } from '../../../common/constants/error-code'
import { BusinessException } from '../../../common/exceptions/business.exception'
import type { CloudFacade } from '../../cloud/facade/cloud-facade.service'

/**
 * AI 对话附件解析链（P10 T96 / D82 / D83 / D86 / R82 / R83）。
 *
 * 定位（ARCHITECTURE §26.2）：
 * - **不碰盘、不碰库**：字节与校验（属主/未删/非目录/白名单/体积）全部经 CloudFacade，域边界不破；
 * - 编码探测（UTF-8 剥 BOM 优先 → 替换字符多则 GBK 回取）属「文本语义」，与 P8 文章导入同口径，
 *   在 ai 域侧实现（跨域 import site 域内部文件违反铁律 6）；
 * - 分流（inject / listed）与注入文本组装是纯函数，便于核查与复用。
 *
 * 行业事实（PRD §1）：大模型 API 没有通用附件概念，文档须应用侧解析成文本注入；
 * 小文件全文注入（体验等同网页版），大文件登记清单由模型用 read_cloud_file 按需自读。
 */

/** D86 类型白名单（含 NUL 字节仍视为二进制拒绝） */
export const ATTACHMENT_ALLOWED_EXTS: ReadonlySet<string> = new Set([
  'txt',
  'md',
  'markdown',
  'json',
  'js',
  'ts',
  'jsx',
  'tsx',
  'vue',
  'css',
  'scss',
  'xml',
  'yml',
  'yaml',
  'log',
  'csv',
  'html',
  'htm',
  'py',
  'java',
  'go',
  'rs',
  'c',
  'cc',
  'cpp',
  'h',
  'hpp',
  'sql',
  'sh',
  'bat',
  'ini',
  'conf',
  'toml',
])

/** 单文件体积上限 2MB（D83，与 P8 文章导入口径一致） */
export const ATTACHMENT_MAX_BYTES = 2 * 1024 * 1024
/** 单条消息附件数量上限（D83） */
export const ATTACHMENT_MAX_COUNT = 5
/** inject 单文件字符阈值：≤ 此值可全文注入（D83） */
export const INJECT_MAX_FILE_CHARS = 30_000
/** inject 单条消息累计字符帽（D83） */
export const INJECT_MAX_TOTAL_CHARS = 60_000
/**
 * 截断注入的最小可注入余量（R83「总量帽内仍有空间的边缘情形」）：
 * 余量低于此值时不值得注入一段无意义的短尾巴，直接 listed 让模型自读。
 */
export const INJECT_TRUNCATE_MIN_CHARS = 1_000
/** 会话可读清单登记上限（R84，防爆） */
export const MANIFEST_MAX_ITEMS = 20
/** 二进制嗅探窗口 */
const BINARY_SNIFF_BYTES = 8_192
/** 注入块头部开销估算（`【附件 x】\n```\n` + `\n```` 换行，预算估算与清单渲染共用） */
const BLOCK_OVERHEAD = 16

/** 附件入参（chat DTO 透传，fileId 为云盘文件 id 字符串，避免 bigint 精度问题） */
export interface AttachmentInput {
  fileId: string
}

/** 附件模式：inject = 全文已注入；listed = 已列入可读清单，AI 按需自读（可能已截断预注入一段） */
export type AttachmentMode = 'inject' | 'listed'

/** 附件元信息（持久化到 ai_message.attachments，D82；**只存元信息不存内容**） */
export interface AttachmentMeta {
  fileId: string
  name: string
  ext: string
  size: number
  chars: number
  mode: AttachmentMode
  path: string
}

/** 解析结果（元信息 + 文本，文本仅内存传递，不落库） */
export interface ResolvedAttachment {
  meta: Omit<AttachmentMeta, 'mode'>
  text: string
}

/** 清单条目（会话可读清单渲染用） */
export interface ManifestEntry {
  fileId: string
  name: string
  path: string
  chars: number
  invalid: boolean
}

/**
 * 解析链主体（R82）：逐附件校验 → 读字节 → 二进制嗅探 → 编码探测 → 产出 { meta, text }。
 * 任一附件校验失败即抛 BusinessException（30001/30012/30013），由统一异常过滤转 JSON（不降级）。
 */
export async function resolveAttachments(
  cloudFacade: CloudFacade,
  userId: bigint,
  inputs: readonly AttachmentInput[],
): Promise<ResolvedAttachment[]> {
  if (inputs.length > ATTACHMENT_MAX_COUNT) {
    throw new BusinessException(ErrorCode.ParamInvalid, `单条消息附件不能超过 ${ATTACHMENT_MAX_COUNT} 个`)
  }

  const resolved: ResolvedAttachment[] = []
  for (const input of inputs) {
    const rawId = typeof input?.fileId === 'string' ? input.fileId.trim() : ''
    if (!/^\d+$/.test(rawId)) {
      throw new BusinessException(ErrorCode.ParamInvalid, '附件 fileId 非法')
    }
    const fileId = BigInt(rawId)

    // 属主 / 未删除 / 非目录 / 白名单（30012）/ ≤2MB（30013）——校验链在 cloud 域门面内完成
    const file = await cloudFacade.readTextFileById(userId, fileId, {
      exts: ATTACHMENT_ALLOWED_EXTS,
      maxBytes: ATTACHMENT_MAX_BYTES,
      purpose: '作为对话附件读取',
    })
    if (looksBinaryContent(file.content)) {
      throw new BusinessException(ErrorCode.CloudFileTypeNotAllowed, `附件「${file.name}」疑似二进制内容，暂不支持`)
    }

    const decoded = decodeAttachmentText(file.content)
    const path = (await cloudFacade.pathOfUserFile(userId, fileId)) ?? file.name
    resolved.push({
      meta: {
        fileId: file.id,
        name: file.name,
        ext: file.ext,
        size: file.size,
        chars: decoded.length,
        path,
      },
      text: decoded,
    })
  }
  return resolved
}

/**
 * 分流与注入组装（D83/R83）：按用户选择顺序逐条判定，产出元信息数组与注入文本。
 * - 单文件 ≤30,000 字符 **且** 本条累计 ≤60,000 字符 → inject（全文注入）；
 * - 大文件但累计帽内仍有 ≥1,000 字符余量 → **截断注入** + 同时进清单（mode=listed）；
 * - 其余 → listed（只登记，不注入）。
 */
export function planAttachmentModes(resolved: readonly ResolvedAttachment[]): {
  metas: AttachmentMeta[]
  injectedText: string
} {
  const metas: AttachmentMeta[] = []
  const blocks: string[] = []
  let used = 0

  for (const item of resolved) {
    const chars = item.text.length
    if (chars <= INJECT_MAX_FILE_CHARS && used + chars <= INJECT_MAX_TOTAL_CHARS) {
      metas.push({ ...item.meta, mode: 'inject' })
      blocks.push(buildInjectedBlock(item.meta.name, item.text))
      used += chars
      continue
    }

    const remaining = INJECT_MAX_TOTAL_CHARS - used
    if (chars > INJECT_MAX_FILE_CHARS && remaining >= INJECT_TRUNCATE_MIN_CHARS) {
      // 截断点 = min(单文件帽, 本条剩余帽)：单文件帽是「全文注入」的判据（>3 万即不全文注入），
      // 故截断注入最多给到单文件帽，避免「35000 字符文件被全量注入却标注已截断」的错误标注。
      const taken = Math.min(INJECT_MAX_FILE_CHARS, remaining)
      metas.push({ ...item.meta, chars, mode: 'listed' })
      blocks.push(buildTruncatedBlock(item.meta.name, item.meta.path, item.text.slice(0, taken)))
      used += taken
      continue
    }

    metas.push({ ...item.meta, mode: 'listed' })
  }

  return { metas, injectedText: blocks.join('\n\n') }
}

/** 全文注入块（R83：`【附件 {name}】` 头 + fenced code block 正文） */
export function buildInjectedBlock(name: string, text: string): string {
  return `【附件 ${name}】\n\`\`\`\n${text}\n\`\`\``
}

/** 截断注入块（R83：截断处标注，完整文件已列入可读清单） */
function buildTruncatedBlock(name: string, path: string, slice: string): string {
  return (
    `【附件 ${name}】\n\`\`\`\n${slice}\n\`\`\`\n` +
    `（已截断，完整文件已列入可读清单，路径 ${path}）`
  )
}

/** 失效附件占位（D82：源文件被删不报错不阻断，历史重组装时降级为占位） */
export function buildInvalidBlock(name: string): string {
  return `【附件 ${name}】（附件已失效）`
}

/**
 * 会话可读清单渲染（R84）：不计手册 2000 字帽，但登记上限 20 条防爆。
 * 文案固定「未读前不得猜测文件内容」，引导模型用 read_cloud_file 分段自读。
 */
export function renderAttachmentManifest(entries: readonly ManifestEntry[]): string {
  if (entries.length === 0) return ''
  const lines = entries.map((entry) => {
    const suffix = entry.invalid ? '，已失效' : ''
    return `- ${entry.path}（${entry.name}，${entry.chars} 字符${suffix}）`
  })
  return [
    '用户本会话附带文件（可用 read_cloud_file 按路径分段读取，单次 ≤2 万字符；未读前不得猜测文件内容）：',
    ...lines,
  ].join('\n')
}

/** 注入块的预算估算（历史消息装配时先判定预算、再决定是否读盘） */
export function estimateInjectedChars(meta: Pick<AttachmentMeta, 'chars' | 'name'>): number {
  return meta.chars + meta.name.length + BLOCK_OVERHEAD
}

/**
 * 读取消息附件元信息列（D82 持久化形状 → 结构体）。
 * JSON 列不可信（脏数据 / 未来字段演进 / 旧行为 null）→ 单项非法即丢弃，整体绝不让对话失败。
 */
export function parseStoredAttachments(raw: unknown): AttachmentMeta[] {
  if (!Array.isArray(raw)) return []
  const metas: AttachmentMeta[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const row = item as Partial<AttachmentMeta>
    if (typeof row.fileId !== 'string' || typeof row.name !== 'string' || typeof row.path !== 'string') continue
    metas.push({
      fileId: row.fileId,
      name: row.name,
      ext: typeof row.ext === 'string' ? row.ext : '',
      size: typeof row.size === 'number' ? row.size : 0,
      chars: typeof row.chars === 'number' ? row.chars : 0,
      mode: row.mode === 'listed' ? 'listed' : 'inject',
      path: row.path,
    })
  }
  return metas
}

/** 疑似二进制：窗口内出现 NUL 字节（D86） */
export function looksBinaryContent(buffer: Buffer): boolean {
  const end = Math.min(buffer.length, BINARY_SNIFF_BYTES)
  for (let i = 0; i < end; i += 1) {
    if (buffer[i] === 0x00) return true
  }
  return false
}

/**
 * 编码探测（D86，与 P8 §24.5 同口径）：UTF-8（剥 BOM）优先；
 * 解出替换字符（U+FFFD）时再用 GBK 试解，取替换字符更少的一方。
 */
export function decodeAttachmentText(buffer: Buffer): string {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3).toString('utf8')
  }
  const asUtf8 = buffer.toString('utf8')
  const utf8Bad = countReplacement(asUtf8)
  if (utf8Bad === 0) return asUtf8

  const asGbk = iconv.decode(buffer, 'gbk')
  return countReplacement(asGbk) < utf8Bad ? asGbk : asUtf8
}

/** 统计替换字符数量（编码不匹配的信号） */
function countReplacement(text: string): number {
  let count = 0
  for (const char of text) {
    if (char === '\uFFFD') count += 1
  }
  return count
}
