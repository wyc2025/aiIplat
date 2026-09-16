# ARCHITECTURE-P7 增补 —— 内容池化 + 文章路径美化

> ✅ **已并入（2026-09-16，T87）**：主文档 `ARCHITECTURE.md` **§22**（本次增补全文）+ §18.3 删站级联改按 P7 口径。**冲突以主文档为准**，本文件保留为历史参考。

> 验收后并入主文档为 §22，§14（开放层）/§18（多站点）/§20（P5 工具）/§21（P6）相关口径同步修订。编号与 PRD-P7-CONTENT-POOL 对齐（D73~D77 / R75~R78 / T83~T87）。
> 本期：**新错误码 1 个**（40120）；**新 HTTP 端点 2 个**；**零新依赖**；工具数不变（28，签名调整）。

## 22.1 DB 变更与迁移（T83）

```
site_article:  + user_id BIGINT NOT NULL
               - site_id、- is_top（置顶迁至 publish 行，每站独立）
               （column_id / status / published_at / view_count 等保留；published_at = 全局首次发布）
               索引调整：去 (site_id,…) 系 → + INDEX(user_id, status)、保留 column_id 索引
site_column:   + user_id BIGINT NOT NULL、- site_id；+ INDEX(user_id)
site_tag:      + user_id BIGINT NOT NULL、- site_id；唯一键 (site_id,name) → (user_id,name)
site_comment:  + site_id BIGINT NOT NULL（按站隔离，D75；article_id 保留）；
               索引调整：保留 (article_id,audit_status) → + INDEX(site_id, article_id, audit_status)
site_site:     + spa_fallback VARCHAR(64) NULL（D77，建站/应用模板时从 template.json#spaFallback 读入）

site_article_publish（新）: id、article_id、site_id、is_top TINYINT(1) DEFAULT 0、published_at DATETIME NULL、created_at
               UNIQUE(article_id, site_id)；INDEX(site_id, is_top, published_at)
site_column_display（新）: id、column_id、site_id、sort INT DEFAULT 0
               UNIQUE(column_id, site_id)；INDEX(site_id, sort)
```

跨域纪律不变：均为 site_ 前缀同域表（铁律 6）；无外键、服务层校验沿用现状；`relationMode="prisma"` 逻辑外键惯例不变。

**迁移脚本**（单事务，R75）：

1. 加列（user_id×3、comment.site_id、site_site.spa_fallback）+ 建两新表；
2. 回填：article/column/tag.user_id ← 其 site 的 user_id；**comment.site_id ← 其 article.site_id（必须在 drop site_id 之前）**；
3. 建关联：publish ← (id, site_id, is_top, published_at) FROM site_article；display ← (id, site_id, sort) FROM site_column；
4. 计数校验：四表总数前后一致、每站文章数 = 原 site_id 分布、无孤儿 user_id/site_id → 通过后 drop site_id/is_top 旧列与旧索引；
5. 任一失败整体回滚；执行前打印 mysqldump 备份提示并需人工确认。

## 22.2 可见性规则（开放层查询口径，D73）

- **文章列表/详情**：`article.status=1 AND EXISTS publish(article_id, site_id=本站)`；排序 `publish.is_top DESC, publish.published_at DESC`；详情未发表到本站 → 40400（不暴露存在性，R77）
- **栏目树**：仅 display 行存在的栏目（按 display.sort）；栏目 articleCount 只计已发表到本站的文章；文章归栏前提 = 其栏目在本站有 display 行，否则仅现于「全部」列表（显隐只影响归类，不影响准入）
- **标签**：不过滤，跟随文章（只出本站已发表文章实际用到的标签）
- **评论**：`WHERE site_id=本站 AND article_id=? AND audit_status=1`；提交评论写 site_id，且文章须已发表到本站（否则 40400）；P6 回复字段（replyContent/replyAt）口径不变——回复跟随评论所在站
- **view_count**：仍记文章行（全局口径，不按站拆分）
- **站点列表 articleCount**（/api/site/manage/list）：口径改「status=1 且存在本站 publish 行」的文章数

## 22.3 SiteFacade 变更（T84/T85）

- article：`listArticles(userId, { siteId?, columnId?, status?, keyword?, page? })`（siteId 降为可选筛选——按「发表到该站」过滤）/ `createArticle(userId, { …, siteIds })` / `updateArticle(userId, id, { …, siteIds? })`（siteIds 提供 = 替换式）/ `setArticleSites(userId, id, sites: [{ siteId, isTop? }])`（替换式，空数组 = 全站下架）/ `publishArticle(userId, id, status)`（全局上下架）
- column：`listColumns(userId)` / `saveColumn(userId, { …, siteIds? })`（缺省全站可见）/ `setColumnSites(userId, id, sites: [{ siteId, sort? }])`（替换式）
- comment：`listComments(userId, { siteId, … })` 从 join 文章反查改为**直列 site_id**（P6 的 `findOwnedComment(userId, id, expectedSiteId?)` 签名兼容，无需改）
- 归属校验统一从「site 属主」改「user_id 直等」；跨用户 → 40119；siteIds 含他人/不存在站点 → 40119；siteIds 长度 ≤100（DTO 护栏）
- **删用户预检扩展**：`SiteFacade.hasSite` 旁增 `hasContent(userId)`（文章/栏目/标签任一行）；UserService.remove 预检链：cloud hasFiles（30011）→ site hasSite（40112）→ site hasContent（**40120 新增**：用户名下有站点内容，先清理或迁移）

## 22.4 删站级联修订（修订 D55，T84）

