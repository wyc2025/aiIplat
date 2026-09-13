# ARCHITECTURE-P4E 增补 —— 多站点（配额化）+ 删站 + AI 多站语义 + sid 脱敏

> **[已并入]** 本增补已于 T65（2026-09-12）作为 **§18** 完整并入 `docs/ARCHITECTURE.md`。两处口径已定案（2026-09-13）：**命名空间** `/api/site/manage/*`（原文写作 `/api/site/list` + `/api/site/:id`，应用模板亦已收进 `manage`）；**错误码** 40118（配额满）/40119（不存在或非属主）（名义 40117/40118 因 40117 已被 P4c 占用而顺延，已决策保持实际编号）。
> 本文件保留为历史细节参考（同 P3/P4a/P4b/P4c/P4d 惯例），**与主文档冲突时以主文档与代码为准**。
> 编号与 PRD-P4E-SITE 对齐（D51~~D57 / R47~~R57 / T59~~T65）。

## 18.1 数据库变更（site 域）

1. **`site_site` 解除 `user_id` UNIQUE**：迁移只删唯一索引、补普通索引 `idx_site_user(user_id)`（多站下按用户查列表）；`slug` UNIQUE 不动。
2. **新表 `site_quota`（照 cloud_usage 先例）**：

| 列                        | 类型      | 说明                                      |
| ------------------------- | --------- | ----------------------------------------- |
| user_id                   | bigint PK | 懒创建（首次建站/查配额时 upsert）        |
| quota                     | int       | 站点数上限，默认取配置 SITE_DEFAULT_LIMIT |
| create_time / update_time | datetime  | 惯例                                      |

3. 配置：`site.defaultLimit`，env `SITE_DEFAULT_LIMIT`，默认 `1`（与现状行为一致）。注意**站点数配额是 count 语义不是字节**，下限校验 R48 用 `count(site_site where user_id)`。

## 18.2 后端结构变更（modules/site/）

```
site/
├── manage/                  # 站点 CRUD：mine 系列 → 集合端点改造（T60）
│   ├── manage.controller.ts # GET /api/site/list、POST /api/site、GET/PUT/DELETE /api/site/:id
│   ├── manage.service.ts    # create（+配额校验 R47）/ update / delete（§18.3 级联）
│   └── admin.controller.ts  # GET/PUT /api/site/admin/quota（site:admin:quota，照 cloud admin 先例）
├── quota/
│   └── quota.service.ts     # getLimit(userId) 懒创建 / checkCanCreate(userId) / adminUpdate（下限=站点数）
├── facade/
│   ├── site-facade.service.ts  # + getSites(userId) / resolveSite(userId, slug?)（R56）/ createSite(userId, dto)（R57 委托 manage）
│   └── site-root.service.ts    # getRootFolderId → getRootFolderIds(userId): string[]；isSiteRoot 改集合判定（R51）
└── article/column/tag/comment/ # 控制器与 service 全部 siteId 作用域化（T61）
```

- **配额单点**：`quota.service.checkCanCreate` 只在 `manage.create` 链首调用——手动建站与 AI create_site 同一入口，40117 口径天然一致（D55）。
- **属主校验统一**：`manage.getOwnedSite(userId, siteId)` → 40118；内容端点按实体 `site_id` 反查站点再校验属主，避免信任前端传的 siteId 与实体不匹配（list/create 类以 siteId 为准，update/delete 类以实体反查为准）。
- **SiteRootService 多站化**（R51）：`getRootFolderIds` 一次查出用户全部站点根 id（站点数受配额限制，集合很小，无分页必要）；cloud 域 `file.list` 的 `inSite` = 行的祖先链命中**任一**根、`isSiteRoot` = 行本身是**任一**根；move 的 R37 保护同口径扩展，**新增 R52 删除保护（30020）**：cloud 删除/回收站入口对站点根直接拦截，提示先删站点。

## 18.3 删站级联（manage.service.delete，R50/R53/R55）

```
属主校验（40118）
→ 事务内物理删：site_comment → site_article_tag → site_article → site_tag → site_column → site_site（R7 传统，无回收站）
→ CloudFacade.removeSiteRoot(rootFolderId)：站点根连同子树软删进回收站（delFlag=1，used 不动，R53 内部通道绕过 R52）
→ 缓存清理：DEL site:resolve:{slug} + scanDel site:path:{siteId}:* + scanDel site:data:{siteId}:*（R55）
→ slug 立即可再注册（R49）
```

- `removeSiteRoot` 是 CloudFacade 新增门面方法（管理侧语义，只抛 cloud 段码），与 discardSiteDraft 的区别：discard 用于建站失败的未公开草稿回滚（物理删 + used 回退），removeSiteRoot 用于删站（软删 + used 不动）。
- 还原后语义 R54：回收站还原的目录成为普通文件夹，is_public 保持 1；site 行已不存在，R45 按钮组按 inSite 自动回普通组。不做「还原即恢复站点」的幻想设计（PRD 非目标）。

