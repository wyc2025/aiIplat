import { get, post, put, del } from '@/utils/request'
import type {
  SiteSiteInfo,
  SiteListResult,
  SiteQuotaInfo,
  SiteTemplateItem,
  SiteTemplateApplyResult,
  SiteColumnItem,
  SiteTagItem,
  SiteArticleItem,
  SiteArticleDetail,
  SiteCommentItem,
  ArticleSiteRef,
  ColumnSiteRef,
  PageResult,
} from '@/types/api'

// ========== 站点 CRUD（site:site:manage，P4E API §10.2；命名空间 /site/manage/*） ==========

/** 我的站点列表（不分页，上限即配额）+ { limit, used } */
export const listSites = () => get<SiteListResult>('/site/manage/list')

/** 创建站点（配额 40118 + slug 校验 + 建公开目录/media//模板；P7 D73 开站即灌内容） */
export const createSite = (data: {
  slug: string
  title: string
  description?: string
  /** 'all' = 内容池全部已发布文章（缺省）；[] = 不发表；或指定文章 ID 数组 */
  publishArticleIds?: 'all' | number[]
}) => post<SiteSiteInfo>('/site/manage', data)

/** 站点详情（非属主 40119） */
export const getSite = (id: string | number) => get<SiteSiteInfo>(`/site/manage/${id}`)

/** 编辑站点（title/description/slug/status/commentAudit，提供即更新） */
export const updateSite = (
  id: string | number,
  data: {
    title?: string
    description?: string
    slug?: string
    status?: number
    commentAudit?: number
  },
) => put<SiteSiteInfo>(`/site/manage/${id}`, data)

/**
 * 删站（P7 D73 修订）：只删该站的展示关联 —— 评论随站删、文章从该站下架（本体保留在内容池）；
 * 站点根移入回收站 + slug 释放（P4E R50/R53/R55）。
 */
export const deleteSite = (id: string | number) =>
  del<{ unpublishedArticles: number; deletedComments: number; recycledRoot: boolean }>(
    `/site/manage/${id}`,
  )

// ========== 站点配额（admin，site:admin:quota，P4E API §10.4） ==========

/** 查询用户站点配额（limit/used，used = 当前站点数） */
export const getUserSiteQuota = (userId: string) =>
  get<SiteQuotaInfo>('/site/admin/quota', { userId })

/** 调整用户站点配额（下限 = 该用户当前站点数） */
export const updateUserSiteQuota = (data: { userId: string; limit: number }) =>
  put<SiteQuotaInfo>('/site/admin/quota', data)

// ========== 模板库（site:site:manage，P4b T44 + P4E T61 站点化） ==========

/** 模板列表（读 assets/site-templates，实时不缓存） */
export const listTemplates = () => get<SiteTemplateItem[]>('/site/templates')

/** 应用模板（温和覆盖：同名文件软删进回收站，media/ 与模板外文件不动；站点级写操作，收在 manage 命名空间） */
export const applyTemplate = (siteId: string | number, templateId: string) =>
  post<SiteTemplateApplyResult[]>(`/site/manage/${siteId}/apply-template`, { templateId })

// ========== 栏目（site:column:*，裸数组由前端组树；P7 D73 用户级，站点侧显隐走 setColumnSites） ==========

/** 栏目列表：P7 起不带 siteId（用户级），返回含每栏目的展示站点 sites */
export const listColumns = () => get<SiteColumnItem[]>('/site/column/list')

export const createColumn = (data: {
  parentId: number
  name: string
  sort?: number
  /** 展示站点（缺省 = 全部站点可见） */
  siteIds?: number[]
}) => post<{ id: string; name: string }>('/site/column', data)

export const updateColumn = (id: number, data: { name?: string; sort?: number; parentId?: number }) =>
  put<{ id: string; name: string; parentId: string }>(`/site/column/${id}`, data)

export const removeColumn = (id: number) => del(`/site/column/${id}`)

/** 替换式管理栏目在哪些站点展示（空数组 = 全站不展示） */
export const setColumnSites = (
  id: number,
  data: { sites: Array<{ siteId: number; sort?: number }> },
) => put<{ ok: boolean; sites: ColumnSiteRef[] }>(`/site/column/${id}/sites`, data)

// ========== 标签（site:tag:*；P7 D73 用户级，标签跟随文章） ==========

export const listTags = () => get<SiteTagItem[]>('/site/tag/list')

export const createTag = (name: string) => post<{ id: string; name: string }>('/site/tag', { name })

