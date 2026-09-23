# ARCHITECTURE-P11-增补（应用平台 · 数据应用 A 全链）

> 2026-09-22 ｜ Kimi ｜ 并入 ARCHITECTURE.md 时作为 **§27**；编号 D92~~D96 / R88~~R99 / T100~~T107
> 原则对齐：铁律 1~~9（技术栈锁定、域目录、Facade 跨域、零超范围重构、资产复用、域前缀、零新依赖、契约一致、拿不准就问）

## 1. 域结构（apps/api/src/modules/app/）

按子域组织，聚合于 `app.module.ts`：

| 子目录    | 职责                                                  | 关键类                                               |
| --------- | ----------------------------------------------------- | ---------------------------------------------------- |
| `admin/`  | 应用 CRUD、草稿生命周期、配额                         | AdminService、AdminController（`/app`）              |
| `schema/` | 表/字段/关系管理、结构变更规则、中间表生成            | SchemaService、SchemaController（`/app/schema`）     |
| `data/`   | **沙箱数据服务**（唯一数据入口）                      | DataService、DataController（`/app/data`）           |
| `page/`   | 功能页 schema 存取 + 校验                             | PageService、PageController（`/app/page`）           |
| `import/` | CSV 导入导出（异步任务 + 进度）                       | ImportService（`@nestjs/schedule` 照回收站清理先例） |
| `facade/` | AppFacade 实现（gateway 侧接口在此域实现？否——见 §3） | —                                                    |

> 跨域调用方向：ai 域 → AppFacade（gateway/，工具执行）；app 域 → CloudFacade（附件上传）；cloud 域 → AppFacade（删除预检）。**app 域自身不实现 Facade**——Facade 全部在 `gateway/`，app 域导出 Service 供 gateway 组装（照 CloudFacade/SiteFacade 既有先例）。

## 2. 数据模型（7 张 app_* 表，relationMode="prisma" 逻辑外键）

```sql
-- 应用主档（draft/active/deleted；pub_code 先建先用，P12 启用）
app_def: id, code(用户内唯一), pub_code(全局唯一,创建即生成,R93 先建先用,P12 才启用), name,
         description, status('draft'|'active'), owner_id→sys_user, source_app_id(溯源,P13 用,nullable),
         version(默认1,机制预留), deleted_at, created_at, updated_at
         索引: (owner_id,status,deleted_at), unique(owner_id,code), unique(pub_code)

-- 逻辑表（n:n 中间表也是一行，is_system=1 用户不可见）
app_table: id, app_id, name, label, is_system(0|1), deleted_at
           索引: (app_id,deleted_at), unique(app_id,name)

-- 字段定义 = 沙箱校验规则本体
app_field: id, table_id, name, label, type('text'|'number'|'datetime'|'bool'|'enum'|'attachment'|'ref'),
           required(0|1), default_val(json,nullable), enum_options(json,nullable),
           ref_table_id→app_table(nullable, 1n 的 n 侧), ref_multiple(0|1, n:n 经 app_rel),
           is_deleted(0|1, D95 软删), sort, deleted_at
           索引: (table_id,is_deleted), unique(table_id,name)

-- 关系（仅 n:n 需要显式登记；1n 由 app_field.ref_table_id 承载）
app_rel: id, app_id, from_table_id, from_field_id, to_table_id, type('nm'),
         through_table_id→app_table(自动生成), deleted_at

-- 数据行（D87 唯一落点）
app_record: id, app_id, table_id, row_id(char(36) uuid, 对外可见主键), data(json),
            r_c1..r_c5(热字段冗余生成列 varchar(191), 每表 ≤5 个索引字段, 建表/改索引时维护),
            created_by, deleted_at, created_at, updated_at
            索引: (table_id,deleted_at), (table_id,r_c1)…按配置, (app_id,updated_at)
            容量注记: v1 单表; 监控行数, ≥500 万行评估按 app_id 分表(§12 演进)

-- 功能页（B 的展示页未来同构存 kind='display'）
app_page: id, app_id, kind('admin'), name, route(应用内相对路径), schema(json), schema_version(默认1),
          gen_by('ai'|'manual'), sort, deleted_at
          索引: (app_id,kind,deleted_at)

-- 附件引用索引（D96 预检的查询底座；写路径同步维护）
app_attachment_ref: id, app_id, table_id, record_id→app_record, field_name, file_id→cloud_file,
                    deleted_at
                    索引: (file_id,deleted_at)  ← 预检查询点, (app_id,table_id,record_id)
```

seed（幂等，deploy.sh 种子步骤同步）：菜单「应用中心」（一级目录）+「我的应用」页；common 角色授予；**零按钮权限标识**（数据操作属主校验兜底，同云盘自服务口径）。

## 3. Facade 拓扑（铁律 3/6，防环照 P4d 先例）

```
ai 域(T105 工具 handler) ──▶ gateway/AppFacade.createAppDraft/addTable/…（受控方法集）
cloud 域(删除/还原/彻底删除前预检) ──▶ gateway/AppFacade.getAttachmentRefs(userId, fileId[])
app 域(附件上传) ──▶ gateway/CloudFacade.uploadForApp(userId, appCode, file)
```

