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
    ],
  },
  // 个人中心：路由存在但不进侧边栏菜单（visible=0）
  {
    name: '个人中心',
    type: 2,
    path: '/profile',
    component: 'profile/index',
    icon: 'Postcard',
    sort: 3,
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

  // 3. common 角色仅关联「首页工作台」
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

  console.log(`seed 完成：角色 2 个，菜单新增 ${createdMenuIds.length} 条，admin 用户就绪，内置字典 2 组`)
}

main()
  .catch((error) => {
    console.error('seed 执行失败：', error)
    process.exit(1)
  })
  .finally(() => {
    void prisma.$disconnect()
  })
