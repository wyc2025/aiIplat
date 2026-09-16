# API-P7-增补（内容池化 · 文章路径美化）

> ✅ **已并入（2026-09-16，T87）**：主文档 `API.md` **§14**（本次增补全文）。**冲突以主文档为准**，本文件保留为历史参考。

> 对应 **API.md 新增 §14**，并修订 §10.3（内容端点 siteId 作用域化——本期起内容端点改用户级）。
> 编号续接：决策 D73~D77、规则 R75~R78、任务 T83~T87。**新增错误码 1 个（40120）；新增 HTTP 端点 2 个；工具数不变（28）**。

---

## 14.1 管理端变更总览（撤销 §10.3 的 siteId 必带口径；评论除外）

| 端点 | 变更 |
|---|---|
| GET /api/site/article（分页） | **去 siteId 必带** → 用户级分页；siteId 降为可选筛选（按「发表到该站」过滤）；item + `sites: [{ id, name, slug, isTop, publishedAt }]` |
| POST /api/site/article | body `siteId` → `siteIds: number[]`（可空 = 不发表到任何站，纯草稿躺池） |
| PUT /api/site/article/:id | body + `siteIds?`（替换式更新发表集合；不传 = 不动） |
| PUT /api/site/article/:id/sites | **新增**，见 §14.2 |
| GET /api/site/column/list | **去 siteId 必带** → 用户级；item + `sites: [{ id, name, sort }]`；articleCount 改用户级口径 |
| POST /api/site/column | body `siteId` → `siteIds?: number[]`（缺省 = 全部站点可见） |
| PUT /api/site/column/:id/sites | **新增**，见 §14.2 |
| GET /api/site/tag/list、POST /api/site/tag | 同去 siteId 化（标签跟随文章，无显隐配置） |
| GET /api/site/comment（分页） | **siteId 必带不变**（D75 按站隔离；实现从 join 文章反查改直列 site_id，契约不变） |
| POST /api/site/manage（建站） | body + `publishArticleIds?`，见 §14.3 |
| DELETE /api/site/manage/:id（删站） | 响应契约变化，见 §14.4 |
| GET /api/site/manage/list | item `articleCount` 口径改「status=1 且存在本站 publish 行」 |

通用约束：归属校验统一为 user_id 直等，跨用户 40119；siteIds 中含他人/不存在站点 → 40119；siteIds 长度 ≤100、参数非法 → 40001。

## 14.2 发表/显隐关联管理端点（新增 2 个）

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| PUT | `/api/site/article/:id/sites` | `site:article:update` | 替换式管理文章发表关联（含每站置顶） |
| PUT | `/api/site/column/:id/sites` | `site:column:update` | 替换式管理栏目显隐 |

**PUT /api/site/article/:id/sites**

```json
{ "sites": [{ "siteId": 2, "isTop": true }, { "siteId": 5 }] }
```

- 替换式：提交集合 = 最终集合；**空数组 = 全站下架**（publish 行清空，文章本体保留）
- 文章须 status=1 才会实际对外可见（status=0 时关联可预建，上架即生效）
- 返回 `{ ok: true, sites: [{ id, name, slug, isTop, publishedAt }] }`（最终态）

**PUT /api/site/column/:id/sites**

```json
{ "sites": [{ "siteId": 2, "sort": 1 }, { "siteId": 5, "sort": 3 }] }
```

- 替换式：空数组 = 该栏目在所有站点隐藏（栏目本体保留）
- 返回 `{ ok: true, sites: [{ id, name, sort }] }`

错误码（两端点同）：文章/栏目不存在或非属主 → 40119；siteId 非法/含他人站点 → 40119；参数非法 → 40001。

## 14.3 建站 onboarding（POST /api/site/manage body 扩展）

```json
{ "slug": "blog2", "title": "二号站", "publishArticleIds": "all" }
```

