# API-P5 增补 —— AI 能力扩展（工具契约 + 配置）

> **已并入 API.md §12（2026-09-15，P5 收官）**，本文件保留为历史细节参考；与主文档冲突时以主文档为准。
> 验收后并入 API.md 为 §12。与 PRD-P5-AI（D62~~D66 / R63~~R68）对齐。
> **本期零新 HTTP 端点、零新错误码**：AI 工具经既有 SSE 通道（/api/ai/chat + /api/ai/tool/confirm）交互，回喂复用各域既有码（30001/30003/30006/30019/30020/40101/40102/40103/40105/40118/40119/20014~20016 等）。

## 12.1 配置增量

| 配置               | env                  | 默认         | 说明                                                   |
| ------------------ | -------------------- | ------------ | ------------------------------------------------------ |
| `ai.maxToolRounds` | `AI_MAX_TOOL_ROUNDS` | 3（上限 10） | 单轮用户消息的工具调用轮次上限（D65，替代 P2b 硬编码） |

## 12.2 工具参数契约（供 ToolRegistry 注册，非 HTTP 端点）

通用约定：write 类全走确认卡（summarize 结构化摘要，中文键名）；失败回喂 `{ ok:false, errorCode, message }` 不抛栈；带 `slug?` 的站点工具经 `resolveSiteForTool` 四分支解析（0 站 40101 引导 / 1 站直通 / 多站 needSitePick / 查无 40119+站点列表，R56）。

### 云盘（perms 复用对应管理端点标识）

| 工具               | risk  | parameters                  | 成功返回要点                                                                                            |
| ------------------ | ----- | --------------------------- | ------------------------------------------------------------------------------------------------------- |
| list_cloud_files   | read  | `{ path?, recursive? }`     | `{ path, items: [{ name, isDir, size, ext, updatedAt, inSite? }], truncated?, quota: { used, limit } }` |
| read_cloud_file    | read  | `{ path }`                  | `{ path, size, content }`（文本白名单 ≤64KB）                                                           |
| write_cloud_file   | write | `{ path, content }`         | `{ path, action: created\|overwritten, size }`；摘要带覆盖标注                                          |
| move_cloud_files   | write | `{ moves: [{ from, to }] }` | 逐条 `{ from, to, ok, error?, targetPublic? }`（部分成功语义，照 write_site_files 先例）                |
| delete_cloud_files | write | `{ paths: [] }`             | 逐条 `{ path, ok, error? }`；摘要明示「进回收站，可还原」                                               |

### 站点 CMS

| 工具                 | risk  | parameters                                                             | 要点                                                                                               |
| -------------------- | ----- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| list_site_articles   | read  | `{ slug?, columnId?, status?, keyword?, page? }`                       | 分页摘要（无 contentMd），pageSize ≤20                                                             |
| read_site_article    | read  | `{ slug?, id }`                                                        | 全文含 contentMd                                                                                   |
| create_site_article  | write | `{ slug?, columnId?, title, contentMd, summary?, tagNames?, status? }` | status 缺省 0 草稿（D63）；status=1 时摘要带「发布即公开可见」警示行；返回 `{ id, status, title }` |
| update_site_article  | write | `{ slug?, id, title?, contentMd?, columnId?, tagNames?, summary? }`    | 部分更新；摘要列变更字段                                                                           |
| publish_site_article | write | `{ slug?, id, status }`                                                | 上架摘要带公开警示；published_at 口径沿用（首次发布写）                                            |
| ensure_site_column   | write | `{ slug?, name, parentId? }`                                           | 幂等：同名同父命中即返回现有 `{ id, created: false }`                                              |
| ensure_site_tags     | write | `{ slug?, names: [] }`                                                 | 批量幂等 → `{ tags: [{ id, name, created }] }`                                                     |

### 站点生命周期

| 工具        | risk  | parameters                                                         | 要点                                                                           |
| ----------- | ----- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| update_site | write | `{ slug, title?, description?, newSlug?, status?, commentAudit? }` | newSlug 校验同建站（40102/40103 回喂）                                         |
| delete_site | write | `{ slug }`                                                         | 摘要 = R66 三段影响 + 文章数统计；执行返回 `{ deletedArticles, recycledRoot }` |

## 12.3 引擎行为变化（无契约变更）

- 上下文预算：tools schema 与 system prompt 实测扣减，历史预算动态计算（R67）；每轮 debug 日志记录实算值
- usage 兜底估算：基数扩展覆盖工具定义与 tool 往返消息（R68）
- 轮次上限：`ai.maxToolRounds` 配置生效，超限截断并提示（口径不变，仅阈值可配）

## 12.4 手册（PLATFORM-GUIDE）

压缩改写 ≤2000 字（UTF-8），必须覆盖：AI 可管云盘（读/写文本/移动/删到回收站）、可发文章（默认草稿、明示才发布、不可删文章）、可改/删站点（删站确认卡列影响）。README.txt（站点模板契约）不动。
