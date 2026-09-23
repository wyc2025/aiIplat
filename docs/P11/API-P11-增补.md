# API-P11-增补（应用平台 · 数据应用 A 全链）

> 2026-09-22 ｜ Kimi ｜ 并入 API.md 时作为 **§18**；编号 D92~~D96 / R88~~R99 / T100~T107
> 全端点登录态（@CurrentUser），属主校验统一 50001（应用不存在或无权）；**无 @RequirePermission**（属主自服务口径，同云盘）；写操作挂 @OperationLog。复用：`uploadFile` 链路经 CloudFacade、菜单树机制、动态路由。

## 1. 端点族 `/api/app/**`（全部新增，登录态）

### 1.1 应用管理

| 方法   | 路径                   | 说明                                                                                                                                                                                                                       |
| ------ | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | /api/app               | 创建。body `{ name, description?, mode: 'blank' \| 'draft' }`：blank = 直接 active（占额度）；draft = AI 草稿（不占 active 额度，限 3）。返回 `{ appCode, pubCode, status }`；code 冲突自动 "(1)"（R93）；超配额 **50002** |
| GET    | /api/app               | 我的应用列表（不分页）：`[{ appCode, name, status, tableCount, rowCount, pageCount, updatedAt }]`；`?status=draft` 只看草稿                                                                                                |
| GET    | /api/app/:code         | 应用详情（含统计数字）；无权/不存在 **50001**                                                                                                                                                                              |
| PUT    | /api/app/:code         | 改名称/描述                                                                                                                                                                                                                |
| DELETE | /api/app/:code         | 软删应用（级联软删表/字段/页；app_record 数据由清理任务异步删——即软删后立即 404，数据保留 30 天物理清理，照回收站保留期口径）                                                                                              |
| POST   | /api/app/:code/confirm | draft → active（确认入册，查配额）；草稿过期/不存在 **50008**                                                                                                                                                              |

### 1.2 结构管理（表/字段/关系）

| 方法   | 路径                              | 说明                                                                                                                                                                                                                                      |
| ------ | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | /api/app/:code/schema             | **全量打包**（def+tables+fields+rels+pages，含系统中间表标注 isSystem）——前端首屏一次拉取；Redis 缓存                                                                                                                                     |
| POST   | /api/app/:code/tables             | 建表 `{ name, label, fields: [{ name, label, type, required?, default?, enumOptions?, refTable? }] }`；超 20 表 **50002**；字段类型非法 **50005**（1n 经 `refTable` 自动建模；n:n 由 `POST /relations` 专责，故本端点不收 `refMultiple`） |
| PUT    | /api/app/:code/tables/:tid        | 改 label；改名走迁移式（重写字段引用，v1 禁止改表名）                                                                                                                                                                                     |
| DELETE | /api/app/:code/tables/:tid        | 软删（is_system 表 **50001** 语义「系统表不可删」）；被引用的表（其他表 ref 指向它）需先处理引用，阻断并列出引用方                                                                                                                        |
| POST   | /api/app/:code/tables/:tid/fields | 加字段（字段名应用内唯一）                                                                                                                                                                                                                |
| PUT    | /api/app/:code/fields/:fid        | 改 label/必填/默认值/枚举选项                                                                                                                                                                                                             |
| DELETE | /api/app/:code/fields/:fid        | **软删**（D95：is_deleted=1，数据保留）                                                                                                                                                                                                   |
| POST   | /api/app/:code/fields/:fid/shrink | 类型收窄（text→enum / number→enum）：先跑存量校验，不合规 **50003**（message 带前 10 个违规 rowId）                                                                                                                                       |
| POST   | /api/app/:code/relations          | 建 n:n `{ fromTable, fromField, toTable }` → 自动生成中间表（isSystem）；重复建返回现存                                                                                                                                                   |

### 1.3 功能页

