/**
 * Markdown 一键排版规则引擎（P8 T89）：纯函数、零依赖、**幂等**（重复执行结果一致）。
 *
 * 设计要点：
 * - **保护区机制**：代码围栏、行内代码、图片/链接的 URL、自动链接、HTML 标签先抽成占位符
 *   （`\u0000{n}\u0001`），所有规则只作用于"纯文本"，处理完再原样还原 —— 避免把 URL 里的
 *   `_` 当强调符、把英文代码当成"需要加空格的中英混排"。
 * - **三档规则可分别开关**：structure（结构规整）/ punctuation（标点与符号）/ cjkSpacing（中英间距）；
 *   任一开关关闭时对应规则完全不参与，便于"保守排版"与"标准排版"切换。
 * - **有损提醒**：排版会改写正文（虽然只改格式），所以调用方必须先做 diff 预览再应用；
 *   本模块只返回结果与统计，不做任何入库。
 */

/** 排版选项（缺省 = 三档全开，即"标准排版"） */
export interface MarkdownFormatOptions {
  /** 结构规整：标题/引用/列表符号/围栏/块间空行/行尾空白 */
  structure?: boolean
  /** 标点与符号：`__x__`→`**x**`、`_x_`→`*x*`、中文语境 `...`→`……` */
  punctuation?: boolean
  /** 中英间距：汉字与拉丁字母/数字之间补一个空格 */
  cjkSpacing?: boolean
}

/** 排版结果 */
export interface MarkdownFormatResult {
  contentMd: string
  changed: boolean
  stats: {
    /** 实际命中的规则标签（便于前端提示"改了哪些地方"） */
    rules: string[]
    lines: number
    charsBefore: number
    charsAfter: number
  }
}

/** 占位符包装（NUL 在正文中极不可能出现；导入侧也会拒绝含 NUL 的文件） */
const PH_OPEN = '\u0000'
const PH_CLOSE = '\u0001'

