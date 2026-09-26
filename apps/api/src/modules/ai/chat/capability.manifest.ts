/**
 * 能力清单（P6 T77 / D67 / R69，ARCHITECTURE §21.1）。
 *
 * 用途：system prompt 第二段——按**当前用户权限**逐项注入，一行一项（能力名 + 一句话 + 关键约束）。
 * 无权限项不出现（AI 不向用户承诺做不到的事）。
 *
 * 同源维护纪律（R69/§21.1）：
 * - 数据源 = 本代码常量表（不读文档，避免手册与实现漂移）；
 * - 每个能力行登记 `tools`：必须与 ToolBootstrap 注册表、TOOL_GROUPS 三方对齐——
 *   `scripts/check-ai-prompt.ts` 机械核查「每个已注册工具恰好被一个能力行覆盖」且
 *   「能力行 perms 与该工具 perms 完全一致」，新增 write 工具不登记能力行 = 核查失败；
 * - `perms: null` = 登录即可（common 组），恒注入。
 */

/** 能力行：能力名 + 注入条件（权限标识）+ 一行文案 + 覆盖的工具 */
export interface CapabilityRow {
  /** 能力标识（核查与日志用，不出现在 prompt） */
  key: string
  /** 注入条件：用户持有该权限标识才注入；null = 登录即可 */
  perms: string | null
  /** 一行文案（能力名：一句话 + 关键约束），注入时统一加 `- ` 前缀 */
  text: string
  /** 本能力行覆盖的工具名（与 ToolBootstrap 注册表同源） */
  tools: string[]
}

/**
 * 能力清单常量表（顺序即 prompt 中的顺序：个人 → 系统 → 云盘 → 站点文件 → CMS → 评论 → 生命周期）。
 * 文案纪律：只写「能做什么 + 关键约束」，不写实现细节；写工具必须点明「需确认」。
 */