| 方法   | 路径                      | 说明                                                                                                                                             |
| ------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | /api/app/:code/pages      | 列表（功能页：code/name/route/genBy/sort）                                                                                                       |
| POST   | /api/app/:code/pages      | 新建 `{ name, route, schema, genBy }`；schema 过**手写结构校验**（零新依赖，R94），失败 **50004**（message 带路径）；同应用 route 重复 **50007** |
| PUT    | /api/app/:code/pages/:pid | 更新 schema/name/sort                                                                                                                            |
| DELETE | /api/app/:code/pages/:pid | 软删                                                                                                                                             |

### 1.4 沙箱数据（DataService 出口）

| 方法 | 路径                 | 说明                                                                                                                                              |
| ---- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST | /api/app/data/query  | body = 查询 DSL（ARCHITECTURE §4：op/filter/sort/page/expand）；越权表（非本应用）**50001**；非索引过滤 >1 万行或 >2s **50009**                   |
| POST | /api/app/data/action | body `{ pageCode, action, params }`；动作按 schema 定义执行，多步 `$transaction`（任一步失败整体回滚 **50005**）；action 与 schema 不符 **50010** |
| GET  | /api/app/data/record | `?table=&rowId=` 单行（get 语义糖）                                                                                                               |

### 1.5 导入导出与附件

| 方法 | 路径                                  | 说明                                                                                                                                                                                                   |
| ---- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST | /api/app/:code/import                 | multipart（CSV ≤5MB）→ 解析 + 自动映射 → 返回 `{ taskId, mapping, previewRows[5] }` 待确认                                                                                                             |
| POST | /api/app/:code/import/:taskId/confirm | 确认映射 `{ mapping }` → 异步导入；进度 `GET /api/app/import/:taskId`（`{ status, total, done, errors: [{row,reason}] }`）；文件不合规 **50006**                                                       |
| GET  | /api/app/:code/export                 | `?table=` 流式 CSV（≤5 万行，超出截断并在文件尾注释行说明）                                                                                                                                            |
| POST | /api/app/:code/attachment             | multipart 上传附件字段用文件：服务端经 CloudFacade.uploadForApp 强制落 `/app-attachments/{appCode}/` + 建引用行；返回 `{ fileId, path, size }`；单文件 >10MB 复用云盘码 **30004**（CloudFileTooLarge） |

## 2. userinfo 菜单动态段（修改既有）

`GET /api/auth/userinfo` 的 `menus` 树：「应用中心」节点（sys_menu 种子）children 由后端**实时拼装**追加（不落 sys_menu）：

```
应用中心(/app-center)
 └─ {应用名}(/app-center/app/{appCode})
     └─ {功能页名}(/app-center/app/{appCode}/p/{pageCode}) ×N（≤50）
 └─ {下一应用}…
```

前端：静态注册通配路由 `/app-center/app/:appCode/p/:pageCode → FunctionPage.vue`（单组件按参数拉 schema 渲染），**无需按页注册路由**；菜单驱动跳转。应用删除 → 下次拉 userinfo 即消失（R96，零种子依赖）。

## 3. 错误码（50xxx 新段 10 个 + cloud 段 1 个）

| 码    | 文案                         | 场景                                                                        |
| ----- | ---------------------------- | --------------------------------------------------------------------------- |
| 50001 | 应用不存在或无权             | 统一属主校验；含系统表操作                                                  |
| 50002 | 超出配额：{message 带项}     | 应用数/表数/行数/页数/附件/导入大小                                         |
| 50003 | 结构变更未通过数据校验       | 类型收窄遇存量违规（带 rowId 清单）                                         |
| 50004 | 页面模式校验失败             | schema 手写结构校验失败（带路径）                                           |
| 50005 | 数据校验失败                 | 字段规则/动作步骤失败（事务回滚）                                           |
| 50006 | 导入文件不合规               | 非 CSV/超 5MB/空文件/首行无列名                                             |
| 50007 | 功能页路由冲突               | 同应用内 route 重复                                                         |
| 50008 | 草稿已过期或不存在           | confirm 时草稿失效                                                          |
| 50009 | 查询超出护栏                 | >2s 或非索引过滤 >1 万行                                                    |
| 50010 | 动作与页面定义不符           | action 未在 schema 声明                                                     |
| 30021 | 文件被应用数据引用，禁止删除 | **cloud 段**（删除/彻底删除/回收站清理预检回喂；复用方=app_attachment_ref） |