/** 行首列表符号（无序：`*`/`+`/`-`；有序：`1.`/`1)`） */
const UL_PATTERN = /^(\s*)([*+-])(\s+)(.*)$/
const OL_PATTERN = /^(\s*)(\d+)([.)])(\s*)(.*)$/
/** ATX 标题 */
const ATX_PATTERN = /^(#{1,6})(\s*)(.*)$/
/** 围栏（``` 或 ~~~，允许带语言位） */
const FENCE_PATTERN = /^(\s*)(`{3,}|~{3,})(.*)$/

/** 统计收集器 */
class RuleTracker {
  private readonly hit = new Set<string>()

  mark(rule: string): void {
    this.hit.add(rule)
  }

  list(): string[] {
    return [...this.hit]
  }
}

/**
 * 主入口：Markdown 排版。
 * 传入空串或纯空白直接原样返回（避免把"空文档"排版成有内容的文档）。
 */
export function formatMarkdown(contentMd: string, options: MarkdownFormatOptions = {}): MarkdownFormatResult {
  const opts: Required<MarkdownFormatOptions> = {
    structure: options.structure ?? true,
    punctuation: options.punctuation ?? true,
    cjkSpacing: options.cjkSpacing ?? true,
  }
  const tracker = new RuleTracker()
  const charsBefore = contentMd.length

  const normalized = contentMd.replace(/\r\n?/g, '\n')
  if (normalized.trim() === '') {
    return {
      contentMd: normalized,
      changed: normalized !== contentMd,
      stats: { rules: [], lines: 0, charsBefore, charsAfter: normalized.length },
    }
  }

  const lines = normalized.split('\n')
  const inFence = computeFenceMask(lines)

  // ① 行内处理：保护区抽取 → 规则 → 还原
  const processed = lines.map((line, index) => {
    const trimmed = line.replace(/[ \t]+$/, '')
    if (trimmed !== line) tracker.mark('行尾空白')
    if (inFence[index]) return trimmed
    return transformInline(trimmed, opts, tracker)
  })

  // ② 块级处理：标题/引用/列表规范 + 块间空行 + 文末换行
  const spaced = opts.structure ? applyStructure(processed, inFence, tracker) : processed

  const contentAfter = spaced.join('\n')
  return {
    contentMd: contentAfter,
    changed: contentAfter !== contentMd,
    stats: {
      rules: tracker.list(),
      lines: lines.length,
      charsBefore,
      charsAfter: contentAfter.length,
    },
  }
}

/** 标记每一行是否处于代码围栏内（含围栏行本身）；围栏按"同类型同长度"闭合 */
function computeFenceMask(lines: string[]): boolean[] {
  const mask: boolean[] = []
  let fence: { char: string; size: number } | null = null

  for (const line of lines) {
    const match = FENCE_PATTERN.exec(line)
    if (!fence) {
      if (match) {
        fence = { char: match[2][0], size: match[2].length }
        mask.push(true)
        continue
      }
      mask.push(false)
      continue
    }
    mask.push(true)
    // 闭合：同字符类型且长度不短于起始围栏，且该行除围栏外仅空白
    if (match && match[2][0] === fence.char && match[2].length >= fence.size && match[3].trim() === '') {
      fence = null
    }
  }
  return mask
}

/**
 * 行内规则（非围栏行）：
 * 保护区抽取 → 标点统一 → 中英间距 → 还原。
 */
function transformInline(line: string, opts: Required<MarkdownFormatOptions>, tracker: RuleTracker): string {
  if (line === '') return line
  const { text, restore } = protectInline(line)

  let body = text
  if (opts.structure) body = normalizeBlockPrefix(body, tracker)
  if (opts.punctuation) body = normalizePunctuation(body, tracker)
  if (opts.cjkSpacing) body = applyCjkSpacing(body, tracker)

  return restore(body)
}

/**
 * 行内保护区抽取：行内代码、图片/链接的 URL、自动链接、HTML 标签、数学式（$...$）。
 * 只保护"载荷部分"（URL 等），链接文字仍参与排版（中文标题就该加空格）。
 */
function protectInline(line: string): { text: string; restore: (value: string) => string } {
  const items: string[] = []
  const stash = (segment: string): string => {
    items.push(segment)
    return `${PH_OPEN}${items.length - 1}${PH_CLOSE}`
  }

  let out = line
  // 行内代码：`code` / ``code``
  out = out.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (m) => stash(m))
  // 图片与链接：保留方括号文字，保护圆括号里的地址（可含空格与 title）
  out = out.replace(/(!?\[[^\]]*\]\()([^)]*)(\))/g, (_m, head: string, url: string, tail: string) =>
    `${head}${stash(url)}${tail}`,
  )
  // 自动链接 <https://...>
  out = out.replace(/<[a-zA-Z][^>\s]*>/g, (m) => stash(m))
  // 行内 HTML 标签
  out = out.replace(/<\/?[a-zA-Z][^>]*>/g, (m) => stash(m))
  // 行内数学式 $...$（不做公式排版）
  out = out.replace(/\$[^$\n]+\$/g, (m) => stash(m))

  return {
    text: out,
    restore: (value: string) =>
      value.replace(new RegExp(`${PH_OPEN}(\\d+)${PH_CLOSE}`, 'g'), (_m, index: string) => items[Number(index)]),
  }
}

/** 行首块标记规范：标题、引用、无序/有序列表符号 */
function normalizeBlockPrefix(line: string, tracker: RuleTracker): string {
  const atx = ATX_PATTERN.exec(line)
  if (atx) {
    const [, hashes, , title] = atx
    // 仅当后面确实有内容时才补空格（`##` 单独一行保持原样）
    if (title.trim() !== '') {
      const next = `${hashes} ${title.trim()}`
      if (next !== line) tracker.mark('标题空格')
      return next
    }
    return line
  }

  // 引用：`>引用` → `> 引用`（`>` 后保留一个空格；空引用行 `>` 原样）
  const quote = /^(\s*>+)(\s*)(.*)$/.exec(line)
  if (quote) {
    const [, marks, , rest] = quote
    if (rest.trim() === '') return line
    const next = `${marks} ${rest.trim()}`
    if (next !== line) tracker.mark('引用空格')
    return next
  }

  const ul = UL_PATTERN.exec(line)
  if (ul) {
    const [, indent, , , rest] = ul
    const next = `${indent}- ${rest.trim()}`
    if (next !== line) tracker.mark('列表符号统一')
    return next
  }

  const ol = OL_PATTERN.exec(line)
  if (ol) {
    const [, indent, num, dot, , rest] = ol
    const next = `${indent}${num}${dot} ${rest.trim()}`
    if (next !== line) tracker.mark('有序列表空格')
    return next
  }

  return line
}

/** 标点与符号统一（作用域已排除保护区） */
function normalizePunctuation(line: string, tracker: RuleTracker): string {
  let out = line
  // __强调__ → **强调**；_强调_ → *强调*（仅成对出现时处理）
  const strong = out.replace(/__([^_\n]+)__/g, (_m, inner: string) => `**${inner}**`)
  if (strong !== out) {
    tracker.mark('强调符号统一')
    out = strong
  }
  const emphasis = out.replace(/(^|[^*\w])_([^_\n]+)_(?![\w*])/g, (_m, head: string, inner: string) => `${head}*${inner}*`)
  if (emphasis !== out) {
    tracker.mark('强调符号统一')
    out = emphasis
  }
  // 中文语境省略号：`...` 前一个字符是汉字/中文标点才替换（英文句子保留 three dots）
  const ellipsis = out.replace(/([\u3400-\u9fff\u3000-\u303f\uff00-\uffef])\.{3}(?!\.)/g, (_m, head: string) => `${head}……`)
  if (ellipsis !== out) {
    tracker.mark('中文省略号')
    out = ellipsis
  }
  return out
}