物理删 = site 行 + site_article_publish + site_column_display + site_comment（按 site_id 直删，不再经文章 join）+ site_quota；**文章/栏目/标签本体保留**（内容池）；站点根软删进回收站、缓存三族清理、slug 释放均不变。
`DELETE /api/site/manage/:id` 响应契约变化：`deletedArticles` → `unpublishedArticles` + `deletedComments`（前端结果提示同步）；`delete_site` 工具确认卡摘要改：「N 篇文章将从此站下架（本体保留在内容池）+ M 条评论将删除」。

## 22.5 建站钩子（T84，R76）

createSite 事务尾部按 `publishArticleIds` 建关联：`"all"`（缺省）= 全部 status=1 文章建 publish 行 + 全部栏目建 display 行；`number[]` = 仅这些文章（栏目仍全可见）；`[]` = 空站。失败随建站事务回滚（discardSiteDraft 既有）。`apply-template` 不变（模板与内容解耦）。

## 22.6 缓存失效

publish/display/comment 写路径 → `scanDel site:data:{siteId}:*`（既有三族口径）；文章本体变更（标题/内容/标签/全局上下架）→ 其**全部发表站点**的缓存族（先查 publish 行集再逐个失效）；`site:path` 负缓存口径不变。

## 22.7 AI 工具语义调整（T85，R77）

| 工具 | 变更 |
|---|---|
| create_site_article | `+ siteIds?: number[]`；**分档解析**（R77 细化）：status=0（默认）→ 不强制选站（siteIds 缺省空）；status=1 → 必须解析发表目标（slug / 单站直通 / 多站 needSitePick）；status=1 时同步为 siteIds 建 publish 行；与 coverPath（P6）并存 |
| update_site_article | `+ siteIds?`（替换式）；摘要列变更字段含站点增删 |
| publish_site_article | 去 slug?：`{ id, status }` 全局上下架；上架且零发表站 → 摘要含警示行 |
| list_site_articles | 去 slug?、`+ siteId?`（可选筛选「发表到某站」）；item + `sites: [{ id, name, isTop }]` |
| read_site_article | 去 slug?（用户级直读，归属校验 user_id） |
| ensure_site_column / ensure_site_tags | 去 slug?（用户级幂等：同名同父/同名命中即复用；ensure 栏目默认全站可见） |
| 评论三工具（P6 §21.2） | slug? 解析不变（评论天然按站，D75） |

手册能力清单（capability.manifest.ts）文案同步为「内容池」口径（如「文章：跨站发表/下架」），KEYWORD_TO_GROUPS 不变；**同源纪律**：能力行/工具/分组三方一致，check:ai 扩展断言（T87）。

## 22.8 文章路径美化（T86，D77/R78）

**开放层回退链**（`OpenStaticController` 既有 nginx 语义扩展，插在「路径解析未命中」分支）：

```
GET 无扩展名路径，文件未命中
  → ① 目录存在？→ 既有目录语义（301 补斜杠 / index.html）不变
  → ② 站点 spa_fallback 非空且入口文件真实存在 → 输出入口（CSP/MIME/ETag 全走既有链）
  → ③ 40400
带扩展名路径未命中 → 40400（严格，不回退）
```

- `spa_fallback` 来源：template.json 新增可选字段 `spaFallback: "index.html"`（相对站点根）；**建站与应用模板时读入 site_site.spa_fallback**（随站点行缓存进 `site:resolve:{slug}`，请求热路径零文件 IO）；改模板/重新应用模板时刷新；存量站点该列为 NULL = 行为完全不变
- **负缓存纪律**：回退命中与目录命中**不写负缓存**（沿用 T35 教训）；带扩展名未命中维持负缓存
- 安全：回退只可能输出声明的入口 HTML，不扩大 MIME 白名单暴露面；路径穿越校验、CSP 沙箱、`res.setTimeout`、限流桶全部沿用；回退响应与文件响应同族缓存键
- **默认模板**：路由改 history 模式 `/article/:id`（app.js 从 path 取 id 替代 query），列表/详情链接生成同步；其 template.json 声明 `spaFallback: "index.html"`；README.txt 三套模板契约同步补 spaFallback 说明
- 测试要点：回退不绕过 MIME 白名单、不产生目录列举、穿越仍 40400、`/article/9`（无扩展名）与 `/missing.js`（有扩展名）分流正确、目录 301 语义不回归

## 22.9 前端改造点（T84/T86）

- **useSiteStore / 切换器解绑**：文章/栏目/标签三页不再注入 siteId（用户级）；切换器仅在站点设置/评论页出现（R76 细化）
- **文章列表**：去 siteId 必带；工具栏站点筛选下拉（可选）；行内已发表站点 chips + 每站置顶开关（调 `:id/sites`）
- **文章表单**：站点勾选组（默认勾当前切换站；可全不选 = 纯草稿躺池）
- **栏目管理**：用户级列表 + 每栏目「站点显隐」弹窗（站点勾选 + sort 输入）
- **建站表单**：「内容初始化」radio——全部已发布文章（默认）/ 手动选择 / 空站
- **默认模板**：history 路由改造（见 §22.8）
- 评论管理页：不变（仍 siteId 必带 + 切换器）

## 22.10 演进预留（本期不做，架构不堵路）

| 项 | 触发条件 | 预留设计 |
|---|---|---|
| SPA 回退用户可配开关 | 用户自建模板普及后 | site_site.spa_fallback 已是独立列，站点设置页加开关即可（manage 更新端点加字段） |
| AI 覆盖确认卡「对比」按钮 | 需要时（P6 遗留 25） | 内容池化后文章读取链已用户级，补「按站点路径读旧内容」接口即可点亮 |
| 每站独立栏目 / 跨站共享评论 | D74/D75 被推翻时 | publish 行加 column_id / comment 去 site_id，关联表已预留扩展空间 |
| 功能分享市场（P8） | 用户立项 | 内容池化后「文章包/栏目结构」可作为分享物；MCP server 化议题随之 |
