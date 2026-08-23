import { ApiProperty } from '@nestjs/swagger'
import type { SysDept, SysUser } from '@prisma/client'

/** userinfo 返回结构 */
export interface UserInfoResult {
  /** 用户信息（已剔除 password，含部门） */
  user: Omit<SysUser, 'password'> & { dept: SysDept | null }
  /** 角色标识列表，如 ['admin'] */
  roles: string[]
  /** 权限标识列表，超管为 ['*'] */
  perms: string[]
  /** 权限过滤后的菜单树 */
  menus: MenuTreeNode[]
}

/** 菜单树节点（userinfo 返回，含 type=1 目录 / 2 菜单；按钮权限走 perms 数组不进树） */
export class MenuTreeNode {
  @ApiProperty({ description: '菜单 ID（字符串）' })
  id!: string

  @ApiProperty({ description: '父菜单 ID，0 为根' })
  parentId!: string

  @ApiProperty({ description: '显示名' })
  name!: string

  @ApiProperty({ description: '1 目录 2 菜单' })
  type!: number

  @ApiProperty({ description: '路由地址', nullable: true })
  path!: string | null

  @ApiProperty({ description: '前端组件路径', nullable: true })
  component!: string | null

  @ApiProperty({ description: '权限标识', nullable: true })
  perms!: string | null

  @ApiProperty({ description: '图标名', nullable: true })
  icon!: string | null

  @ApiProperty({ description: '显示顺序' })
  sort!: number

  @ApiProperty({ description: '1 显示 0 隐藏（隐藏菜单仍注册路由，仅不进侧边栏）' })
  visible!: number

  @ApiProperty({ description: '子节点', type: [MenuTreeNode] })
  children!: MenuTreeNode[]
}
