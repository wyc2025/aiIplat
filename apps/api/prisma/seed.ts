/**
 * 数据库种子脚本（第一期 system 域）
 * 内容：admin 用户、admin/common 角色、系统管理全套菜单及按钮权限
 * 幂等：可重复执行，已存在的数据跳过（admin 密码不会被重置）
 * 运行：pnpm -C apps/api db:seed
 */
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient()

/** 菜单 seed 数据结构 */
interface MenuSeed {
  name: string
  /** 1 目录 2 菜单 3 按钮 */
  type: 1 | 2 | 3
  path?: string
  component?: string
  perms?: string
  icon?: string
  sort: number
  /** 默认 1 显示，0 隐藏 */
  visible?: number
  children?: MenuSeed[]
}

/** 菜单树（结构以 ARCHITECTURE.md「seed 初始数据」为准） */
const menuTree: MenuSeed[] = [
  {
    name: '首页工作台',
    type: 2,
    path: '/dashboard',
    component: 'dashboard/index',
    icon: 'Odometer',
    sort: 1,
  },
  {
    name: '系统管理',
    type: 1,
    path: '/system',
    icon: 'Setting',
    sort: 2,
    children: [
      {
        name: '用户管理',
        type: 2,
        path: 'system/user',
        component: 'system/user/index',
        perms: 'system:user:list',
        icon: 'User',
        sort: 1,
        children: [
          { name: '用户查询', type: 3, perms: 'system:user:list', sort: 1 },
          { name: '用户新增', type: 3, perms: 'system:user:create', sort: 2 },
          { name: '用户修改', type: 3, perms: 'system:user:update', sort: 3 },
          { name: '用户删除', type: 3, perms: 'system:user:delete', sort: 4 },
          { name: '重置密码', type: 3, perms: 'system:user:reset-password', sort: 5 },
          { name: '分配角色', type: 3, perms: 'system:user:assign-role', sort: 6 },
          // P3：云盘配额调整（cloud 域按钮挂在用户管理下，属 admin 能力，不给 common）
          { name: '调整配额', type: 3, perms: 'cloud:admin:quota', sort: 7 },
        ],
      },
      {
        name: '角色管理',
        type: 2,
        path: 'system/role',
        component: 'system/role/index',
        perms: 'system:role:list',
        icon: 'Avatar',
        sort: 2,
        children: [
          { name: '角色查询', type: 3, perms: 'system:role:list', sort: 1 },
          { name: '角色新增', type: 3, perms: 'system:role:create', sort: 2 },
          { name: '角色修改', type: 3, perms: 'system:role:update', sort: 3 },
          { name: '角色删除', type: 3, perms: 'system:role:delete', sort: 4 },
          { name: '分配菜单', type: 3, perms: 'system:role:assign-menu', sort: 5 },
        ],
      },
      {
        name: '菜单管理',
        type: 2,
        path: 'system/menu',
        component: 'system/menu/index',
        perms: 'system:menu:list',
        icon: 'Menu',
        sort: 3,
        children: [
          { name: '菜单查询', type: 3, perms: 'system:menu:list', sort: 1 },
          { name: '菜单新增', type: 3, perms: 'system:menu:create', sort: 2 },
          { name: '菜单修改', type: 3, perms: 'system:menu:update', sort: 3 },
          { name: '菜单删除', type: 3, perms: 'system:menu:delete', sort: 4 },
        ],
      },
      {
        name: '部门管理',
        type: 2,
        path: 'system/dept',
        component: 'system/dept/index',
        perms: 'system:dept:list',
        icon: 'OfficeBuilding',
        sort: 4,
        children: [
          { name: '部门查询', type: 3, perms: 'system:dept:list', sort: 1 },
          { name: '部门新增', type: 3, perms: 'system:dept:create', sort: 2 },
          { name: '部门修改', type: 3, perms: 'system:dept:update', sort: 3 },
          { name: '部门删除', type: 3, perms: 'system:dept:delete', sort: 4 },
        ],
      },
      {
        name: '字典管理',
        type: 2,
        path: 'system/dict',
        component: 'system/dict/index',
        perms: 'system:dict:list',
        icon: 'Collection',
        sort: 5,
        children: [
          { name: '字典查询', type: 3, perms: 'system:dict:list', sort: 1 },
          { name: '字典新增', type: 3, perms: 'system:dict:create', sort: 2 },
          { name: '字典修改', type: 3, perms: 'system:dict:update', sort: 3 },
          { name: '字典删除', type: 3, perms: 'system:dict:delete', sort: 4 },
        ],
      },
      {
        name: '日志管理',
        type: 1,
        path: 'system/log',
        icon: 'Document',
        sort: 6,
        children: [
          {
            name: '登录日志',
            type: 2,
            path: 'system/log/login',
            component: 'system/log/login/index',
            perms: 'system:log:login',
            icon: 'Key',
            sort: 1,
          },
          {
            name: '操作日志',
            type: 2,
            path: 'system/log/operation',
            component: 'system/log/operation/index',
            perms: 'system:log:operation',
            icon: 'List',
            sort: 2,
          },
        ],
      },
      {
        name: '在线用户',
        type: 2,
        path: 'system/online',
        component: 'system/online/index',
        perms: 'system:online:list',
        icon: 'Connection',
        sort: 7,
        children: [
          { name: '在线用户查询', type: 3, perms: 'system:online:list', sort: 1 },
          { name: '踢下线', type: 3, perms: 'system:online:kick', sort: 2 },
        ],
      },
    ],
  },
  // AI 助手：登录可见目录（三页不挂按钮权限，接口层用套餐校验兜底）
  {
    name: 'AI 助手',
    type: 1,
    path: '/ai',
    icon: 'MagicStick',
    sort: 3,
    children: [
      {
        name: 'AI 对话',
        type: 2,
        path: 'ai/chat',
        component: 'ai/chat/index',
        icon: 'ChatDotRound',
        sort: 1,
      },
      {
        name: '开通套餐',
        type: 2,
        path: 'ai/plan',
        component: 'ai/plan/index',
        icon: 'Wallet',
        sort: 2,
      },
      {
        name: '我的用量',
        type: 2,
        path: 'ai/usage',
        component: 'ai/usage/index',
        icon: 'DataLine',
        sort: 3,
      },
    ],
  },
  // AI 管理：admin 专属（走正常 RBAC，ai:* 权限标识）
  {
    name: 'AI 管理',
    type: 1,
    path: '/ai-admin',
    icon: 'Monitor',
    sort: 4,
    children: [
      {
        name: '厂商模型',
        type: 2,
        path: 'ai-admin/provider',
        component: 'ai/provider/index',
        perms: 'ai:provider:list',
        icon: 'Cpu',
        sort: 1,
        children: [
          { name: '厂商查询', type: 3, perms: 'ai:provider:list', sort: 1 },
          { name: '厂商新增', type: 3, perms: 'ai:provider:create', sort: 2 },
          { name: '厂商修改', type: 3, perms: 'ai:provider:update', sort: 3 },
          { name: '厂商删除', type: 3, perms: 'ai:provider:delete', sort: 4 },
          { name: '模型查询', type: 3, perms: 'ai:model:list', sort: 5 },
          { name: '模型新增', type: 3, perms: 'ai:model:create', sort: 6 },
          { name: '模型修改', type: 3, perms: 'ai:model:update', sort: 7 },
          { name: '模型删除', type: 3, perms: 'ai:model:delete', sort: 8 },
        ],
      },
      {
        name: '套餐管理',
        type: 2,
        path: 'ai-admin/plan',
        component: 'ai/admin/plan/index',
        perms: 'ai:plan:list',
        icon: 'PriceTag',
        sort: 2,
        children: [
          { name: '套餐查询', type: 3, perms: 'ai:plan:list', sort: 1 },
          { name: '套餐新增', type: 3, perms: 'ai:plan:create', sort: 2 },
          { name: '套餐修改', type: 3, perms: 'ai:plan:update', sort: 3 },
          { name: '套餐删除', type: 3, perms: 'ai:plan:delete', sort: 4 },
          { name: '指派用户', type: 3, perms: 'ai:plan:assign', sort: 5 },
        ],
      },
      {
        name: '用量明细',
        type: 2,
        path: 'ai-admin/usage',
        component: 'ai/admin/usage/index',
        perms: 'ai:usage:list',
        icon: 'Histogram',
        sort: 3,
        children: [{ name: '用量查询', type: 3, perms: 'ai:usage:list', sort: 1 }],
      },
    ],
  },
  // 云盘管理（P3）：登录用户均可访问的目录，走正常 RBAC（cloud:* 权限标识）
  {
    name: '云盘管理',
    type: 1,
    path: '/cloud',
    icon: 'Folder',
    sort: 5,
    children: [
      {
        name: '我的文件',
        type: 2,
        path: 'cloud/file',
        component: 'cloud/file/index',
        perms: 'cloud:file:list',
        icon: 'FolderOpened',
        sort: 1,
        children: [
          { name: '文件查询', type: 3, perms: 'cloud:file:list', sort: 1 },
          { name: '上传', type: 3, perms: 'cloud:file:upload', sort: 2 },
          { name: '新建文件夹', type: 3, perms: 'cloud:file:mkdir', sort: 3 },
          { name: '重命名', type: 3, perms: 'cloud:file:rename', sort: 4 },
          { name: '删除', type: 3, perms: 'cloud:file:delete', sort: 5 },
          { name: '创建分享', type: 3, perms: 'cloud:share:create', sort: 6 },
          // P4a：设为公开（站点公开目录机制，cloud 域接口 site 装配复用）
          { name: '设为公开', type: 3, perms: 'cloud:file:public', sort: 7 },
        ],
      },
      {
        name: '公开链接',
        type: 2,
        path: 'cloud/share',
        component: 'cloud/share/index',
        perms: 'cloud:share:list',
        icon: 'Link',
        sort: 2,
        children: [
          { name: '分享查询', type: 3, perms: 'cloud:share:list', sort: 1 },
          { name: '停止/延长', type: 3, perms: 'cloud:share:stop', sort: 2 },
        ],
      },
      {
        name: '回收站',
        type: 2,
        path: 'cloud/recycle',
        component: 'cloud/recycle/index',
        perms: 'cloud:recycle:list',
        icon: 'Delete',
        sort: 3,
        children: [
          { name: '回收站查询', type: 3, perms: 'cloud:recycle:list', sort: 1 },
          { name: '恢复', type: 3, perms: 'cloud:recycle:restore', sort: 2 },
          { name: '彻底删除', type: 3, perms: 'cloud:recycle:delete', sort: 3 },
        ],
      },
    ],
  },
  // 个人网站（P4a）：登录用户均可访问的目录，走正常 RBAC（site:* 权限标识，结构见架构增补 §14.10）
  {
    name: '个人网站',
    type: 1,
    path: '/site',
    icon: 'Monitor',
    sort: 6,
    children: [
      {
        name: '站点设置',
        type: 2,
        path: 'site/setting',
        component: 'site/setting/index',
        perms: 'site:site:manage',
        icon: 'Operation',
        sort: 1,
      },
      {
        name: '栏目管理',
        type: 2,
        path: 'site/column',
        component: 'site/column/index',
        perms: 'site:column:list',
        icon: 'Menu',
        sort: 2,
        children: [
          { name: '栏目查询', type: 3, perms: 'site:column:list', sort: 1 },
          { name: '栏目新增', type: 3, perms: 'site:column:create', sort: 2 },
          { name: '栏目修改', type: 3, perms: 'site:column:update', sort: 3 },
          { name: '栏目删除', type: 3, perms: 'site:column:delete', sort: 4 },
        ],
      },
      {
        name: '文章管理',
        type: 2,
        path: 'site/article',
        component: 'site/article/index',
        perms: 'site:article:list',
        icon: 'Document',
        sort: 3,
        children: [
          { name: '文章查询', type: 3, perms: 'site:article:list', sort: 1 },
          { name: '文章新增', type: 3, perms: 'site:article:create', sort: 2 },
          { name: '文章修改', type: 3, perms: 'site:article:update', sort: 3 },
          { name: '发布/下架', type: 3, perms: 'site:article:publish', sort: 4 },
          { name: '文章删除', type: 3, perms: 'site:article:delete', sort: 5 },
        ],
      },
      {
        name: '标签管理',
        type: 2,
        path: 'site/tag',
        component: 'site/tag/index',
        perms: 'site:tag:list',
        icon: 'Collection',
        sort: 4,
        children: [
          { name: '标签查询', type: 3, perms: 'site:tag:list', sort: 1 },
          { name: '标签新增', type: 3, perms: 'site:tag:create', sort: 2 },
          { name: '标签修改', type: 3, perms: 'site:tag:update', sort: 3 },
          { name: '标签删除', type: 3, perms: 'site:tag:delete', sort: 4 },
        ],
      },
      {
        name: '评论管理',
        type: 2,
        path: 'site/comment',
        component: 'site/comment/index',
        perms: 'site:comment:list',
        icon: 'ChatDotSquare',
        sort: 5,
        children: [
          { name: '评论查询', type: 3, perms: 'site:comment:list', sort: 1 },
          { name: '评论审核', type: 3, perms: 'site:comment:audit', sort: 2 },
          { name: '评论删除', type: 3, perms: 'site:comment:delete', sort: 3 },
        ],
      },
    ],
  },
  // 个人中心：路由存在但不进侧边栏菜单（visible=0，hidden 不参与侧边栏排序）
  {
    name: '个人中心',
    type: 2,
    path: '/profile',
    component: 'profile/index',
    icon: 'Postcard',
    sort: 6,
    visible: 0,
  },
]

