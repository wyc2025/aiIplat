# API-P4E 增补 —— 多站点（配额化）+ 删站 + AI 多站语义

> **[已并入]** 本增补已于 T65（2026-09-12）作为 **§10** 并入 `docs/API.md`。
> 本文件保留为历史细节参考，**与 API.md 冲突时以 API.md 与代码为准**。两处口径已定案（2026-09-13）：
> ① **命名空间**：站点级端点全部收在 `/api/site/manage/*`——`GET|POST /api/site/manage`、`GET|PUT|DELETE /api/site/manage/:id`、`POST /api/site/manage/:id/apply-template`（原文的 `/api/site/list`、`/api/site/:id`、`/api/site/:id/apply-template` 均不复存在；顶层只剩 `templates` / `column|tag|article|comment` / `admin/quota`）；
> ② **错误码**：实际为 **40118 配额满 / 40119 不存在或非属主**（PRD 名义 40117/40118 因 40117 已被 P4c `CloudListingDisabled` 占用而顺延；已决策保持实际编号，PRD 与 API 文档均已对齐）。
> 与 PRD-P4E-SITE（D51~~D57 / R47~~R57）对齐。30020 站点根禁止直接删除；40101 收窄为仅「未开通站点」。

## 10.1 变更总览

- **废弃**：`GET/POST/PUT /api/site/mine`、`POST /api/site/mine/apply-template`（D52 无兼容期，前端同期切换）
- **替代**：站点集合端点（§10.2）；内容端点全部 siteId 作用域化（§10.3）
- **新增**：删站、admin 配额（§10.2/§10.4）

## 10.2 站点 CRUD（登录态，site:site:manage；写操作挂 @OperationLog('网站',xxx)）

| 方法   | 路径           | 说明                                                                                                                                                                                                                                                                              |
| ------ | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | /api/site/list | 我的站点列表（不分页，上限即配额）：`{ list: [{ id, slug, title, description, status, commentAudit, siteUrl, rootFolderId, mediaFolderId, articleCount, createdAt }], limit, used }`                                                                                              |
| POST   | /api/site      | 建站：`{ slug, title, description? }`；slug 规则 `^[a-z0-9][a-z0-9-]{2,31}$` + 保留字黑名单（40103）+ 全局唯一（40102）；**配额满 40117**（R47）；创建链同原 14.3（CloudFacade 建目录——根目录名 = slug（D57）——+ media/ 子目录 + 模板四文件 + 落库 + 失败 discardSiteDraft 回滚） |
| GET    | /api/site/:id  | 站点详情（字段同 list item + 无 articleCount 可含）；非属主 40118                                                                                                                                                                                                                 |
| PUT    | /api/site/:id  | 编辑 `{ title?, description?, slug?, status?, commentAudit? }`；改 slug 同规则校验 + `DEL site:resolve:{旧slug}` + scanDel `site:data:{siteId}:*`；status 0 停用即开放层全 40400                                                                                                  |
| DELETE | /api/site/:id  | **删站**（R50/R53/R55）：site 域六表数据物理删 + 站点根连同子树软删进回收站（used 不动，可还原为普通文件夹）+ 缓存三族清理 + slug 释放；响应 `{ deletedArticles, recycledRoot: true }` 供前端结果提示                                                                             |

## 10.3 内容端点 siteId 作用域化（T61）

> 通用约定：list/create 类以请求 siteId 为准（属主校验 40118）；update/delete 按实体 id 反查所属站点再校验属主，**不信任**请求里的 siteId。

| 端点                                                    | 变更                                                             |
| ------------------------------------------------------- | ---------------------------------------------------------------- |
| GET /api/site/column/list                               | 必带 `?siteId=`                                                  |
| POST /api/site/column                                   | body 加 `siteId`                                                 |
| PUT/DELETE /api/site/column/:id                         | 不变（实体反查属主）                                             |
| GET /api/site/tag/list                                  | 必带 `?siteId=`                                                  |
| POST /api/site/tag                                      | body 加 `siteId`                                                 |
| PUT/DELETE /api/site/tag/:id                            | 不变（实体反查）                                                 |
| GET /api/site/article（分页）                           | 必带 `?siteId=`；筛选 columnId/tagId/status/keyword 不变         |
| GET /api/site/article/:id                               | 不变（实体反查）                                                 |
| POST /api/site/article                                  | body 加 `siteId`                                                 |
| PUT /api/site/article/:id、PUT /:id/status、DELETE /:id | 不变（实体反查）                                                 |
| GET /api/site/comment（分页）                           | 必带 `?siteId=`；筛选 auditStatus/articleId/keyword 不变         |
| PUT /api/site/comment/:id/audit、DELETE /:id            | 不变（实体反查）                                                 |
| POST /api/site/:id/apply-template                       | 路径参数站点化（替代原 /mine/apply-template）；模板规则 R20 不变 |

封面上传不变：复用 `POST /api/cloud/file/upload?parentId={mediaFolderId}&overwrite=1`，mediaFolderId 取自站点详情。

## 10.4 admin 配额（site:admin:quota，超管 `*` 自动覆盖，common 不授）

| 方法 | 路径                          | 说明                                                                                                |
| ---- | ----------------------------- | --------------------------------------------------------------------------------------------------- |
| GET  | /api/site/admin/quota?userId= | `{ userId, limit, used }`（used = 当前站点数）                                                      |
| PUT  | /api/site/admin/quota         | `{ userId, limit }`；**下限 = used**（R48，低于下限 400 参数错误）；懒创建 upsert；挂 @OperationLog |

## 10.5 cloud 域既有端点的行为变化（无新端点）

- `file.list` 响应的 `inSite/isSiteRoot` 扩展为任一站点子树/根语义（R51，前端无感）
- `POST /cloud/file/:id/move`：目标或源为任一站点根 → 30019（既有码，判定范围扩大）
- `DELETE /cloud/file/:id` 及批量删除/回收站入口：命中任一站点根 → **30020**（R52 新增拦截）
- `POST /cloud/share` 等分享端点：不变（分享语义与站点公开本就解耦，P4d D49）

## 10.6 开放层（无变化）

`/api/open/{slug}/...` 与 `/api/pub/...` 契约不变；多站仅意味着更多合法 slug。`site:resolve` 缓存键天然按 slug 隔离。

## 10.7 AI 工具参数契约（供 ToolRegistry 注册，非 HTTP 端点）

| 工具                                                | parameters                      | 回喂要点                                                                                                      |
| --------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| list_site_files / read_site_file / write_site_files | 加 `slug?: string`              | 多站省略 → `{ needSitePick:true, sites:[{slug,title}] }`；查无 → `{ ok:false, errorCode:40118, sites:[...] }` |
| create_site（新，write 确认卡）                     | `{ slug, title, description? }` | 成功 `{ ok:true, site:{ slug, title, siteUrl } }`；失败 `{ ok:false, errorCode:40117                          | 40102 | 40103, message, limit?, used? }` 不抛栈 |