export const updateTag = (id: number, name: string) =>
  put<{ id: string; name: string }>(`/site/tag/${id}`, { name })

export const removeTag = (id: number) => del(`/site/tag/${id}`)

// ========== 文章（site:article:*，分页；P4E T61 必带 siteId） ==========

export interface ArticleQuery {
  pageNo: number
  pageSize: number
  /** 可选：按发表站点筛选（不传 = 全部内容池文章，P7 D73） */
  siteId?: number
  columnId?: number
  tagId?: number
  status?: number
  keyword?: string
  [key: string]: unknown
}

export const listArticles = (params: ArticleQuery) =>
  get<PageResult<SiteArticleItem>>('/site/article', params)

export const getArticle = (id: number) => get<SiteArticleDetail>(`/site/article/${id}`)

export interface ArticleSaveDto {
  /** 发表站点集合（替换式；缺省新建 = 不发表到任何站） */
  siteIds?: number[]
  columnId: number
  title: string
  summary?: string
  tagIds?: number[]
  coverPath?: string
  contentMd: string
  status: number
}

export const createArticle = (data: ArticleSaveDto) =>
  post<{ id: string }>('/site/article', data)

/** 编辑：siteIds 提供即替换式更新发表集合（不传 = 不动；空数组 = 全站下架） */
export const updateArticle = (id: number, data: Partial<ArticleSaveDto>) =>
  put<{ id: string }>(`/site/article/${id}`, data)

/** 替换式管理文章发表站点（每站可置顶；空数组 = 全站下架，文章本体保留） */
export const setArticleSites = (
  id: number,
  data: { sites: Array<{ siteId: number; isTop?: boolean }> },
) => put<{ ok: boolean; sites: ArticleSiteRef[] }>(`/site/article/${id}/sites`, data)

/** 发布/下架（首次发布由后端写发布时间，下架再上架不刷新） */
export const updateArticleStatus = (id: number, status: number) =>
  put<{ id: string; status: number }>(`/site/article/${id}/status`, { status })

export const removeArticle = (id: number) => del(`/site/article/${id}`)

// ========== 文章创作增强（P8）：文件导入 + 一键排版（均只解析/排版，不落库） ==========

/** 导入解析结果（字段可直接填入编辑表单） */
export interface ArticleImportResult {
  fileId: string
  filename: string
  title: string
  contentMd: string
  summary: string
  wordCount: number
  /** 与平台已有标签匹配上的（前端直接勾选） */
  matchedTags: Array<{ id: string; name: string }>
  /** 未匹配的标签名（提示用户，不自动创建） */
  unmatchedTags: string[]
  warnings: string[]
  meta: {
    filename: string
    ext: string
    size: number
    encoding: 'utf8' | 'gbk'
    format: 'markdown' | 'text'
  }
}

/** 从云盘已有文件导入（md / markdown / txt；≤2MB） */
export const importArticleFile = (fileId: number) =>
  post<ArticleImportResult>('/site/article/import', { fileId: String(fileId) })

/** 排版选项（缺省三档全开） */
export interface ArticleFormatOptions {
  structure?: boolean
  punctuation?: boolean
  cjkSpacing?: boolean
}

/** 排版结果 */
export interface ArticleFormatResult {
  contentMd: string
  changed: boolean
  stats: { rules: string[]; lines: number; charsBefore: number; charsAfter: number }
}

/** 一键排版（不落库；前端 diff 预览确认后再保存文章） */
export const formatArticle = (contentMd: string, options?: ArticleFormatOptions) =>
  post<ArticleFormatResult>('/site/article/format', { contentMd, options })

// ========== 评论（site:comment:*，分页；P4E T61 必带 siteId） ==========

export interface CommentQuery {
  pageNo: number
  pageSize: number
  siteId: number
  auditStatus?: number
  articleId?: number
  keyword?: string
  [key: string]: unknown
}

export const listComments = (params: CommentQuery) =>
  get<PageResult<SiteCommentItem>>('/site/comment', params)

/** 审核（1 通过 / 2 驳回） */
export const auditComment = (id: number, auditStatus: number) =>
  put<{ id: string; auditStatus: number }>(`/site/comment/${id}/audit`, { auditStatus })

/** 作者回复（P6 D69/R71：一级回复，重复回复 = 覆盖；content 空串 = 清除已有回复） */
export const replyComment = (id: number, content: string) =>
  put<{ ok: boolean; id: string; replyContent: string | null; replyAt: string | null }>(
    `/site/comment/${id}/reply`,
    { content },
  )

export const removeComment = (id: number) => del(`/site/comment/${id}`)
