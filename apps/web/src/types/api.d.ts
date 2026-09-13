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

// ========== cloud 域实体 ==========

/** 云盘文件/文件夹（list 接口返回字段；ID 以字符串返回，避免 bigint 精度问题） */
export interface CloudFile {
  id: string
  name: string
  isDir: boolean
  size: string
  ext: string | null
  mime: string | null
  /** 修改时间（ISO 字符串） */
  updateTime: string
  /** 是否存在有效公开链接（仅 list 接口返回；文件夹恒 false；upload/mkdir/rename 单对象返回无此字段） */
  shared?: boolean
  /** 公开性原始三态 int（仅 list 接口返回；R23/走查 W2：0=继承父目录 / 1=显式公开 / 2=显式阻断；有效公开性以开放层访问时上溯判定为准，列表不逐行算链） */
  isPublic?: number
  /** 公开链接 token（仅 list 接口返回；仅 isPublic=1 时有值，P4c F1，供复制公开链接） */
  publicToken?: string | null
  /** 公开文件夹是否允许访客浏览列表（0|1，仅文件夹有意义，P4c D32） */
  allowListing?: number
  /** 是否位于站点子树（含站点根本身，仅 list 接口返回；P4d R46/D49：前端据此切换公开/私有按钮组） */
  inSite?: boolean
  /** 是否站点根目录（仅 list 接口返回；P4d R45：站点根恒公开，不提供「设为私有」） */
  isSiteRoot?: boolean
}

/** 面包屑节点 */
export interface BreadcrumbItem {
  id: string
  name: string
}

/** 配额信息 */
export interface CloudQuota {
  quota: string
  used: string
}

/** 目录列表响应（list 接口返回，含配额联动） */
export interface CloudFileList {
  list: CloudFile[]
  quota: string
  used: string
}

// ========== cloud 域公开链接 / 公开访问（P4c T46/T47） ==========

/** 设为公开响应（POST /cloud/file/:id/public；allowListing 仅文件夹有值，文件为 null） */
export interface PublicLinkResult {
  publicToken: string
  viewUrl: string
  allowListing: number | null
}

/** 公开文件元信息（GET /api/pub/{f,d}/info；size 为 number） */
export interface PubFileInfo {
  name: string
  size: number
  mime: string
  ext: string
  updatedAt: string
}

/** 公开文件夹单层列表项（GET /api/pub/d/{token}/list） */
export interface PubListItem {
  name: string
  isDir: boolean
  size: number
  ext: string
  updatedAt: string
}

/** 公开文件夹单层列表响应 */
export interface PubFolderList {
  path: string
  items: PubListItem[]
}

/** 分享链接（我的分享；status 由后端计算：1 有效 / 0 已停止 / 2 已过期） */
export interface CloudShare {
  id: string
  fileId: string
  fileName: string
  /** P4d：源为文件夹时 itemType='folder'（管理页类型列） */
  itemType: 'file' | 'folder'
  /** P4d：是否设置提取码（不返回密码本体） */
  hasPassword: boolean
  size: string
  /** 源文件是否已被删除（彻底删除/回收站中） */
  fileDeleted: boolean
  token: string
  visitCount: number
  expireAt: string | null
  status: 1 | 0 | 2
  createTime: string
}

/** 创建分享返回（url 为站内相对路径 /share/:token，需自行拼 origin；id 用于停止/延长） */
export interface CloudShareCreateResult {
  id: string
  token: string
  url: string
  expireAt: string | null
  /** P4d：当前是否设置了提取码 */
  hasPassword: boolean
}

/** 回收站项 */
export interface CloudRecycleItem {
  id: string
  name: string
  isDir: boolean
  size: string
  deletedAt: string
  parentId: string
  parentName: string | null
}

/** 访客分享信息（P4d 扩展：needPassword/itemType/mime/ext 供密码门与预览分支） */
export interface CloudSharePublic {
  token: string
  fileName: string
  itemType: 'file' | 'folder'
  size: string
  mime: string | null
  ext: string | null
  updatedAt: string
  expireAt: string | null
  isExpired: boolean
  visitCount: number
  /** 是否需要提取码（前端未持 sid 时信息接口返回 30017） */
  needPassword: boolean
}

/** 提取码校验结果（P4d：通过后签发短期凭证 sid，后续请求经 X-Share-Sid 携带） */
export interface ShareVerifyResult {
  sid: string
  expiresIn: number
  needPassword: boolean
}

/** 文件夹分享单层列表项（形态同 pub d/list） */
export interface ShareListItem {
  name: string
  isDir: boolean
  size: number
  ext: string
  updatedAt: string
}

/** 文件夹分享单层列表响应 */
export interface ShareFolderList {
  path: string
  items: ShareListItem[]
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

// ========== site 域实体（P4a；P4E 多站点） ==========

/** 站点（P4E 集合端点 list item / 详情；不再有「未开通为 null」语义） */
export interface SiteSiteInfo {
  id: string
  slug: string
  title: string
  description: string | null
  /** 1 启用 / 0 停用 */
  status: number
  /** 评论审核开关：1 开 / 0 关 */
  commentAudit: number
  /** 开放入口完整路径（/api/open/{slug}/） */
  siteUrl: string
  rootFolderId: string
  mediaFolderId: string
  /** 文章数（含草稿） */
  articleCount: number
  createdAt: string
}

/** 站点集合端点响应（P4E API §10.2：limit/used 为站点数配额） */
export interface SiteListResult {
  list: SiteSiteInfo[]
  limit: number
  used: number
}

/** 站点配额（admin 查询/调整，P4E API §10.4） */
export interface SiteQuotaInfo {
  userId: string
  limit: number
  used: number
}

/** 模板列表项（P4b T44；id = 模板目录名） */
export interface SiteTemplateItem {
  id: string
  name: string
  description: string
}

/** 应用模板的逐文件结果（部分成功语义；action 为 created/overwritten） */
export interface SiteTemplateApplyResult {
  path: string
  ok: boolean
  action?: 'created' | 'overwritten'
  size?: number
  error?: string
}

/** 栏目平铺项（list 返回裸数组，前端组树） */
export interface SiteColumnItem {
  id: string
  parentId: string
  name: string
  sort: number
  articleCount: number
  createdAt: string
  /** 前端组树用（children 由前端构造） */
  children?: SiteColumnItem[]
}

/** 标签项（list 返回裸数组） */
export interface SiteTagItem {
  id: string
  name: string
  articleCount: number
  createdAt: string
}

/** 文章列表项 */
export interface SiteArticleItem {
  id: string
  columnId: string
  columnName: string
  title: string
  summary: string
  coverPath: string | null
  tagIds: string[]
  wordCount: number
  viewCount: number
  /** 0 草稿 / 1 已发布 */
  status: number
  publishedAt: string | null
  createdAt: string
  updatedAt: string
}

/** 文章详情（列表项字段 + 正文） */
export interface SiteArticleDetail extends SiteArticleItem {
  contentMd: string
}

/** 评论列表项 */
export interface SiteCommentItem {
  id: string
  articleId: string
  articleTitle: string
  nickname: string
  content: string
  ip: string
  /** 0 待审核 / 1 已通过 / 2 已驳回 */
  auditStatus: number
  createdAt: string
}