## 18.4 AI 工具改造（T62，ai 域 tools/ 下原位加改，handler 仍只注入 SiteFacade）

| 工具                                                      | risk                | parameters 变更                 | 行为                                                                                                                                                            |
| --------------------------------------------------------- | ------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_site_files` / `read_site_file` / `write_site_files` | read/read/write     | 加 `slug?: string`              | resolveSite：slug 提供 → 查无 40118+站点列表回喂；省略 → 0 站 40101 引导 / 1 站直通 / 多站回喂 `{ needSitePick:true, sites:[{slug,title}] }`                    |
| `create_site`（新增）                                     | **write**（确认卡） | `{ slug, title, description? }` | summarize 摘要「创建站点 {slug}（{title}）」；执行走 manage 创建链；40117/40102/40103 回喂 `{ ok:false, errorCode, message }` 不抛栈（R57），模型可换 slug 重试 |

description 纪律同步更新：四件套统一写明「多站点用户建议先 list 或询问用户目标站点 slug」；`write_site_files` 的 summarize 摘要携带目标 slug（验收 8）。

## 18.5 前端（T63）

- **站点列表页** `views/site/site/index.vue`：菜单「个人网站」下新增首位子项（site:site:manage）；列：slug / title / status / 文章数 / createdAt / siteUrl（复制 + 新窗口打开）；行操作：管理（= setCurrent + 跳站点设置）、编辑、删除（R50 确认弹窗）；顶部「新建站点」（limit 满 → 按钮禁用 + 提示当前 limit/used）。
- **当前站 store** `stores/site.ts`：`currentSiteId` 持久化 localStorage；`resolveCurrent()` 回退链：缓存命中且仍在 list 中 → 用之；否则 → 唯一站点自动选定；否则 → 第一站；0 站 → 空态引导建站。站点被他端删除后自动回退（验收 6）。
- **既有 5 页零路由变更**：站点设置/栏目/文章/标签/评论保持现路由，页顶加切换器（`v-if="sites.length>1"`，单站用户无感），请求统一从 store 取 siteId 注入（query 或 body，见 API-P4E §10）。
- **用户管理**：追加「站点配额」按钮与弹窗（site:admin:quota，照 cloud 配额按钮先例）；common 角色不授该标识，超管 `*` 自动覆盖。
- seed 增量：菜单「站点列表」+ 权限标识 `site:admin:quota`；原「站点设置」等 5 项不动。

## 18.6 sid 日志脱敏（T64，D56）

- 新增 `common/utils/url-mask.util.ts`：`maskSensitiveQuery(url, keys = ['sid','password'])`——解析 query 并对目标键值替换为 `***`，解析失败原样返回（宁漏勿错，不阻断主流程）。
- 落点排查清单（实现时逐处确认）：① GlobalExceptionFilter 记录 5xx/未捕获异常处的 `req.originalUrl`；② OperationLogInterceptor 若记录 URL/query（开放层虽禁挂操作日志，管理侧登录态接口仍可能带 query）；③ 任何 `logger.log/error` 直接拼接 URL 的位置（全仓 grep `originalUrl\|req.url`）。
- 部署口径（写入 README/部署节）：Nginx 层若开 access_log，使用不含 `$args` 的 log_format，或用 map 对 `$arg_sid` 打码。
- 零新依赖。

## 18.7 错误码增量（并入 §5）

| 码    | 语义                                      |
| ----- | ----------------------------------------- |
| 40117 | 站点数量已达上限（message 带 limit/used） |
| 40118 | 站点不存在或非属主                        |
| 30020 | 站点根目录禁止直接删除（须先删除站点）    |

40101 语义收窄为仅「未开通站点」（PRD §4）。

## 18.8 缓存与 Redis Key

无新增 Key。删站新增清理动作 R55（`site:resolve` / `site:path:{siteId}:*` / `site:data:{siteId}:*` 三条既有 Key 族的删除时机扩展）。site:path/site:data 按 siteId 隔离，多站天然不串。

## 18.9 兼容与迁移

- 存量单站用户：limit 默认 1、唯一站点自动成为当前站、AI 三件套省略 slug 直通——**全链路行为与 P4d 零差异**（验收 1/6/7 即回归保护）。
- `/api/site/mine*` 端点删除（D52 无兼容期）；前端同期切换，PROGRESS 登记移除清单。
- 存量站点根目录名「我的站点」不改（D57 仅约束新站）；slug 与目录名从此解耦，改 slug 不动目录名（现状即如此，延续）。

## 18.10 演进预留（本期不做）

等级/套餐驱动配额（site_quota 表已具备 per-user 承载力，届时接套餐引擎改 quota 即可）；AI 删站/改站工具；站点间内容复制；自定义域名。