| 字段 | 取值 | 语义 |
|---|---|---|
| publishArticleIds | `"all"`（**缺省**） | 全部 status=1 文章发表到新站 + 全部栏目对新站可见 |
| | `number[]` | 仅这些文章发表（栏目仍全可见） |
| | `[]` | 空站（老行为） |

非法 articleId（不存在/非本人）→ 40119；失败随建站事务回滚（discardSiteDraft 既有）。响应不变。

## 14.4 删站响应契约变化（DELETE /api/site/manage/:id）

```json
// 旧：{ "deletedArticles": 12, "recycledRoot": true }
// 新：
{ "unpublishedArticles": 12, "deletedComments": 34, "recycledRoot": true }
```

语义：文章**下架不删本体**（内容池保留，D73）；评论按站物理删（D75）。前端结果提示文案同步：「12 篇文章已从此站下架（内容保留）、34 条评论已删除」。

## 14.5 AI 工具契约变更（T85，工具数不变 28）

| 工具 | 变更 |
|---|---|
| create_site_article | `+ siteIds?: number[]`；status=0（默认草稿）**免选站**（siteIds 缺省空）；status=1 必须解析发表目标（slug / 单站直通 / 多站 needSitePick，resolveSiteForTool 四分支不变）；status=1 时同步建 publish 行；与 coverPath（§13.5）并存 |
| update_site_article | `+ siteIds?`（替换式）；摘要列变更字段含站点增删 |
| publish_site_article | 去 slug?：`{ id, status }` 全局上下架；上架且零发表站 → 摘要含「已发布但未发表到任何站点」警示行 |
| list_site_articles | 去 slug?、`+ siteId?`（可选筛选「发表到某站」）；item + `sites: [{ id, name, isTop }]` |
| read_site_article | 去 slug?（用户级直读） |
| ensure_site_column / ensure_site_tags | 去 slug?（用户级幂等；ensure 栏目默认全站可见） |
| 评论三工具（§13.4） | 不变（slug? 解析不变，评论按站 D75） |
| delete_site | 确认卡摘要改「N 篇文章将从此站下架（本体保留在内容池）+ M 条评论将删除」 |

失败回喂口径不变（`{ ok:false, errorCode, message }` 不抛栈；40119/40001 复用）。

## 14.6 路径美化（D77/R78，行为变化无契约变化）

- `GET /api/open/:slug/{*path}` 回退链：无扩展名未命中 → ① 目录语义（301/index.html，既有）→ ② 站点 `spa_fallback` 入口（真实存在才输出）→ ③ 40400；带扩展名未命中严格 40400
- 回退命中/目录命中**不写负缓存**；回退输出走既有 CSP/MIME/ETag/限流全链
- `template.json` 新增可选字段 `spaFallback`（相对站点根，默认模板声明 `"index.html"`）；建站/应用模板时读入 `site_site.spa_fallback`；存量站点为 NULL = 行为不变
- 默认模板文章地址：`/article?id=9` → `/article/9`（模板内部行为，开放 API 数据端点契约不变）

## 14.7 错误码增量（+1）

| 码 | 标识 | 文案 | 触发 |
|---|---|---|---|
| 40120 | SiteUserHasContent | 用户名下有站点内容（文章/栏目/标签），请先清理 | 删用户预检：无站点（40112 不挡）但有内容行 |

## 14.8 编号登记

| 系列 | 本期使用 | 说明 |
|---|---|---|
| 决策 | D73~D77 | 见 PRD-P7 §2 |
| 需求 | R75~R78 | 见 PRD-P7 §3 |
| 任务 | T83~T87 | 见 PRD-P7 §5；实施顺序 T83→T84→(T85∥T86)→T87 |
| 错误码 | **+1（40120）** | 其余复用 40001/40110/40119/40400 |
| HTTP 端点 | **+2** | PUT article/:id/sites、PUT column/:id/sites |
| AI 工具 | 28 不变 | 7 个 CMS 工具签名调整（§14.5） |
| 新表 | +2 | site_article_publish、site_column_display |
