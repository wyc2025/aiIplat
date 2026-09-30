/**
 * 工具分组与确定性路由（P6 T77 / D68 / R70，ARCHITECTURE §21.1）。
 *
 * 下发链两道串联（顺序固定，不得颠倒）：
 *   权限过滤（现状，chat.service）→ 组路由（本文件）→ 携带 tools 调上游
 *
 * 口径：
 * - 分组表为**代码常量**：新增工具必须归组，未归组 = 孤儿工具（bootstrap 启动 warn +
 *   scripts/check-ai-prompt.ts 硬失败，R70/T77 验收 3）；
 * - 命中 = 用户消息关键字匹配（只看当前这条消息，不含历史）→ 命中组并集 ∪ common 下发；
 * - **无命中 = 全量兜底**（宁可多花 token，不让 AI 说「我不会」）；
 * - common 组恒下发（登录级工具，人人可用）；
 * - 本文件不改权限语义：先权限过滤、再组路由（R70）。
 */

/** 工具组名（P6：create 组自本期起称 site 组 / CMS 与文件分开；P11 新增 app 数据应用组） */
export type ToolGroupName =
  | 'common'
  | 'system'
  | 'siteFile'
  | 'siteCms'
  | 'siteLifecycle'
  | 'cloud'
  | 'app'

/**
 * 分组常量表（工具名 → 组）：与 ToolBootstrap 注册表同源维护。
 * 约定：每个工具**恰好**属于一个组；孤儿工具（不在本表中）由启动校验/核查脚本抓出。
 */
export const TOOL_GROUPS: Record<ToolGroupName, readonly string[]> = {
  /** 登录即可用的个人能力（无 perms），恒下发 */
  common: ['get_my_profile', 'update_my_profile', 'get_my_credits'],
  /** 系统管理类（在线用户/用户/角色查询与踢人） */
  system: ['get_online_users', 'kick_user', 'search_users', 'list_roles'],
  /** 站点文件（站点目录内的页面/样式/脚本，影响线上站点） */
  siteFile: ['list_site_files', 'read_site_file', 'write_site_files'],
  /** 站点 CMS（文章/栏目/标签 + 评论，含 P6 评论三件套与 P9 导入/排版两件套） */
  siteCms: [
    'list_site_articles',
    'read_site_article',
    'create_site_article',
    'update_site_article',
    'publish_site_article',
    'ensure_site_column',
    'ensure_site_tags',
    'list_site_comments',
    'audit_site_comments',
    'reply_site_comment',
    // P9 T92（D79/R79）：只解析/排版、不落库的 read 级能力
    'import_site_article',
    'format_site_article',
  ],
  /** 站点生命周期（新建 / 编辑 / 删除站点） */
  siteLifecycle: ['create_site', 'update_site', 'delete_site'],
  /** 云盘（站点之外的云盘文件管理） */
  cloud: ['list_cloud_files', 'read_cloud_file', 'write_cloud_file', 'move_cloud_files', 'delete_cloud_files'],
  /**
   * 数据应用（P11 T105：应用/表/关系/功能页，属主自服务，全 write 走确认卡；
   * P12-PATCH2 T116 增只读 list_data_apps——公开状态查询；
   * P13 T120 增公开面写三件套 publish/expose/submit——D110/R122；
   * P14 T130 增展示应用两件套 create_display_app/authorize_data_app——D112/D114）
   */
  app: [
    'create_data_app',
    'add_table',
    'add_fields',
    'set_relation',
    'gen_admin_page',
    'adjust_page',
    'confirm_data_app',
    'list_data_apps',
    'publish_data_app',
    'expose_data_app',
    'submit_market_app',
    'create_display_app',
    'authorize_data_app',
  ],
}

/** 全部组名（顺序固定，便于日志与测试断言） */
export const ALL_TOOL_GROUPS: readonly ToolGroupName[] = [
  'common',
  'system',
  'siteFile',
  'siteCms',
  'siteLifecycle',
  'cloud',
  'app',
]

/**
 * 关键字 → 组映射（`|` 分隔多词根）：用户消息命中任一词根即并入该组。
 * 维护纪律：新增能力时同步补词根，宁可轻微高命中（多下发几个工具）也不漏命中。
 */
