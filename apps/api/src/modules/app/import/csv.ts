import * as iconv from 'iconv-lite'

/**
 * 自研 CSV 解析/序列化（P11 R92：零新依赖，CSV 格式简单，引依赖需特批不值）。
 * 支持：双引号包裹、引号内逗号/换行、转义引号（""）、CRLF/LF 混用、BOM 剥离、GBK 探测。
 */

/** 编码探测（与 P8 文章导入/P10 附件同口径）：UTF-8（剥 BOM）优先，替换字符多则 GBK 回取 */
export function decodeCsvText(buffer: Buffer): string {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3).toString('utf8')
  }
  const asUtf8 = buffer.toString('utf8')
  if (countReplacement(asUtf8) === 0) return asUtf8
  const asGbk = iconv.decode(buffer, 'gbk')
  return countReplacement(asGbk) < countReplacement(asUtf8) ? asGbk : asUtf8
}

function countReplacement(text: string): number {
  let count = 0
  for (const char of text) {
    if (char === '\uFFFD') count += 1
  }
  return count
}

/**
 * 解析 CSV 文本为二维数组（逐字符状态机）：
 * - `"` 包裹的字段内可含逗号/换行；`""` 为字面引号；
 * - 行尾兼容 `\r\n` / `\n` / `\r`；末尾空行丢弃。
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  let hasContent = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        cell += char
      }
      continue
    }
    if (char === '"') {
      inQuotes = true
      hasContent = true
      continue
    }
    if (char === ',') {
      row.push(cell)
      cell = ''
      hasContent = true
      continue
    }
    if (char === '\r' || char === '\n') {
      // 跳过 CRLF 的 LF
      if (char === '\r' && text[i + 1] === '\n') i += 1
      if (hasContent || cell.length > 0 || row.length > 0) {
        row.push(cell)
        rows.push(row)
      }
      row = []
      cell = ''
      hasContent = false
      continue
    }
    cell += char
    hasContent = true
  }
  if (hasContent || cell.length > 0 || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  // 丢弃全空尾行
  while (rows.length > 0 && rows[rows.length - 1].every((value) => value.trim() === '')) {
    rows.pop()
  }
  return rows
}

/** CSV 单元格序列化（含引号/逗号/换行 → 双引号包裹 + 引号转义） */
export function toCsvCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

/** CSV 行序列化（含 BOM 由调用方按需添加） */
export function toCsvRow(cells: unknown[]): string {
  return cells.map((cell) => toCsvCell(cell)).join(',')
}