## 4. AI 工具契约（新增 app 组 7 个，工具总数 30 → 37）

> write 级全走确认卡；perms 留空（属主自服务，handler 内 assertOwned，同 common 组先例）；app 组关键词入 KEYWORD_TO_GROUPS（「应用/建表/数据应用/后台/管理页」等）。

| 工具             | parameters                                                                                       | 成功返回要点                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| create_data_app  | `{ name, description? }`                                                                         | `{ ok, appCode, status: 'draft' }`（draft 不占额度）                          |
| add_table        | `{ appCode, table, label, fields: [{ name, label, type, required?, enumOptions?, refTable? }] }` | `{ ok, table, created: [字段名] }`（refTable 自动建 1n；n:n 走 set_relation） |
| add_fields       | `{ appCode, table, fields: [同上] }`                                                             | `{ ok, created: [] }`                                                         |
| set_relation     | `{ appCode, fromTable, fromField, toTable }`                                                     | `{ ok, relation: 'nm', throughTable }`（幂等）                                |
| gen_admin_page   | `{ appCode, name, purpose }`                                                                     | `{ ok, pageCode, route, blocks: n }`（purpose 描述功能，AI 选表与区块）       |
| adjust_page      | `{ appCode, pageCode, instruction }`                                                             | `{ ok, changed: 摘要 }`                                                       |
| confirm_data_app | `{ appCode }`                                                                                    | `{ ok, status: 'active', menuHint: '功能页已挂到应用中心菜单' }`              |

**冒烟新增 L 用例**（R98）：提示词「帮我建一个读书笔记数据应用：书（书名/作者/评分）和笔记（内容/关联书），再生成管理页面」→ 判据：`ai_tool_call` 出现 create_data_app/add_table/gen_admin_page 调用且 `app_def`(status=draft→active) 与 `app_table` 落库。 J/K 用例候选排除：云盘候选查询排除 `/app-attachments/`（照 §26.9-11 先例）。

## 5. 配置登记（API §12.1 ai 表旁新增 app 配置组，详见 ARCHITECTURE §10）

`app.maxAppsPerUser=10` / `app.maxDraftsPerUser=3` / `app.maxTablesPerApp=20` / `app.maxRowsPerTable=50000` / `app.maxPagesPerApp=50` / `app.maxAttachmentSize=10MB` / `app.maxImportSize=5MB` / `app.hotIndexFieldsPerTable=5` / `app.queryTimeoutMs=2000` / `app.draftTtlDays=7`（env 前缀 `APP_*`）

## 6. 编号登记

| 系列      | 本期使用                                                        | 说明                        |
| --------- | --------------------------------------------------------------- | --------------------------- |
| 决策      | D92~D96                                                         | 见 PRD-P11 §2               |
| 规则      | R88~R99                                                         | 见 PRD-P11 §3               |
| 任务      | T100~T107                                                       | 见 PROGRESS「P11 任务拆解」 |
| HTTP 端点 | +18（§1.1~1.5）                                                 | userinfo 响应扩展（§2）     |
| 错误码    | 50xxx 段 10 + **30021**（cloud 段，30014~30020 已占，续 30021） | §3                          |
| AI 工具   | 30 → 37（app 组 7）                                             | §4                          |
| DB        | 7 张 app_* 表                                                   | ARCHITECTURE-P11 §2         |
| 依赖      | +0                                                              | CSV 自研解析                |
