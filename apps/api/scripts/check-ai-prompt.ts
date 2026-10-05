/**
 * AI system prompt + 工具路由机械核查（P6 T77 / R69 / R70 / D67 / D68）。
 *
 * 跑法（apps/api 目录下）：
 *   pnpm --filter @iplat/api exec tsx scripts/check-ai-prompt.ts
 *
 * 核查项（全绿 = 退出码 0）：
 *  A. 手册分段三阈值：通用版 ≤1000、能力清单 ≤1200、合注总长 ≤2000（UTF-8 字符口径）
 *  B. 工具归组全覆盖：注册表 ↔ 分组表无孤儿 / 无陈旧（R70，硬失败版）
 *  C. 能力清单与工具注册表同源：每个工具恰好被一个能力行覆盖，且 perms 完全一致（R69）
 *  D. 路由样例：命中组并集 ∪ common、无命中全量兜底、common 恒下发（验收 2/3）
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  CAPABILITY_MANIFEST,
  renderCapabilityList,
} from '../src/modules/ai/chat/capability.manifest'
import { ASSISTANT_IDENTITY, composeSystemPrompt, textLength } from '../src/modules/ai/chat/prompt.sections'
import {
  ALL_TOOL_GROUPS,
  TOOL_GROUPS,
  checkToolGroupCoverage,
  groupOfTool,
  groupedToolCount,
  resolveToolGroups,
  type ToolGroupName,
} from '../src/modules/ai/tool/tool.groups'

const GENERAL_MAX = 1000
const CAPABILITY_MAX = 1200
const TOTAL_MAX = 2000

const failures: string[] = []
let passed = 0

function check(label: string, condition: boolean, detail: string): void {
  if (condition) {
    passed++
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`)
  } else {
    failures.push(`${label}：${detail}`)
    console.log(`  ✗ ${label} — ${detail}`)
  }
}

/** 读取通用版手册（P6 两段式第一段） */
function loadGuide(): string {
  const candidates = [
    join(process.cwd(), '../../docs/PLATFORM-GUIDE.md'),
    join(process.cwd(), 'docs/PLATFORM-GUIDE.md'),
  ]
  for (const path of candidates) {
    try {
      return readFileSync(path, 'utf-8')
    } catch {
      // 试下一个路径
    }
  }
  throw new Error('未找到 docs/PLATFORM-GUIDE.md')
}

/** 静态扫描工具定义（name / perms / risk），避免为核查启动 Nest 应用 */
function scanTools(): Array<{ name: string; perms: string | null; risk: string | null }> {
  const dir = join(process.cwd(), 'src/modules/ai/tool/tools')
  const tools: Array<{ name: string; perms: string | null; risk: string | null }> = []
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.tool.ts'))) {
    const source = readFileSync(join(dir, file), 'utf-8')
    const name = source.match(/\n\s*name: '([^']+)'/)
    if (!name) continue
    const perms = source.match(/\n\s*perms: '([^']+)'/)
    const risk = source.match(/\n\s*risk: '([^']+)'/)
    tools.push({ name: name[1], perms: perms ? perms[1] : null, risk: risk ? risk[1] : null })
  }
  return tools.sort((a, b) => a.name.localeCompare(b.name))
}

/** 模拟 chat.service 的下发链（先权限过滤、再组路由；此处假定全部工具在权限内） */
function inject(names: readonly string[], groups: readonly ToolGroupName[], fallback: boolean): string[] {
  const set = new Set(groups)
  return names.filter((name) => {
    if (fallback) return true
    const group = groupOfTool(name)
    return group === null || set.has(group)
  })
}

