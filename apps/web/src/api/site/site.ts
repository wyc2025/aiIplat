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
  PageResult,
} from '@/types/api'

// ========== 站点 CRUD（site:site:manage，P4E API §10.2；命名空间 /site/manage/*） ==========

/** 我的站点列表（不分页，上限即配额）+ { limit, used } */
export const listSites = () => get<SiteListResult>('/site/manage/list')

/** 创建站点（配额 40118 + slug 校验 + 建公开目录/media//模板） */
export const createSite = (data: { slug: string; title: string; description?: string }) =>
  post<SiteSiteInfo>('/site/manage', data)

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

/** 删站（站点数据物理删 + 站点根移入回收站 + slug 释放，P4E R50/R53/R55） */
export const deleteSite = (id: string | number) =>
  del<{ deletedArticles: number; recycledRoot: boolean }>(`/site/manage/${id}`)

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

// ========== 栏目（site:column:*，裸数组由前端组树；P4E T61 必带 siteId） ==========

export const listColumns = (siteId: string | number) =>
  get<SiteColumnItem[]>('/site/column/list', { siteId })

export const createColumn = (data: { siteId: number; parentId: number; name: string; sort?: number }) =>
  post<{ id: string; name: string }>('/site/column', data)

export const updateColumn = (id: number, data: { name?: string; sort?: number; parentId?: number }) =>
  put<{ id: string; name: string; parentId: string }>(`/site/column/${id}`, data)

export const removeColumn = (id: number) => del(`/site/column/${id}`)

// ========== 标签（site:tag:*；P4E T61 必带 siteId） ==========

export const listTags = (siteId: string | number) => get<SiteTagItem[]>('/site/tag/list', { siteId })

export const createTag = (siteId: number, name: string) =>
  post<{ id: string; name: string }>('/site/tag', { siteId, name })

export const updateTag = (id: number, name: string) =>
  put<{ id: string; name: string }>(`/site/tag/${id}`, { name })

export const removeTag = (id: number) => del(`/site/tag/${id}`)

// ========== 文章（site:article:*，分页；P4E T61 必带 siteId） ==========

export interface ArticleQuery {
  pageNo: number
  pageSize: number
  siteId: number
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
  siteId: number
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

export const updateArticle = (id: number, data: Partial<Omit<ArticleSaveDto, 'siteId'>>) =>
  put<{ id: string }>(`/site/article/${id}`, data)

/** 发布/下架（首次发布由后端写发布时间，下架再上架不刷新） */
export const updateArticleStatus = (id: number, status: number) =>
  put<{ id: string; status: number }>(`/site/article/${id}/status`, { status })

export const removeArticle = (id: number) => del(`/site/article/${id}`)

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
