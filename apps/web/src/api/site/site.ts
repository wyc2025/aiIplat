import { get, post, put, del } from '@/utils/request'
import type {
  SiteSiteInfo,
  SiteTemplateItem,
  SiteTemplateApplyResult,
  SiteColumnItem,
  SiteTagItem,
  SiteArticleItem,
  SiteArticleDetail,
  SiteCommentItem,
  PageResult,
} from '@/types/api'

// ========== 站点设置（site:site:manage） ==========

/** 我的站点（未开通返回 null） */
export const getMySite = () => get<SiteSiteInfo | null>('/site/mine')

/** 创建站点（slug 校验 + 建公开目录 + media/ + 模板复制） */
export const createMySite = (data: { slug: string; title: string; description?: string }) =>
  post<SiteSiteInfo>('/site/mine', data)

/** 编辑站点（title/description/slug/status/commentAudit，提供即更新） */
export const updateMySite = (data: {
  title?: string
  description?: string
  slug?: string
  status?: number
  commentAudit?: number
}) => put<SiteSiteInfo>('/site/mine', data)

// ========== 模板库（site:site:manage，P4b T44） ==========

/** 模板列表（读 assets/site-templates，实时不缓存） */
export const listTemplates = () => get<SiteTemplateItem[]>('/site/templates')

/** 应用模板（温和覆盖：同名文件软删进回收站，media/ 与模板外文件不动） */
export const applyTemplate = (templateId: string) =>
  post<SiteTemplateApplyResult[]>('/site/mine/apply-template', { templateId })

// ========== 栏目（site:column:*，裸数组由前端组树） ==========

export const listColumns = () => get<SiteColumnItem[]>('/site/column/list')

export const createColumn = (data: { parentId: number; name: string; sort?: number }) =>
  post<{ id: string; name: string }>('/site/column', data)

export const updateColumn = (id: number, data: { name?: string; sort?: number; parentId?: number }) =>
  put<{ id: string; name: string; parentId: string }>(`/site/column/${id}`, data)

export const removeColumn = (id: number) => del(`/site/column/${id}`)

// ========== 标签（site:tag:*） ==========

export const listTags = () => get<SiteTagItem[]>('/site/tag/list')

export const createTag = (name: string) => post<{ id: string; name: string }>('/site/tag', { name })

export const updateTag = (id: number, name: string) =>
  put<{ id: string; name: string }>(`/site/tag/${id}`, { name })

export const removeTag = (id: number) => del(`/site/tag/${id}`)

// ========== 文章（site:article:*，分页） ==========

export interface ArticleQuery {
  pageNo: number
  pageSize: number
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

export const updateArticle = (id: number, data: Partial<ArticleSaveDto>) =>
  put<{ id: string }>(`/site/article/${id}`, data)

/** 发布/下架（首次发布由后端写发布时间，下架再上架不刷新） */
export const updateArticleStatus = (id: number, status: number) =>
  put<{ id: string; status: number }>(`/site/article/${id}/status`, { status })

export const removeArticle = (id: number) => del(`/site/article/${id}`)

// ========== 评论（site:comment:*，分页） ==========

export interface CommentQuery {
  pageNo: number
  pageSize: number
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

export const removeComment = (id: number) => del(`/site/comment/${id}`)