/**
 * 中英间距：汉字 ↔ 拉丁字母/数字 之间补一个空格。
 * 规则细节：已存在空白则不重复补；不跨越标点（`中文，abc` 不动标点，只在紧邻时补）；
 * 保护区（代码/URL）已抽走，不会误伤。
 */
function applyCjkSpacing(line: string, tracker: RuleTracker): string {
  const cjk = '\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff'
  let out = line
  // 汉字 + 字母/数字 → 汉字 字母/数字
  const afterCjk = out.replace(new RegExp(`([${cjk}])([A-Za-z0-9])`, 'g'), (_m, c: string, l: string) => `${c} ${l}`)
  if (afterCjk !== out) {
    tracker.mark('中英间距')
    out = afterCjk
  }
  // 字母/数字 + 汉字 → 字母/数字 汉字
  const beforeCjk = out.replace(new RegExp(`([A-Za-z0-9])([${cjk}])`, 'g'), (_m, l: string, c: string) => `${l} ${c}`)
  if (beforeCjk !== out) {
    tracker.mark('中英间距')
    out = beforeCjk
  }
  return out
}

/** 列表项（无序 `-`/`*`/`+` 或有序 `1.`/`1)`） */
function isListLine(line: string): boolean {
  return UL_PATTERN.test(line) || OL_PATTERN.test(line)
}

/** 块起始行（标题 / 围栏 / 引用 / 列表）——段落收集的终止条件 */
function isBlockStartLine(line: string): boolean {
  return ATX_PATTERN.test(line) || FENCE_PATTERN.test(line) || /^\s*>/.test(line) || isListLine(line)
}

/**
 * 块级结构：把正文切成"块"，**块之间恰好一个空行**，文末恰好一个换行。
 *
 * 为什么要分块而不是逐行插空行：markdown 里"列表后紧跟非缩进行"会被解析为**列表项的延续**
 * （lazy continuation），逐行判断很容易漏掉这种情形；按块重建空行可以从结构上杜绝，
 * 同时保证段内、列表项之间、引用行之间不会被塞进空行。
 */
function applyStructure(lines: string[], inFence: boolean[], tracker: RuleTracker): string[] {
  const blocks: string[][] = []
  /** 每个块的首行行号（用于判断原文是否本来就缺空行） */
  const startLines: number[] = []
  let index = 0
  let compressedBlank = false

  while (index < lines.length) {
    const line = lines[index]

    // 空行：只做"连续空行压缩"统计，随后统一重建
    if (!inFence[index] && line.trim() === '') {
      let blanks = 0
      while (index < lines.length && !inFence[index] && lines[index].trim() === '') {
        blanks += 1
        index += 1
      }
      if (blanks > 1) compressedBlank = true
      continue
    }

    const start = index
    const block: string[] = []

    if (inFence[index]) {
      // 围栏块：从起始围栏行收集到闭合行（含），块内空行原样保留
      while (index < lines.length && inFence[index]) {
        block.push(lines[index])
        index += 1
      }
    } else if (ATX_PATTERN.test(line)) {
      block.push(line)
      index += 1
    } else if (/^\s*>/.test(line)) {
      while (index < lines.length && !inFence[index] && /^\s*>/.test(lines[index])) {
        block.push(lines[index])
        index += 1
      }
    } else if (isListLine(line)) {
      while (index < lines.length && !inFence[index] && lines[index].trim() !== '' && isListLine(lines[index])) {
        block.push(lines[index])
        index += 1
      }
    } else {
      // 段落块（表格行也落在这里：连续表行视为一个块）
      while (
        index < lines.length &&
        !inFence[index] &&
        lines[index].trim() !== '' &&
        !isBlockStartLine(lines[index])
      ) {
        block.push(lines[index])
        index += 1
      }
    }

    blocks.push(block)
    startLines.push(start)
  }

  if (compressedBlank) tracker.mark('压缩空行')
  // 原文中"块首行的前一行非空" = 原本缺空行，被本次补齐
  const missingBlank = startLines.some((line, i) => i > 0 && line > 0 && lines[line - 1].trim() !== '')
  if (missingBlank) tracker.mark('块间空行')

  const rebuilt = blocks.map((block) => block.join('\n'))
  // 末尾补一个换行（尾元素为空串，join 后即"文末恰好一个换行"）
  return [...rebuilt.join('\n\n').split('\n'), '']
}
