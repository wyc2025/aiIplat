# ARCHITECTURE-P5 增补 —— AI 能力扩展（云盘/CMS/生命周期工具 + 预算动态化）

> **已并入 ARCHITECTURE.md §20（2026-09-15，P5 收官）**，本文件保留为历史细节参考；与主文档冲突时以主文档为准。
> 验收后并入主文档为 §20，§12.2 同步修订（预算口径）。编号与 PRD-P5-AI 对齐（D62~~D66 / R63~~R68 / T71~T76）。零新依赖。

## 20.1 门面扩展（T71，全部既有服务委托，工具零业务逻辑）

**SiteFacade 新增 CMS 层**（同域直注 article/column/tag 服务，照 T44 先例；全部带站点属主校验，slug 经 resolveSite 解析 R56）：

```
listArticles(userId, { slug?, columnId?, status?, keyword?, page?, pageSize≤20 })  → 分页摘要（不含 contentMd）
readArticle(userId, { slug?, id })                                                → 全文（含 contentMd）
createArticle(userId, { slug?, columnId?, title, contentMd, summary?, tagNames?, status? })  → 行（R65 全口径）
updateArticle(userId, { slug?, id, ...部分字段 })                                  → 行
publishArticle(userId, { slug?, id, status })                                      → 行（published_at 口径沿用）
ensureColumn(userId, { slug?, name, parentId? })                                   → 幂等：同名同父命中即返回
ensureTags(userId, { slug?, names[] })                                             → 批量幂等 → tagIds
updateSite(userId, { slug, ... })                                                  → 委托 manage.update
deleteSite(userId, { slug })                                                       → 委托 manage.delete（返回 { deletedArticles, recycledRoot } 供摘要）
```

**CloudFacade 新增云盘根基点原语**（与站点原语的差别仅在基点 = 用户根 parentId=0，校验纪律相同）：

```
listUserFiles(userId, { path?, recursive? })   → 单层或有界子树（复用 listSubtreeRaw，根路径归一化）
readUserFile(userId, path)                     → 文本白名单 + ≤64KB（口径照 SiteFacade.readFile）
writeUserFile(userId, path, content)           → 复用 writeFileRaw 全链（mkdir -p 逐段复用 / R6 / 温和覆盖 / used 记账 / 配额 30003）
moveUserFiles(userId, moves[])                 → 复用 file.service 移动链（30019 防环/站点根/回收站保护全继承；targetPublic 警告不适用——AI 工具口径：移入公开目录直接执行并在结果中标注 targetPublic=true，无二次确认交互位）
deleteUserFiles(userId, paths[])               → 复用软删链（回收站；站点根 30020 拦截继承）
```

> **move 的 R39 偏差说明**：管理端 move 有「移入公开目录二次确认」交互，AI 工具无此交互位——确认卡本身就是用户的确认动作，summarize 中对 targetPublic=true 的条目单独标「目标在公开目录」即可，不阻断。

## 20.2 AI 工具注册（T72~T74，ai 域 tools/ 下加文件 + bootstrap 注册）

- 每个工具一个文件，照既有工厂模式；handler 只注入 SiteFacade/CloudFacade
- **description 边界纪律（R63）**：`write_site_files`（站点目录内，影响线上站点）vs `write_cloud_file`（云盘任意路径，不影响站点）——两个 description 互写对方名字做排除式描述；`list_cloud_files` 注明「站点目录也在云盘内，操作站点内容优先用 site 系列」
- summarize 摘要规范：文章创建/更新 = 标题/栏目名/标签/状态/字数（+ status=1 时「发布即公开可见」警示行）；delete_site = R66 三段 + 文章数；move = 逐条 from→to + targetPublic 标注；云盘 write = 路径 + 大小 + 覆盖与否
- 多站 slug 解析沿用 `resolveSiteForTool`（R56 四分支），CMS/生命周期工具全走它

## 20.3 预算动态化（T75，§12.2 修订点）

现状（P2b 写死）：轮次上限 3 硬编码；上下文 = 固定输出预留 25% + 历史从最新往回装，tools schema 占用无实测。本期改为：

```
toolsBudget  = Σ(过滤后工具 schema 字符数)        // 每轮调用动态算，各人因权限不同而不同
systemBudget = system prompt 实测字符数
historyBudget = max_context − 输出预留(25%) − systemBudget − toolsBudget
                ↓ 下限保护：historyBudget < minHistory(如 2000 字符) 时
                保 minHistory 并记告警日志（提示调大 max_context 或精简工具）
```

- 配置：`ai.maxToolRounds`（env `AI_MAX_TOOL_ROUNDS`，默认 3，上限 10 防失控）；读取走 config 组
- usage 兜底估算（R68）：结算 tokens 估算基数 = messages + tools schema + tool 往返消息，同 1 token≈1 字符口径
- **不引入分词库**（铁律 7 + 既有口径延续）；实测日志：每轮对话开头记一条 debug 日志（model max_context / tools 数 / toolsBudget / historyBudget 实算值），便于调优

## 20.4 前端

- `ToolConfirmCard` 摘要渲染：现按通用 key-value + 「目标站点」行；本期文章摘要字段增多——**保持通用渲染**，摘要对象结构化由工具 summarize 保证（中文键名），不加专用模板（防工具每加一个改一次卡片）
- 其余零变化（无新页面/路由）

## 20.5 PLATFORM-GUIDE 与手册预算（风险点）

当前 1959/2000 字，新能力必须进手册（AI 行为契约）但空间不足——**T76 做压缩改写**：合并 RBAC/系统管理罗列（AI 用不到的细节压掉），为「云盘/文章/站点生命周期工具 + 文章默认草稿 + 删除边界」腾空间。字数核查 ≤2000 为验收硬门槛（UTF-8 口径）。

## 20.6 演进预留（本期不做）

评论代审/代管工具（社区治理语义另立）；AI 删文章（若将来要做：先给文章加回收站语义，否则免谈）；工具按场景分包下发（工具数再翻倍后考虑，budget 实测日志是触发依据）。