- AppFacade 只依赖 app 域导出的 Service 接口，不 import 业务模块；cloud↔app 两向各走各的 Facade 门面，无 import 环；
- `getAttachmentRefs` 只查 app_attachment_ref（带 deleted_at 过滤），不读 app_record.data；
- 还原/彻底删除也要预检（回收站还原文件时引用仍存在 → 允许；彻底删除物理清文件 → 阻断 30021）。

## 4. 沙箱数据服务（DataService，唯一数据入口）

**写路径**：入参 `{ table, row?, values }` → 解析逻辑表（app_table + app_field 缓存）→ 按字段定义逐字段校验（类型/必填/枚举/ref 存在性/attachment 权属）→ 组装 data JSON + 维护 r_cN 生成列 → prisma 事务落库；attachment 字段同步维护 app_attachment_ref（旧引用差量删除）。**任何控制器/工具不得绕开 DataService 直接写 app_record**（code review 红线）。

**功能页动作执行（R90 事务）**：`POST /app/data/action` 收 `{ pageCode, action, params }` → PageService 解析 schema 中动作定义（单表写或多步 transaction）→ DataService 以 `$transaction` 包裹全部步骤，任一步失败整体回滚。

**查询 DSL（R95 白名单）**：

```json
{
  "op": "list",
  "table": "article",
  "filter": [
    { "f": "status", "op": "eq", "v": "published" },
    { "f": "title", "op": "contains", "v": "沙箱" }
  ],
  "sort": [{ "f": "published_at", "dir": "desc" }],
  "page": 1,
  "size": 20,
  "expand": [{ "f": "column_id", "fields": ["name"] }]
}
```

- op 枚举：`list | get | count`；filter op：`eq/ne/gt/gte/lt/lte/contains/in`；size ≤100；expand ≤1 层（join 在应用层解析：先查主表，再按 ref 批量回表，禁 SQL JOIN 到用户逻辑表）；
- 查询在 resolved 逻辑表内执行（真实 SQL 只触 app_record 单表 + r_cN 索引）；
- 单查询 >2s（MySQL 慢查询阈值配置）→ 拒绝 50005 类提示（R99），杜绝全表扫描型应用拖垮库。

**CSV 导入（R92）**：上传(≤5MB) → 解析首行 → 列名→字段自动映射（同名/相似度）→ 人工确认映射 → 前 5 行预览 → 异步导入（@nestjs/schedule 任务，每批 500 行）→ 进度轮询 → 完成给错误行报告（行号+原因，成功行已落库不回滚）；幂等键 = 文件名+行号重复导入提示。

**CSV 导出**：流式（cursor 分页），≤5 万行，列序 = 字段 sort；附件字段导出为文件名占位。

**配额（每次写前检查，§4 PRD 表）**：超配额 → 50002（message 指明哪项）。草稿不占 active 额度（draft ≤3）。

## 5. 功能页模式 JSON（app_page.schema，schema_version=1）

```json
{
  "kind": "admin",
  "layout": [
    {
      "type": "filterBar",
      "bind": "mainList",
      "fields": ["keyword:contains:title", "status:eq:status"]
    },
    {
      "type": "table",
      "bind": "mainList",
      "columns": ["title", "column_id:expand:name", "status", "published_at"],
      "rowActions": ["edit", "delete"]
    },
    {
      "type": "form",
      "bind": "createArticle",
      "title": "新建文章",
      "fields": [
        "title",
        "content:textarea",
        "cover:attachment",
        "status:enum",
        "column_id:ref:column",
        "tag_ids:ref:tag:multiple"
      ]
    }
  ],
  "dataSources": {
    "mainList": {
      "op": "list",
      "table": "article",
      "filter": [{ "f": "status", "op": "ne", "v": "__DELETED__" }],
      "sort": [{ "f": "updated_at", "dir": "desc" }],
      "size": 20
    },
    "columns": { "op": "list", "table": "column", "fields": ["id", "name"], "size": 100 },
    "tags": { "op": "list", "table": "tag", "fields": ["id", "name"], "size": 100 }
  },
  "actions": {
    "createArticle": { "tx": false, "steps": [{ "op": "create", "table": "article" }] },
    "auditComment": {
      "tx": true,
      "steps": [
        { "op": "update", "table": "comment" },
        { "op": "update", "table": "article" }
      ]
    }
  }
}
```

要点：layout 区块（filterBar/table/form/detail 四型）绑定 dataSource 或 action；**ref 多选（tag_ids）= n:n 中间表写，DataService 按 app_rel 自动展开两步写**（select 值数组 → 删旧中间行 → 插新中间行，随动作事务）；`rowActions` 内建 edit/delete（edit 打开 form 回填、delete 软删二次确认）。

## 6. 前端（apps/web）

