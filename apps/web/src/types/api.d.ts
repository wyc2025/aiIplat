/** 统一响应结构 */
export interface ApiResult<T = unknown> {
  code: number
  message: string
  data: T
}

/** 分页返回 */
export interface PageResult<T = unknown> {
  list: T[]
  total: number
  pageNo: number
  pageSize: number
}

/** 分页请求参数 */
export interface PageQuery {
  pageNo?: number
  pageSize?: number
}

/** 登录返回 */
export interface TokenPair {
  accessToken: string
  refreshToken: string
  expiresIn: number
}

/** 菜单树节点（userinfo 返回） */
export interface MenuTreeNode {
  id: string
  parentId: string
  name: string
  /** 1 目录 2 菜单 */
  type: number
  path: string | null
  component: string | null
  perms: string | null
  icon: string | null
  sort: number
  visible: number
  children: MenuTreeNode[]
}

/** 用户信息（userinfo） */
export interface UserInfo {
  id: string
  username: string
  nickname: string
  email: string | null
  phone: string | null
  avatar: string | null
  gender: number
  status: number
  remark: string | null
  lastLoginAt: string | null
  lastLoginIp: string | null
  dept: { id: string; name: string } | null
}

/** userinfo 返回 */
export interface UserInfoResult {
  user: UserInfo
  roles: string[]
  perms: string[]
  menus: MenuTreeNode[]
}

// ========== system 域实体 ==========

export interface RoleItem {
  id: string
  name: string
  code: string
  sort: number
  status: number
  remark: string | null
  createdAt: string
}

export interface UserRow {
  id: string
  username: string
  nickname: string
  email: string | null
  phone: string | null
  avatar: string | null
  gender: number
  status: number
  remark: string | null
  lastLoginAt: string | null
  dept: { id: string; name: string } | null
  roles: { id: string; name: string; code: string }[]
}

export interface MenuItem {
  id: string
  parentId: string
  name: string
  type: number
  path: string | null
  component: string | null
  perms: string | null
  icon: string | null
  sort: number
  visible: number
  status: number
  createdAt: string
}

export interface DeptItem {
  id: string
  parentId: string
  name: string
  sort: number
  status: number
  createdAt: string
}

export interface DictTypeItem {
  id: string
  name: string
  type: string
  status: number
  remark: string | null
  createdAt: string
}

export interface DictDataItem {
  id: string
  typeId: string
  label: string
  value: string
  sort: number
  status: number
  remark: string | null
}

export interface LoginLogItem {
  id: string
  username: string
  ip: string | null
  browser: string | null
  os: string | null
  status: number
  message: string | null
  createdAt: string
}

export interface OperationLogItem {
  id: string
  username: string | null
  module: string | null
  action: string | null
  method: string | null
  url: string | null
  ip: string | null
  status: number | null
  errorMsg: string | null
  duration: number | null
  createdAt: string
}