export const KEYWORD_TO_GROUPS: Record<string, readonly ToolGroupName[]> = {
  // 站点 CMS：文章/栏目/标签 + 评论（P6 扩充评论词根；P9 补导入/排版词根）
  '文章|博文|博客|栏目|分类|标签|草稿|摘要|正文|标题|代写|写篇|写一篇|投稿|导入|排版|format': ['siteCms'],
  '评论|留言|待审|审核|通过|驳回|回复|回评': ['siteCms'],
  // 站点文件：站点目录内的页面/样式/脚本
  '站点文件|页面|样式|样式表|网页|html|css|js|脚本|模板页|首页文件': ['siteFile'],
  // 站点生命周期：站点本身（新建/编辑/删除）
  '站点|建站|网站|个人网站|描述|简介|删站|删除站点|新建站点|开通站点': ['siteLifecycle', 'siteFile'],
  // 云盘：站点之外的云盘文件管理
  '云盘|文件|目录|文件夹|整理|移动|删除文件|上传|下载|笔记|文档|我的文件': ['cloud'],
  // 数据应用（P11 R98）：建应用/建表/字段/关系/管理页面；
  // P12-PATCH2 T116/R114 补公开面词根；P13 T120/R122 补市场与暴露词根；P14 T130 补展示应用/授权词根
  // ——纪律：**只用复合词**（「发布」「审核」「通过」等泛词已被 siteCms 占用，不得抢命中）
  '应用|数据应用|建应用|建表|数据表|表结构|字段|关系|管理页|功能页|后台|记账|书单|库存|相册|公开应用|应用公开|公开链接|公开凭证|公开访问|公开数据|对外展示|外部展示|展示页|展示应用|静态展示页|发布应用|pubcode|应用市场|市场审核|提交市场|发布到市场|上架应用|市场条目|公开发布|暴露|数据授权|授权数据|授权给|撤权': [
    'app',
  ],
  // 系统管理：在线用户 / 用户 / 角色
  '在线|踢人|下线|用户|成员|角色|权限|账号': ['system'],
}

/** 路由结果（供日志与核查用） */
export interface ToolRoutingResult {
  /** 命中的关键字（DEBUG_AI=1 时输出明细） */
  matchedKeywords: string[]
  /** 参与下发的组（含恒下发的 common） */
  groups: ToolGroupName[]
  /** true = 无命中，全量兜底 */
  fallback: boolean
}

/**
 * 确定性路由：用户消息 → 组集合（不含权限过滤，权限过滤由调用方先做）。
 * @param message 当前用户消息（不含历史）；缺省/空串 → 全量兜底
 */
export function resolveToolGroups(message?: string): ToolRoutingResult {
  const text = (message ?? '').toLowerCase()
  if (text.trim().length === 0) {
    return { matchedKeywords: [], groups: [...ALL_TOOL_GROUPS], fallback: true }
  }

  const matchedKeywords: string[] = []
  const hitGroups = new Set<ToolGroupName>()
  for (const [keywordEntry, groups] of Object.entries(KEYWORD_TO_GROUPS)) {
    const keywords = keywordEntry.split('|')
    const hits = keywords.filter((kw) => text.includes(kw.toLowerCase()))
    if (hits.length === 0) continue
    matchedKeywords.push(...hits)
    for (const group of groups) hitGroups.add(group)
  }

  if (hitGroups.size === 0) {
    return { matchedKeywords: [], groups: [...ALL_TOOL_GROUPS], fallback: true }
  }
  return { matchedKeywords, groups: [...hitGroups, 'common'], fallback: false }
}

/** 工具名 → 组（未归组返回 null） */
export function groupOfTool(toolName: string): ToolGroupName | null {
  for (const group of ALL_TOOL_GROUPS) {
    if (TOOL_GROUPS[group].includes(toolName)) return group
  }
  return null
}

/** 分组表登记的工具总数（核查「全量兜底数 = 注册数」用） */
export function groupedToolCount(): number {
  return ALL_TOOL_GROUPS.reduce((sum, group) => sum + TOOL_GROUPS[group].length, 0)
}

/**
 * 孤儿工具（在注册表但未归组）+ 陈旧登记（在分组表但未注册）。
 * 两个方向都要查：前者会让路由漏工具，后者说明分组表未随工具改动同步。
 */
export function checkToolGroupCoverage(registeredNames: readonly string[]): {
  orphans: string[]
  stale: string[]
} {
  const registered = new Set(registeredNames)
  const grouped = new Set(ALL_TOOL_GROUPS.flatMap((group) => [...TOOL_GROUPS[group]]))
  return {
    orphans: registeredNames.filter((name) => !grouped.has(name)),
    stale: [...grouped].filter((name) => !registered.has(name)),
  }
}
