import * as iconv from 'iconv-lite'

/**
 * 文章导入解析器（P8 T88）：把 Markdown / 纯文本文件解析成"可填充表单"的字段。
 *
 * 定位与约束：
 * - **纯函数、零 Nest 依赖**（便于单测；将来 AI 工具可复用同一份解析口径）；
 * - **只解析不落库**：返回 title / contentMd / summary / tagNames，由前端填入表单、用户确认后再保存；
 * - 本期只支持 Markdown 与 TXT（决策见 PROGRESS P8）；HTML/DOCX 需转换器或新依赖，未纳入。
 * - 标签只回**名称**，由 Service 匹配平台已有标签；不自动创建标签（避免导入动作产生意外数据）。
 */

/** 允许导入的扩展名 */
export const IMPORT_ALLOWED_EXTS: ReadonlySet<string> = new Set(['md', 'markdown', 'txt'])

/** 导入体积上限（与文本预览口径一致：2MB） */
export const IMPORT_MAX_BYTES = 2 * 1024 * 1024

/** 标签名数量上限（与平台标签上限一致） */
const MAX_TAG_NAMES = 20

/** TXT 首行作为标题时的最大长度 */
const TXT_TITLE_MAX = 60

/** 标题上限（与文章标题 1~100 字一致，超出即截断并告警） */
const TITLE_MAX = 100

/** 二进制嗅探窗口 */
const BINARY_SNIFF_BYTES = 8192

/** 解析失败（纯函数不依赖 Nest 异常；由 Service 转 BusinessException） */
export class ImportParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImportParseError'
  }
}

/** 解析结果 */
export interface ImportParseResult {
  title: string
  contentMd: string
  summary: string
  tagNames: string[]
  warnings: string[]
  meta: {
    filename: string
    ext: string
    size: number
    encoding: 'utf8' | 'gbk'
    format: 'markdown' | 'text'
  }
}

interface FrontMatter {
  title?: string
  summary?: string
  tags: string[]
}

/**
 * 解析入口：入参是云盘读出的**原始字节**（编码探测在本模块完成，cloud 域只负责给字节）。
 * 失败抛 ImportParseError（消息可直接展示给用户）。
 */
export function parseArticleFile(buffer: Buffer, filename: string): ImportParseResult {
  const ext = extOf(filename)
  if (!IMPORT_ALLOWED_EXTS.has(ext)) {
    throw new ImportParseError('仅支持 .md / .markdown / .txt 文件，请先另存为 Markdown 或文本')
  }
  if (buffer.length === 0) {
    throw new ImportParseError('文件内容为空')
  }
  if (buffer.length > IMPORT_MAX_BYTES) {
    throw new ImportParseError(`文件超过 ${Math.round(IMPORT_MAX_BYTES / 1024 / 1024)}MB，请拆分后再导入`)
  }
  if (looksBinary(buffer)) {
    throw new ImportParseError('文件疑似二进制内容，无法按文本解析')
  }

  const warnings: string[] = []
  const decoded = decodeText(buffer)
  if (decoded.encoding === 'gbk') {
    warnings.push('文件不是 UTF-8 编码，已按 GBK 解码，请核对正文中的特殊字符')
  }
  if (decoded.replaced > 0) {
    warnings.push(`正文中有 ${decoded.replaced} 个无法识别的字符（可能是编码不匹配）`)
  }

  const normalized = normalizeText(decoded.text)
  const format: 'markdown' | 'text' = ext === 'txt' ? 'text' : 'markdown'
  const parsed =
    format === 'markdown' ? parseMarkdown(normalized, warnings) : parsePlainText(normalized, filename, warnings)

  let title = parsed.title.trim()
  if (title.length > TITLE_MAX) {
    warnings.push(`标题超过 ${TITLE_MAX} 字，已截断`)
    title = title.slice(0, TITLE_MAX)
  }
  if (title === '') {
    title = baseName(filename)
    warnings.push(`未识别到标题，已使用文件名「${title}」`)
  }

  const contentMd = parsed.contentMd.trim() === '' ? '' : `${parsed.contentMd.trimEnd()}\n`
  if (contentMd === '') {
    warnings.push('解析后正文为空，请确认文件内容')
  }

  return {
    title,
    contentMd,
    summary: parsed.summary,
    tagNames: parsed.tagNames,
    warnings,
    meta: { filename, ext, size: buffer.length, encoding: decoded.encoding, format },
  }
}

/** 扩展名（小写、不含点；无扩展名返回空串） */
function extOf(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return ''
  return base.slice(dot + 1).toLowerCase()
}

/** 去目录与扩展名的文件名（标题兜底用） */
function baseName(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}

/** 疑似二进制：窗口内出现 NUL 字节 */
function looksBinary(buffer: Buffer): boolean {
  const end = Math.min(buffer.length, BINARY_SNIFF_BYTES)
  for (let i = 0; i < end; i += 1) {
    if (buffer[i] === 0x00) return true
  }
  return false
}

/**
 * 编码探测：优先 UTF-8（含 BOM 剥离）；若解出替换字符（U+FFFD），
 * 再用 GBK 试解并比较替换字符数量，取更少的一方（国内写作常见 GBK 文本文件）。
 */