/** 递归创建菜单（幂等：按 parentId + name 判重），返回 [菜单 id 列表, dashboard 菜单 id] */
async function seedMenus(
  seeds: MenuSeed[],
  parentId: bigint,
  createdIds: bigint[],
): Promise<void> {
  for (const seed of seeds) {
    const { children, ...fields } = seed
    let menu = await prisma.sysMenu.findFirst({
      where: { parentId, name: seed.name },
    })
    if (!menu) {
      menu = await prisma.sysMenu.create({
        data: { ...fields, visible: fields.visible ?? 1, parentId },
      })
      createdIds.push(menu.id)
    }
    if (children?.length) {
      await seedMenus(children, menu.id, createdIds)
    }
  }
}

async function main() {
  // 1. 角色：超级管理员（admin，代码层特判拥有全部权限）、普通角色（common，仅 dashboard）
  const adminRole = await prisma.sysRole.upsert({
    where: { code: 'admin' },
    update: {},
    create: { name: '超级管理员', code: 'admin', sort: 1, remark: '拥有全部权限，不可禁用/删除' },
  })
  const commonRole = await prisma.sysRole.upsert({
    where: { code: 'common' },
    update: {},
    create: { name: '普通角色', code: 'common', sort: 2, remark: '默认角色，仅首页工作台可见' },
  })

  // 2. 菜单树
  const createdMenuIds: bigint[] = []
  await seedMenus(menuTree, BigInt(0), createdMenuIds)

  // 3. common 角色关联「首页工作台」+「AI 助手」目录下三页（AI 管理三页不给 common）
  const dashboardMenu = await prisma.sysMenu.findFirst({
    where: { parentId: BigInt(0), name: '首页工作台' },
  })
  if (dashboardMenu) {
    await prisma.sysRoleMenu.upsert({
      where: { roleId_menuId: { roleId: commonRole.id, menuId: dashboardMenu.id } },
      update: {},
      create: { roleId: commonRole.id, menuId: dashboardMenu.id },
    })
  }
  const aiAssistantDir = await prisma.sysMenu.findFirst({
    where: { parentId: BigInt(0), name: 'AI 助手' },
  })
  if (aiAssistantDir) {
    await prisma.sysRoleMenu.upsert({
      where: { roleId_menuId: { roleId: commonRole.id, menuId: aiAssistantDir.id } },
      update: {},
      create: { roleId: commonRole.id, menuId: aiAssistantDir.id },
    })
    // AI 助手目录下三页（按名称精确查找）
    const aiChildMenus = await prisma.sysMenu.findMany({
      where: { parentId: aiAssistantDir.id, name: { in: ['AI 对话', '开通套餐', '我的用量'] } },
    })
    for (const menu of aiChildMenus) {
      await prisma.sysRoleMenu.upsert({
        where: { roleId_menuId: { roleId: commonRole.id, menuId: menu.id } },
        update: {},
        create: { roleId: commonRole.id, menuId: menu.id },
      })
    }
  }

  // P3：common 角色授予「云盘管理」整棵子树（不含 cloud:admin:quota，该按钮属 admin）
  const cloudDir = await prisma.sysMenu.findFirst({
    where: { parentId: BigInt(0), name: '云盘管理' },
  })
  if (cloudDir) {
    // 收集云盘管理整棵子树（目录 + 菜单 + 按钮），排除 cloud:admin:quota（仅 admin）
    const cloudMenuIds: bigint[] = [cloudDir.id]
    const pending: bigint[] = [cloudDir.id]
    while (pending.length > 0) {
      const parentId = pending.pop()!
      const children = await prisma.sysMenu.findMany({ where: { parentId } })
      for (const child of children) {
        if (child.perms === 'cloud:admin:quota') continue
        cloudMenuIds.push(child.id)
        pending.push(child.id)
      }
    }
    for (const menuId of cloudMenuIds) {
      await prisma.sysRoleMenu.upsert({
        where: { roleId_menuId: { roleId: commonRole.id, menuId } },
        update: {},
        create: { roleId: commonRole.id, menuId },
      })
    }
  }

  // P4a：common 角色授予「个人网站」整棵子树（无 admin 专属按钮，全部授予）；
  // cloud:file:public（设为公开）已由上方云盘子树 BFS 一并纳入（仅排除 cloud:admin:quota）
  const siteDir = await prisma.sysMenu.findFirst({
    where: { parentId: BigInt(0), name: '个人网站' },
  })
  if (siteDir) {
    // 收集个人网站整棵子树（目录 + 菜单 + 按钮）
    const siteMenuIds: bigint[] = [siteDir.id]
    const sitePending: bigint[] = [siteDir.id]
    while (sitePending.length > 0) {
      const parentId = sitePending.pop()!
      const children = await prisma.sysMenu.findMany({ where: { parentId } })
      for (const child of children) {
        siteMenuIds.push(child.id)
        sitePending.push(child.id)
      }
    }
    for (const menuId of siteMenuIds) {
      await prisma.sysRoleMenu.upsert({
        where: { roleId_menuId: { roleId: commonRole.id, menuId } },
        update: {},
        create: { roleId: commonRole.id, menuId },
      })
    }
  }

  // 4. admin 用户（已存在则不重置密码）并关联 admin 角色
  const passwordHash = await bcrypt.hash('Admin@123', 10)
  const adminUser = await prisma.sysUser.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      password: passwordHash,
      nickname: '超级管理员',
      email: 'admin@iplat.local',
      remark: '系统内置超管，不可禁用/删除/改角色',
    },
  })
  await prisma.sysUserRole.upsert({
    where: { userId_roleId: { userId: adminUser.id, roleId: adminRole.id } },
    update: {},
    create: { userId: adminUser.id, roleId: adminRole.id },
  })

  // 5. 内置字典（PRD F8）：通用状态、用户性别
  const dictSeeds: Array<{
    name: string
    type: string
    remark?: string
    data: Array<{ label: string; value: string; sort: number }>
  }> = [
    {
      name: '通用状态',
      type: 'sys_common_status',
      remark: '启用/禁用通用状态',
      data: [
        { label: '启用', value: '1', sort: 1 },
        { label: '禁用', value: '0', sort: 2 },
      ],
    },
    {
      name: '用户性别',
      type: 'sys_user_gender',
      remark: '用户性别',
      data: [
        { label: '未知', value: '0', sort: 1 },
        { label: '男', value: '1', sort: 2 },
        { label: '女', value: '2', sort: 3 },
      ],
    },
  ]
  for (const seed of dictSeeds) {
    const dictType = await prisma.sysDictType.upsert({
      where: { type: seed.type },
      update: {},
      create: { name: seed.name, type: seed.type, remark: seed.remark },
    })
    for (const item of seed.data) {
      const exist = await prisma.sysDictData.findFirst({
        where: { typeId: dictType.id, value: item.value },
      })
      if (!exist) {
        await prisma.sysDictData.create({
          data: { typeId: dictType.id, label: item.label, value: item.value, sort: item.sort },
        })
      }
    }
  }

  // 6. AI 厂商 + 示例模型（apiKey 空待管理员填写，示例模型默认停用）
  const providerSeeds: Array<{
    name: string
    code: string
    baseUrl: string
    models: Array<{
      displayName: string
      model: string
      inputPrice: number
      outputPrice: number
      maxContext: number
    }>
  }> = [
    {
      name: 'DeepSeek',
      code: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      models: [
        { displayName: 'DeepSeek V4 Flash', model: 'deepseek-v4-flash', inputPrice: 1, outputPrice: 3, maxContext: 128000 },
        { displayName: 'DeepSeek V4 Pro', model: 'deepseek-v4-pro', inputPrice: 4, outputPrice: 12, maxContext: 128000 },
        { displayName: 'DeepSeek V4 Flash Vision Exp', model: 'deepseek-v4-flash-vision-exp', inputPrice: 2, outputPrice: 6, maxContext: 128000 },
      ],
    },
    {
      name: 'Kimi',
      code: 'kimi',
      baseUrl: 'https://api.moonshot.cn/v1',
      models: [
        { displayName: 'Kimi 8K', model: 'moonshot-v1-8k', inputPrice: 12, outputPrice: 12, maxContext: 8192 },
      ],
    },
    {
      name: '通义千问',
      code: 'qwen',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      models: [
        { displayName: '通义千问 Plus', model: 'qwen-plus', inputPrice: 0.8, outputPrice: 2, maxContext: 131072 },
        { displayName: '通义千问 Turbo', model: 'qwen-turbo', inputPrice: 0.3, outputPrice: 0.6, maxContext: 131072 },
      ],
    },
    {
      name: '智谱 GLM',
      code: 'zhipu',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      models: [
        { displayName: 'GLM-4-Plus', model: 'glm-4-plus', inputPrice: 50, outputPrice: 50, maxContext: 128000 },
      ],
    },
  ]
  for (const providerSeed of providerSeeds) {
    const provider = await prisma.aiProvider.upsert({
      where: { code: providerSeed.code },
      update: {},
      create: {
        name: providerSeed.name,
        code: providerSeed.code,
        baseUrl: providerSeed.baseUrl,
        status: 1,
        sort: 0,
      },
    })
    for (const modelSeed of providerSeed.models) {
      const exists = await prisma.aiModel.findUnique({
        where: { providerId_model: { providerId: provider.id, model: modelSeed.model } },
      })
      if (!exists) {
        await prisma.aiModel.create({
          data: {
            providerId: provider.id,
            displayName: modelSeed.displayName,
            model: modelSeed.model,
            inputPrice: modelSeed.inputPrice,
            outputPrice: modelSeed.outputPrice,
            maxContext: modelSeed.maxContext,
            supportTool: 0,
            status: 0,
            sort: 0,
          },
        })
      }
    }
  }

  // 7. AI 套餐：体验版（月 10,000 积分）、标准版（月 100,000 积分）
  const planSeeds = [
    {
      name: '体验版',
      code: 'trial',
      monthlyCredits: BigInt(10000),
      price: 0,
      description: '免费体验，每月 10,000 积分',
      sort: 1,
    },
    {
      name: '标准版',
      code: 'standard',
      monthlyCredits: BigInt(100000),
      price: 19.9,
      description: '每月 100,000 积分',
      sort: 2,
    },
  ]
  for (const planSeed of planSeeds) {
    await prisma.aiPlan.upsert({
      where: { code: planSeed.code },
      update: {},
      create: planSeed,
    })
  }

  console.log(
    `seed 完成：角色 2 个，菜单新增 ${createdMenuIds.length} 条，admin 用户就绪，内置字典 2 组，AI 厂商 4 家、示例模型 7 个、套餐 2 个，云盘菜单树 + 个人网站菜单树 + common 授权已就绪`,
  )
}

main()
  .catch((error) => {
    console.error('seed 执行失败：', error)
    process.exit(1)
  })
  .finally(() => {
    void prisma.$disconnect()
  })