- `views/app/`：`center/`（我的应用卡片流，照线框①）、`create/`（空白表单 + AI 向导两步，照线框②）、`schema/`（表结构编辑器，照线框③）、`page-editor/`（功能页可视化编辑表单，R97）；
- `components/app-renderer/`：**AdminRenderer**——FunctionPage 引擎，按 §5 schema 渲染四型区块；数据源统一经 `api/app/data/query`，动作经 `api/app/data/action`；常量与后端同源（照 `views/ai/utils/attachment.ts` 先例）；
- 动态菜单（R96）：`userinfo.menus` 响应含动态段（见 API-P11 §3），路由注册走既有动态路由机制（W1 教训后菜单与路由已解耦预检）；
- 复用资产：FilePicker（附件字段）、DiffView?（不需要）、上传链路 `uploadFile`、el-table/el-form（Element Plus 既有）。

## 7. AI 工具组（app 组 7 个，30 → 37）

`create_data_app` / `add_table` / `add_fields` / `set_relation` / `gen_admin_page` / `adjust_page` / `confirm_data_app`——全 write 级（走确认卡），入参必须能从既有工具输出推出（P9 T92 教训：create_data_app 返回 appCode 供后续工具引用）；handler 全经 AppFacade。KEYWORD_TO_GROUPS 加 app 组关键词（建应用/建表/数据应用/后台…）。手册按 R98 预算腾挪。

**AI 创建 agent 化（需求分析/任务拆解）不做**（P14 挂账）：本期 gen 工具由模型在单轮内顺序调用，prompt 侧在手册通用版加「建应用时先追问再生成」一句引导（计入 R98 的 20 字预算）。

## 8. 性能与缓存

- Redis：`app:schema:{appId}`（def+tables+fields+rels+pages 全量打包，结构/页面变更即 DEL）；`app:import:{taskId}` 进度；配额计数走 cloud 既有 used 记账（附件）+ app 行数计数（每表 count 缓存 60s）；
- 公开面本期无（P12）；管理页首屏 = schema 接口一次拉全（≤50 页全量打包通常 <100KB）；
- app_record 查询强制走 r_cN 索引字段；过滤字段非索引 → 内存过滤前先按 (table_id,deleted_at) 索引拉取 + 硬上限 1 万行（超出提示加索引字段或缩小范围，R99 配套）。

## 9. 安全

- 全量参数绑定（Prisma prepared）；zod 双道（R94）；渲染器禁 v-html 用户串（AdminRenderer 全文本插值）；
- 所有端点属主校验（assertOwned，照 ai 域先例）；草稿/应用/表/页全部软删可回溯；
- 附件：上传走 CloudFacade.uploadForApp（强制目录前缀 `/app-attachments/{appCode}/`，服务端拼路径防穿越）；下载/预览沿用 cloud 既有鉴权；
- 操作日志：应用创建/删除、结构变更、导入导出挂 @OperationLog。

## 10. 配置项（apps/api/src/config/app.config.ts，env 可覆盖）

| 配置                         | env                       | 默认  | 说明                         |
| ---------------------------- | ------------------------- | ----- | ---------------------------- |
| `app.maxAppsPerUser`         | `APP_MAX_APPS_PER_USER`   | 10    | active 应用上限              |
| `app.maxDraftsPerUser`       | `APP_MAX_DRAFTS_PER_USER` | 3     | 草稿上限                     |
| `app.maxTablesPerApp`        | `APP_MAX_TABLES_PER_APP`  | 20    | 逻辑表上限（is_system 不计） |
| `app.maxRowsPerTable`        | `APP_MAX_ROWS_PER_TABLE`  | 50000 | 行上限                       |
| `app.maxPagesPerApp`         | `APP_MAX_PAGES_PER_APP`   | 50    | 功能页上限                   |
| `app.maxAttachmentSize`      | `APP_MAX_ATTACHMENT_SIZE` | 10MB  | 附件单文件                   |
| `app.maxImportSize`          | `APP_MAX_IMPORT_SIZE`     | 5MB   | CSV 导入单文件               |
| `app.hotIndexFieldsPerTable` | `APP_HOT_INDEX_FIELDS`    | 5     | r_cN 生成列数                |
| `app.queryTimeoutMs`         | `APP_QUERY_TIMEOUT_MS`    | 2000  | 查询护栏                     |
| `app.draftTtlDays`           | `APP_DRAFT_TTL_DAYS`      | 7     | 草稿清理                     |

## 11. 演进注记（登记不实施）

| 项                | 触发条件       | 预留                                                                  |
| ----------------- | -------------- | --------------------------------------------------------------------- |
| 展示应用 B / 市场 | P12/P13        | app_page.kind 已分 admin/display；app_def.source_app_id/pub_code 已建 |
| app_record 分表   | 单表 ≥500 万行 | 按 app_id 区间分表，DataService 加分发表路由                          |
| 富文本字段        | 有真实需求     | 引 DOMPurify 需特批；先 Markdown 文本                                 |
| AI 创建 agent 化  | P14            | 工具签名不变，外部套工作流                                            |
| 行级操作审计      | 合规要求       | data json 外追加 diff 列即可                                          |