export const CAPABILITY_MANIFEST: readonly CapabilityRow[] = [
  {
    key: 'personal',
    perms: null,
    text: '个人账号：查/改我的资料（改需确认）、查套餐剩余积分。',
    tools: ['get_my_profile', 'update_my_profile', 'get_my_credits'],
  },
  {
    key: 'system.online',
    perms: 'system:online:list',
    text: '在线用户：列出 30 分钟内活跃用户（含昵称、登录时间、IP）。',
    tools: ['get_online_users'],
  },
  {
    key: 'system.kick',
    perms: 'system:online:kick',
    text: '踢人下线：把指定用户强制下线（需确认）。',
    tools: ['kick_user'],
  },
  {
    key: 'system.user',
    perms: 'system:user:list',
    text: '用户查询：按用户名或昵称查用户及其角色、状态。',
    tools: ['search_users'],
  },
  {
    key: 'system.role',
    perms: 'system:role:list',
    text: '角色查询：列出角色及被引用情况。',
    tools: ['list_roles'],
  },
  {
    key: 'cloud.read',
    perms: 'cloud:file:list',
    text: '云盘查看：列目录（可递归）、读文本文件（默认只回前 2 万字符，大文件用 nextOffset 续读）。',
    tools: ['list_cloud_files', 'read_cloud_file'],
  },
  {
    key: 'cloud.write',
    perms: 'cloud:file:upload',
    text: '云盘写入：新建或覆盖文本文件（旧版进回收站）、批量移动到指定目录（需确认）。',
    tools: ['write_cloud_file', 'move_cloud_files'],
  },
  {
    key: 'cloud.delete',
    perms: 'cloud:file:delete',
    text: '云盘删除：删除到回收站（可还原，需确认）。',
    tools: ['delete_cloud_files'],
  },
  {
    key: 'site.file',
    perms: 'site:site:manage',
    text: '站点文件：列目录、读文本文件、改页面与样式（影响线上站点，写入需确认）。',
    tools: ['list_site_files', 'read_site_file', 'write_site_files'],
  },
  {
    key: 'site.article.read',
    perms: 'site:article:list',
    text: '文章查看：按状态/栏目列**内容池**全部文章（可按站点筛）、读全文（含 markdown 正文）。',
    tools: ['list_site_articles', 'read_site_article'],
  },
  {
    key: 'site.article.create',
    perms: 'site:article:create',
    text: '代写文章：新建默认草稿（用户明示「直接发布」才公开），可指定栏目/标签/封面；可从云盘 md/txt 导入；草稿可不选站，发布需明确站点（siteIds 可多站）（需确认）。',
    tools: ['create_site_article', 'import_site_article'],
  },
  {
    key: 'site.article.update',
    perms: 'site:article:update',
    text: '改写文章：更新标题/正文/栏目/标签；可一键排版正文（只排版不落库，确认后再更新）；siteIds 可整体替换发表站点（空数组 = 全站下架，文章保留）（需确认）。',
    tools: ['update_site_article', 'format_site_article'],
  },
  {
    key: 'site.article.publish',
    perms: 'site:article:publish',
    text: '文章上下架：发布即公开可见、下架即访客不可见；未发表到任何站点的文章即使上架也无人可见（需确认）。',
    tools: ['publish_site_article'],
  },
  {
    key: 'site.column',
    perms: 'site:column:create',
    text: '建栏目：同名同父已存在则复用，不存在才创建（需确认）。',
    tools: ['ensure_site_column'],
  },
  {
    key: 'site.tag',
    perms: 'site:tag:create',
    text: '建标签：已存在则复用，不存在才创建（需确认）。',
    tools: ['ensure_site_tags'],
  },
  {
    key: 'site.comment',
    perms: 'site:comment:audit',
    text: '评论管理：查待审评论、批量通过或驳回（≤20 条）、以作者身份回复或清除回复（均需确认）。',
    tools: ['list_site_comments', 'audit_site_comments', 'reply_site_comment'],
  },
  {
    key: 'site.lifecycle',
    perms: 'site:site:manage',
    text: '站点管理：新建站点（受配额限制）、改标题描述与标识、启停、评论审核开关、删站（确认卡列明影响，不可恢复）。',
    tools: ['create_site', 'update_site', 'delete_site'],
  },
  {
    key: 'app.data',
    perms: null,
    text: '数据应用：用对话建数据应用（自定义表/字段/关系）并自动生成管理页面，确认后入册（均需确认）。',
    tools: [
      'create_data_app',
      'add_table',
      'add_fields',
      'set_relation',
      'gen_admin_page',
      'adjust_page',
      'confirm_data_app',
    ],
  },
  {
    // P12-PATCH2 T116（R114/R115）：公开面只读能力行——让模型知道「应用可公开发布」并能拿到 pubCode
    key: 'app.pub',
    perms: null,
    text: '查数据应用公开状态：列应用、公开凭证 pubCode、公开链接与发布缺项（只读）。',
    tools: ['list_data_apps'],
  },
  {
    // P13 T120（R122/D110）：公开面写三件套——暴露/发布/市场提交（合注预算已按 R123 腾挪）
    key: 'app.expose',
    perms: null,
    text: '数据应用暴露：开关表/字段/展示页的公开范围（需确认）。',
    tools: ['expose_data_app'],
  },
  {
    key: 'app.publish',
    perms: null,
    text: '数据应用发布：暴露齐备后开启公开（匿名可访问，关闭即失效）（需确认）。',
    tools: ['publish_data_app'],
  },
  {
    key: 'app.market',
    perms: null,
    text: '应用市场：提交上架审核（冻结结构快照 + 可选演示数据，通过后可被复制）（需确认）。',
    tools: ['submit_market_app'],
  },
]

/** 权限判定函数（由 SystemPromptService 注入 PermissionService 实现） */
export type PermissionChecker = (perms: string) => boolean | Promise<boolean>

/**
 * 按权限过滤能力行（保持常量表顺序）。
 * @param has 权限判定（同步或异步）；perms 为 null 的行恒通过
 */
export async function pickCapabilityRows(has: PermissionChecker): Promise<CapabilityRow[]> {
  const picked: CapabilityRow[] = []
  for (const row of CAPABILITY_MANIFEST) {
    if (!row.perms || (await has(row.perms))) picked.push(row)
  }
  return picked
}

/** 能力行 → prompt 段（一行一项，`- ` 前缀） */
export function renderCapabilityList(rows: readonly CapabilityRow[]): string {
  if (rows.length === 0) return ''
  return ['当前账号可用的 AI 能力：', ...rows.map((row) => `- ${row.text}`)].join('\n')
}
