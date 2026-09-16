# ARCHITECTURE-P6 增补 —— 按需注入 + 评论代审代回 + 封面通道 + 体验三件套

> **【已并入 ARCHITECTURE.md §21（T82 收口，2026-09-15）】本文件保留为历史细节参考；与主文档冲突时以主文档为准。**
> 并入时同步修订：§1.1 依赖白名单（`@codemirror/merge`）、§5 site_comment 两列、§8 `DEBUG_AI` 配置、§9 资产表 10 行、§12.2/§12.3/§12.4（路由与手册两段式）。
> 实现偏差 8 条见 §21.7（模板预览图落点、错误码实际口径、分组表口径、diff 入口无服务端版本依据等）。
>
> 验收后并入主文档为 §21，§12.2 同步修订（路由与手册口径）。编号与 PRD-P6-AI-UX 对齐（D67~~D72 / R69~~R74 / T77~T82）。新依赖 1 个：`@codemirror/merge`（D71 铁律 7 特批，登记依赖白名单，照 CodeMirror 先例按需异步加载）。

## 21.1 按需注入（T77）

**手册两段式（D67/R69）**——`SystemPromptService.build(user)` 重构：

```
system prompt = 助手设定（静态）
              + 通用版手册（静态，~800 字：平台简介/角色与权限语义/通用规则/工具原则）
              + 能力清单（动态，按用户权限逐项注入，一行一项：能力名 + 一句话 + 关键约束）
              + 用户上下文（昵称/角色/日期，现状不变）
```

- 能力清单数据源：代码常量表（能力项 → 所需权限标识 → 一行文案），与工具注册表**同源维护**（新增 write 工具必须登记能力行，验收含一致性检查）；注入条件 = PermissionService 判定用户持有该权限
- 字数核查脚本改分段阈值：通用版 ≤1000 / 能力清单 ≤1200 / 总长 ≤2000（UTF-8 `[...text].length` 口径不变）

**工具确定性路由（D68/R70）**——下发链改为两道串联：

```
权限过滤（现状）→ 组路由（新增）→ 携带 tools 调上游
```

- `tool.groups.ts` 常量：`TOOL_GROUPS = { common: [3 个登录级], system: [...], siteFile: [...], siteCms: [10 个含评论], siteLifecycle: [3], cloud: [5] }` + `KEYWORD_TO_GROUPS`（如 文章|栏目|标签|评论|博客 → siteCms；云盘|文件|整理|移动 → cloud；站点|建站|描述|删站 → siteLifecycle/siteFile）
- 命中 = 用户消息（不含历史）关键字匹配 → 命中组 ∪ common 下发；**无命中 = 全量**；common 恒下发
- 新工具注册必须归组：bootstrap 注册时校验每个工具在分组表中有归属，孤儿工具启动 warn（单测硬失败）
- 日志：每轮 debug 记 `{ 命中组, 下发数/总数, toolsBudget, historyBudget }`（接 P5 实算口径）
- **演进阈值（写入 §21.6）**：toolsBudget > max_context × 20% → 评估形态 B（meta-tool 搜索路由）

## 21.2 评论作者回复 + AI 工具（T78）

**DB**：`site_comment` 加 `reply_content VARCHAR(500) NULL` + `reply_at DATETIME NULL`（一级回复，每条至多一条，改回复 = 更新这两列）。

**后端**：

- 管理端：`PUT /api/site/comment/:id/reply`（site:comment:audit，body `{ content }` ≤500，@OperationLog；清空字符串 = 删除回复）；评论列表 item 加 reply 字段
- 开放层：`/api/open/:slug/api/comments` 与文章详情内嵌评论的 item 加 `{ replyContent, replyAt }`（仅 audit_status=1 的评论携带，R71）；写回复后失效既有 comment 缓存
- **SiteFacade 扩展**（T78 同域直注 comment 模块）：`listComments(userId, { slug?, auditStatus?, articleId?, page? })` / `auditComments(userId, ids[], auditStatus)`（批量 ≤20）/ `replyComment(userId, id, content)`

**AI 工具 3 个**（归 siteCms 组，R74）：

| 工具                  | risk  | parameters                                   | 摘要/返回                                    |
| --------------------- | ----- | -------------------------------------------- | -------------------------------------------- |
| `list_site_comments`  | read  | `{ slug?, auditStatus?, articleId?, page? }` | 分页（昵称/内容截断/文章标题/状态/时间）     |
| `audit_site_comments` | write | `{ slug?, ids: [], auditStatus }`            | 摘要 = 条数 + 通过/驳回；逐条结果            |
| `reply_site_comment`  | write | `{ slug?, id, content }`                     | 摘要 = 原评论昵称+内容截断 + 回复内容（R71） |

**前端**：管理端评论页行操作加「回复」（弹窗显原评论 + 输入框，已有回复回显可改）；默认模板（site-templates/default）文章详情渲染「作者回复」块（有 replyContent 才渲染）——**存量站点模板不受影响**（模板是用户代码，新字段不渲染即不显示）。

## 21.3 文章封面通道（T79）

- 工具参数：`create_site_article` / `update_site_article` 加 `coverPath?: string`
- SiteFacade 校验链（R72）：media/ 前缀 → 站点 media 目录逐段下行解析到 cloud_file 行（属主+未删除）→ 扩展名图片白名单 → 失败回喂 40105 口径（附 media/ 可用图清单前 10 条，引导模型换图）
- 模型发现图：经既有 `list_cloud_files { path: "media/" }`（零新增）

## 21.4 体验三件套（T80）

1. **模板预览图**：`assets/site-templates/*/preview.png`（3 张静态截图资产，人工/工具生成一次入库）+ `template.json.preview` 填文件名 + `GET /api/site/templates` 响应加 `previewUrl`（静态资源直出）+ 模板卡片 `<img>`（加载失败降级占位）
2. **diff 视图**：`@codemirror/merge` 异步加载；`FileEditorDialog` 加「对比」入口（有外部变更时提示可唤出）；统一变更视图只读（R73 不做合并编辑）
3. **格式按钮**：编辑器工具栏加 粗体/斜体/链接 三按钮（选区包裹 `**`/`*`/`[]()`，零依赖）

## 21.5 搭车（T81）

- 回收站：`findTopLevelDeleted` / `hasDeletedAncestor` 归集处排除 `parent_id = -1`（AVATAR_PARENT_ID）行；30 天自动清理逻辑不受影响（头像旧行仍被清理，只是不在回收站列表显示）
- ElMessageBox：全仓 grep `ElMessageBox.confirm` 逐处补 try/catch（或抽 `confirmDialog` 公共封装，一处处理取消分支；**优先抽封装**——以后新增弹窗不会重犯）

## 21.6 演进预留

形态 B（meta-tool 搜索路由）：触发 = toolsBudget > max_context × 20%（实算日志持续观测）；评论楼中楼（多级 parent_id）；AI 图片生成/上传通道；MCP server 化（P7 功能分享市场一并讨论，用户已拍板留 P7）。