function decodeText(buffer: Buffer): { text: string; encoding: 'utf8' | 'gbk'; replaced: number } {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { text: buffer.subarray(3).toString('utf8'), encoding: 'utf8', replaced: 0 }
  }
  const asUtf8 = buffer.toString('utf8')
  const utf8Bad = countReplacement(asUtf8)
  if (utf8Bad === 0) return { text: asUtf8, encoding: 'utf8', replaced: 0 }

  const asGbk = iconv.decode(buffer, 'gbk')
  const gbkBad = countReplacement(asGbk)
  return gbkBad < utf8Bad
    ? { text: asGbk, encoding: 'gbk', replaced: gbkBad }
    : { text: asUtf8, encoding: 'utf8', replaced: utf8Bad }
}

/** 统计替换字符数量（编码不匹配的信号） */
function countReplacement(text: string): number {
  let count = 0
  for (const char of text) {
    if (char === '\uFFFD') count += 1
  }
  return count
}

/** 文本归一化：统一换行、去掉首尾空行（不 trim 行内空白，保留作者排版） */
function normalizeText(text: string): string {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '')
}

/** Markdown 解析：front-matter → 标题 → 正文 */
function parseMarkdown(text: string, warnings: string[]): { title: string; contentMd: string; summary: string; tagNames: string[] } {
  const { meta, body } = splitFrontMatter(text, warnings)
  const { title, body: content } = extractTitle(body, meta.title, warnings)
  return { title, contentMd: content, summary: meta.summary ?? '', tagNames: meta.tags }
}

/** 纯文本解析：首行像标题就当标题（并从正文移除），否则标题交给文件名兜底 */
function parsePlainText(
  text: string,
  _filename: string,
  _warnings: string[],
): { title: string; contentMd: string; summary: string; tagNames: string[] } {
  const lines = text.split('\n')
  const first = (lines[0] ?? '').trim()
  const ENDING_PUNCT = /[。，,.!?！？;；:：、…]$/
  const looksLikeTitle = first.length > 0 && first.length <= TXT_TITLE_MAX && !ENDING_PUNCT.test(first)
  if (!looksLikeTitle) {
    return { title: '', contentMd: text, summary: '', tagNames: [] }
  }
  const rest = lines.slice(1).join('\n').replace(/^\n+/, '')
  return { title: first, contentMd: rest, summary: '', tagNames: [] }
}

/**
 * 解析 YAML front-matter（仅支持平台需要的子集）：
 * `title` / `summary|description|excerpt` / `tags`（支持 `[a, b]`、`a, b` 与 `- a` 列表三种写法）。
 * 解析不了的行只告警并忽略，不影响导入（不做严格 YAML 校验）。
 */
function splitFrontMatter(text: string, warnings: string[]): { meta: FrontMatter; body: string } {
  const meta: FrontMatter = { tags: [] }
  const match = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(text)
  if (!match) return { meta, body: text }

  const body = text.slice(match[0].length)
  let currentKey = ''
  for (const raw of match[1].split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue

    const listItem = /^-\s*(.+)$/.exec(line)
    if (listItem && currentKey === 'tags') {
      pushTags(meta.tags, listItem[1])
      continue
    }

    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line)
    if (!kv) {
      warnings.push(`front-matter 有一行无法解析（已忽略）：${line.slice(0, 40)}`)
      continue
    }
    const key = kv[1].toLowerCase()
    const value = stripQuotes(kv[2].trim())
    currentKey = key
    if (key === 'title') meta.title = value
    else if (key === 'summary' || key === 'description' || key === 'excerpt') meta.summary = value
    else if (key === 'tags' || key === 'tag') pushTags(meta.tags, value)
  }
  return { meta, body }
}

/** 去引号（front-matter 值常见写法） */
function stripQuotes(value: string): string {
  return value.replace(/^["']|["']$/g, '').trim()
}

/** 拆分标签串并追加（支持 [a, b] / a, b / a，b；去 # 前缀；去重；限 20 个） */
function pushTags(target: string[], raw: string): void {
  const cleaned = raw.replace(/^\[|\]$/g, '')
  for (const piece of cleaned.split(/[,，;；]/)) {
    const name = piece.replace(/^#+/, '').trim()
    if (name === '' || target.includes(name)) continue
    if (target.length >= MAX_TAG_NAMES) return
    target.push(name)
  }
}

/**
 * 标题提取：
 * - front-matter 有 title → 用它；若正文首个 H1 与之一致，移除该 H1（避免标题重复显示）
 * - 否则用正文首个 H1（并移除）
 * - 都没有 → 返回空串（由文件名兜底）
 */
function extractTitle(body: string, metaTitle: string | undefined, warnings: string[]): { title: string; body: string } {
  const h1 = firstH1(body)
  if (metaTitle !== undefined && metaTitle !== '') {
    if (h1 && h1.text === metaTitle) {
      return { title: metaTitle, body: dropLine(body, h1.index) }
    }
    return { title: metaTitle, body }
  }
  if (h1) {
    if (h1.text.length > TITLE_MAX) warnings.push('正文首行标题过长，已按文章标题规则截断')
    return { title: h1.text, body: dropLine(body, h1.index) }
  }
  return { title: '', body }
}

/** 查找首个一级标题（`# 标题`） */
function firstH1(body: string): { text: string; index: number } | null {
  const lines = body.split('\n')
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^#[ \t]+(.+?)[ \t]*$/.exec(lines[index])
    if (match) return { text: match[1].trim(), index }
  }
  return null
}

/** 删除指定行（标题已上提到字段，避免正文重复显示） */
function dropLine(body: string, index: number): string {
  const lines = body.split('\n')
  lines.splice(index, 1)
  return lines.join('\n').replace(/^\n+/, '')
}