function main(): void {
  const guide = loadGuide()
  const tools = scanTools()
  const names = tools.map((t) => t.name)
  const permittedAll = [...names]

  console.log('A. 手册分段三阈值（UTF-8 字符口径）')
  const generalChars = textLength(ASSISTANT_IDENTITY) + textLength(guide)
  const capabilityChars = textLength(renderCapabilityList(CAPABILITY_MANIFEST))
  const worstPrompt = composeSystemPrompt({
    guide,
    capabilityList: renderCapabilityList(CAPABILITY_MANIFEST),
    userContext: '当前用户信息：昵称「某某某」，角色：超级管理员、普通用户，当前日期：2026-09-15。',
  })
  check('通用版 ≤1000', generalChars <= GENERAL_MAX, `${generalChars}/${GENERAL_MAX} 字符`)
  check('能力清单 ≤1200', capabilityChars <= CAPABILITY_MAX, `${capabilityChars}/${CAPABILITY_MAX} 字符`)
  check('合注总长 ≤2000', textLength(worstPrompt) <= TOTAL_MAX, `${textLength(worstPrompt)}/${TOTAL_MAX} 字符`)

  console.log('B. 工具归组全覆盖（R70）')
  const { orphans, stale } = checkToolGroupCoverage(names)
  check('无孤儿工具', orphans.length === 0, orphans.length ? `未归组：${orphans.join('、')}` : `${names.length} 个工具全部归组`)
  check('无陈旧登记', stale.length === 0, stale.length ? `分组表多出：${stale.join('、')}` : `${groupedToolCount()} 条登记与注册表一致`)

  console.log('C. 能力清单与工具注册表同源（R69）')
  const capabilityCovered = new Map<string, string>()
  let duplicate: string | null = null
  let permsMismatch: string | null = null
  for (const row of CAPABILITY_MANIFEST) {
    for (const toolName of row.tools) {
      if (capabilityCovered.has(toolName)) duplicate = `${toolName}（${capabilityCovered.get(toolName)} / ${row.key}）`
      capabilityCovered.set(toolName, row.key)
      const tool = tools.find((t) => t.name === toolName)
      if (!tool) {
        permsMismatch = `${toolName} 未注册`
        continue
      }
      if ((tool.perms ?? null) !== row.perms) {
        permsMismatch = `${toolName} perms=${tool.perms ?? 'null'} ≠ 能力行 ${row.key} perms=${row.perms ?? 'null'}`
      }
    }
  }
  const uncovered = names.filter((name) => !capabilityCovered.has(name))
  check('无重复覆盖', duplicate === null, duplicate ?? '每个工具仅被一个能力行覆盖')
  check('能力行 perms 与工具 perms 一致', permsMismatch === null, permsMismatch ?? `${CAPABILITY_MANIFEST.length} 个能力行全部对齐`)
  check(
    '能力清单覆盖全部工具',
    uncovered.length === 0,
    uncovered.length ? `未覆盖：${uncovered.join('、')}` : `覆盖 ${capabilityCovered.size}/${names.length}`,
  )
  const writeTools = tools.filter((t) => t.risk === 'write')
  const writeUncovered = writeTools.filter((t) => !capabilityCovered.has(t.name))
  check(
  '写工具全部登记能力行',
  writeUncovered.length === 0,
  writeUncovered.length ? `缺失：${writeUncovered.map((t) => t.name).join('、')}` : `${writeTools.length} 个写工具均已登记`,
  )

  // P20 T172（R161 配套护栏）：能力行与路由的**组内纯度**——
  // 每行的 tools 必须落在**同一个工具组**内。理由：
  // - 行内工具全在恒下发组（common/system，P21 T176 起 app/siteLifecycle 改为创建意图触发）
  //   → 该轮恒可达，安全；
  // - 行内工具全在同一个非恒下发组（如 cloud）→ R161 同源收窄时**整行一起消失**，安全；
  // - 行内工具**跨组** → 可能出现「行注入了、行内工具却缺一半」的中间态（清单与 tools
  //   的错位在行内复活）——这是要抓的。
  console.log('C2. 能力行与路由组纯度（P20 R161/R162）')
  const mixedRows: string[] = []
  for (const row of CAPABILITY_MANIFEST) {
    const groupsOfRow = new Set(row.tools.map((toolName) => groupOfTool(toolName) ?? '(未归组)'))
    if (groupsOfRow.size > 1) {
      mixedRows.push(`${row.key} 跨组：${[...groupsOfRow].join(' + ')}`)
    }
  }
  check(
  '能力行工具不跨组',
  mixedRows.length === 0,
  mixedRows.length
    ? `同源收窄会产生行内半缺：${mixedRows.join('；')}`
    : `${CAPABILITY_MANIFEST.length} 个能力行均为组内纯（整行随组进退）`,
  )

  console.log('D. 路由样例（验收 2/3）')
  const articleRoute = resolveToolGroups('帮我写篇文章')
  const articleInjected = inject(permittedAll, articleRoute.groups, articleRoute.fallback)
  check(
    '「帮我写篇文章」命中 CMS 组',
    !articleRoute.fallback && articleRoute.groups.includes('siteCms'),
    `groups=${articleRoute.groups.join(',')} 命中关键字=${articleRoute.matchedKeywords.join(',')}`,
  )
  check(
    '命中时下发子集且含 create_site_article',
    articleInjected.length < names.length && articleInjected.includes('create_site_article'),
    `下发 ${articleInjected.length}/${names.length}`,
  )
  check('common 组恒下发', articleRoute.groups.includes('common'), '个人账号能力不因路由丢失')

  const commentRoute = resolveToolGroups('帮我看看有没有待审评论')
  check(
    '「待审评论」命中 CMS 组且含评论工具',
    !commentRoute.fallback && inject(permittedAll, commentRoute.groups, commentRoute.fallback).includes('list_site_comments'),
    `groups=${commentRoute.groups.join(',')}`,
  )

  // P12-PATCH2 T116（R114）：数据应用公开面词根（精准复合词，不得抢 siteCms 的「发布」等泛词）
  const appPubRoute = resolveToolGroups('我有哪些数据应用？哪个已经公开发布了？')
  const appPubInjected = inject(permittedAll, appPubRoute.groups, appPubRoute.fallback)
  check(
    '「数据应用/公开发布」命中 app 组且含 list_data_apps',
    !appPubRoute.fallback &&
      appPubRoute.groups.includes('app') &&
      appPubInjected.includes('list_data_apps'),
    `groups=${appPubRoute.groups.join(',')} 下发 ${appPubInjected.length}/${names.length}`,
  )

  // P13 T120（R122）：市场/暴露复合词根（精准复合词，不得抢 siteCms 的「发布/审核」等泛词）
  const marketRoute = resolveToolGroups('把我的应用提交到应用市场')
  const marketInjected = inject(permittedAll, marketRoute.groups, marketRoute.fallback)
  check(
    '「应用市场」命中 app 组且含 submit_market_app',
    !marketRoute.fallback &&
      marketRoute.groups.includes('app') &&
      marketInjected.includes('submit_market_app'),
    `groups=${marketRoute.groups.join(',')} 下发 ${marketInjected.length}/${names.length}`,
  )

  // P14 T130（D112/D114）：展示应用/授权复合词根（精准复合词，不得抢 siteCms 的「发布」等泛词）
  const displayRoute = resolveToolGroups('帮我把这个数据应用授权给展示应用')
  const displayInjected = inject(permittedAll, displayRoute.groups, displayRoute.fallback)
  check(
    '「授权展示应用」命中 app 组且含 create_display_app/authorize_data_app',
    !displayRoute.fallback &&
      displayRoute.groups.includes('app') &&
      displayInjected.includes('create_display_app') &&
      displayInjected.includes('authorize_data_app'),
    `groups=${displayRoute.groups.join(',')} 下发 ${displayInjected.length}/${names.length}`,
  )

  const weatherRoute = resolveToolGroups('今天天气怎么样')
  check(
    '无命中 → 全量兜底',
    weatherRoute.fallback && inject(permittedAll, weatherRoute.groups, weatherRoute.fallback).length === names.length,
    `下发 ${names.length}/${names.length}（关键字表未命中）`,
  )

  const emptyRoute = resolveToolGroups('')
  check('空消息 → 全量兜底', emptyRoute.fallback, `groups=${emptyRoute.groups.join(',')}`)

  check(
    '分组表组名合法',
    ALL_TOOL_GROUPS.every((group) => Array.isArray(TOOL_GROUPS[group]) && TOOL_GROUPS[group].length > 0),
    `${ALL_TOOL_GROUPS.length} 组 / ${groupedToolCount()} 条`,
  )

  console.log(`\n核查结果：通过 ${passed} 项，失败 ${failures.length} 项`)
  if (failures.length > 0) {
    console.error('\n失败明细：')
    for (const detail of failures) console.error(`  - ${detail}`)
    process.exit(1)
  }
}

main()
