# ARCHITECTURE-P12-增补：数据应用 B 侧（公开与展示）

> 并入目标：ARCHITECTURE 新增 §28。上游 §27（P11）已闭环。
> 编号：D97~~D104 / R100~~R108 / T108~T114。**零新依赖、零新表（+4 列）、零新 AI 工具**。
> 核心模式复制开放层已验证的「@Public + 独立限流 + 40400 防探测」（§14.4 / §16.2 先例，§16 展望注记「用户自建表/接口」一行即指本期）。

## 28.1 域结构增量（apps/api/src/modules/app/）

| 位置               | 增量                                                                           | 说明                                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `pub/`（新子目录） | PubController（`/api/pub/app/**`）、PubDataService、pub 缓存工具               | 免登录公开面，@Public + @SkipTransform，独立限流 60/min/IP                                                                                     |
| `admin/`           | AdminController 扩展 5 端点（publish / pub-config / 两级 expose / 页 publish） | 登录 + 属主（assertOwned 50001）+ 写挂 @OperationLog                                                                                           |
| `page/`            | page.schema.ts 扩展 display 校验（R102）与 rowLink 校验                        | 手写校验风格沿用（零依赖）                                                                                                                     |
| `data/`            | DataService 写成功事务提交后追加「pub data 缓存按 appId DEL」钩子              | 不影响既有写路径语义                                                                                                                           |
| CloudFacade        | 新增 `getAppAttachmentStream(fileId)` 最小只读方法                             | app→cloud 方向沿用既有 CloudFacadeModule；返回 stream + name/ext/size/mime；**调用方（pub/）已完成引用索引与暴露校验**，方法内不再重复业务校验 |

cloud 域零改动；site 域零改动；不新建反向 Facade（AppRefModule 维持 P11 原状）。

## 28.2 数据模型增量（+0 表 +4 列）

迁移 `20260924xxxxxx_app_pub_exposure`（CodeBuddy 按实际时间落号）：

| 表        | 列                      | 默认 | 说明                               |
| --------- | ----------------------- | ---- | ---------------------------------- |
| app_def   | `is_public` tinyint(1)  | 0    | 公开发布开关（D101 属主自助）      |
| app_table | `is_exposed` tinyint(1) | 0    | 表级暴露门禁                       |
| app_field | `is_exposed` tinyint(1) | 1    | 字段级暴露（受表门禁，R100）       |
| app_page  | `is_public` tinyint(1)  | 0    | display 页公开标记（admin 页恒 0） |

- 查询路径：公开面全走 `app_def.uk(pub_code)` 定位，无需新索引；回滚 = 删列，零数据迁移。
- **app_binding 不建**（D99）：绑定语义由三开关 + 页 schema dataSources 表达。

## 28.3 公开数据服务（PubDataService）

- **投影白名单（R101）**：从 `app:schema:{appId}` 缓存（P11 已有）取字段定义 → 有效暴露集合 = 应用 is_public ∧ 表 is_exposed ∧ 字段 is_exposed ∧ 非内部列；输出键 = `app_field.name` + 内置三件套（rowId/createdAt/updatedAt）。
- **查询执行复用（铁律 5）**：入参从 A 侧 DSL JSON 改为 R104 固定参数（GET query 解析 → 同一执行计划）；双路径（r_cN 下推 / 内存 1 万行护栏）、2s 超时（50009）、n:n 回填（from_id/to_id + r_c1/r_c2）、expand ≤1 层语义与 A 侧完全一致；expand 目标表未暴露 → 40001。
- **缓存（R105）**：`app:pub:{appId}:manifest|schema|data:*`；data TTL 60s、manifest/schema 600s；写后失效 = DataService 写事务提交后 SCAN DEL `app:pub:{appId}:data:*`；发布/取消/暴露开关/结构变更即 DEL 对应键（结构变更 piggyback 既有 `app:schema` DEL 事件，一处挂钩两处生效）。
- **防探测（D100）**：pub_code → app_def（is_public=1 ∧ deleted_at null）任一失败 → 40400；表/行/文件校验失败同码；参数校验 40001、限流 42900 为例外（开放层同款例外结构）。

## 28.4 display 页模式增量（schema_version=1 兼容扩展）

```json
{
  "kind": "display",
  "layout": [
    { "type": "filterBar", "bind": "mainList", "fields": ["title:contains"] },
    {
      "type": "table",
      "bind": "mainList",
      "columns": ["title", "tag_ids:expand:tag"],
      "rowLink": { "page": "book_detail", "rowIdParam": "rowId" }
    },
    {
      "type": "detail",
      "bind": "bookDetail",
      "fields": ["title", "cover:attachment", "tag_ids:ref:tag:multiple"]
    }
  ],
  "dataSources": {
    "mainList": {
      "op": "list",
      "table": "book",
      "sort": [{ "f": "createdAt", "dir": "desc" }],
      "size": 20
    },
    "bookDetail": { "op": "get", "table": "book" }
  }
}
```

- **校验（R102）**：kind=display → 禁 form 区块、禁 actions；table 禁 rowActions；detail 必须绑 op=get 数据源；rowLink.page 必须存在于同应用；字段 DSL 语法与 A 侧同一解析器。
- **取值语义**：list 数据源直接渲染；get 数据源的 rowId 从公开路由 query 取（参数名 rowIdParam，默认 `rowId`；缺失 → 空态「参数缺失」，不报错）。
- **保存时不强制暴露**；发布时统一 R103 校验（缺项 50012）。

## 28.5 前端（apps/web）

- `components/app-renderer/` 增 **PublicRenderer**：filterBar / table / detail 三区块只读渲染；字段 DSL 解析、ref 展开回填、枚举 label 等逻辑与 AdminRenderer 同源复用；**附件 → `/api/pub/app/{pubCode}/file/{fileId}`**；全文本插值禁 v-html（沿用）。
- **公开路由**：`/pub/app/:pubCode`（索引 → 重定向首个公开页，无公开页 → 页清单空态）+ `/pub/app/:pubCode/p/:pageCode`（宿主，按参数拉 manifest + schema）；`router/guard.ts` 的 `isPublicRoute` 白名单加入 `/pub/`（照 `/view/*` 先例：**前端白名单与后端 @Public 任一缺失都不可匿名访问**，验收必须双端核对）。
- 管理 UI（PRD §8）：应用中心公开开关与链接复制、结构编辑器暴露标记、页编辑器类型选择与预览。

## 28.6 安全清单

- 公开端点：@Public + 独立限流 60/min/IP + 40400 防探测 + @SkipTransform（流式/裸响应）。
- 全参数绑定（Prisma prepared）；白名单投影；渲染器禁 v-html。
- 附件流三道闸：① `app_attachment_ref` 引用存在（deleted_at 过滤）② 所属表·字段有效暴露 ③ MIME 口径 R26（文本强制 `text/plain; charset=utf-8`；html/htm/svg 强制 attachment；图片/音视频/PDF inline；白名单外 octet-stream + attachment）；`?download=1` 出 attachment + `filename*=UTF-8''` 原名。
- pub_code 只经 path 传递（照 share token 先例，不进 query/Referer）；不写 @OperationLog（公开读），管理侧写操作照挂。

## 28.7 配置增量（src/config/app.config.ts，env 前缀 `APP_*`，均可不配）

`app.pubListMaxSize=50` / `app.pubFilterMaxGroups=3` / `app.pubSortMaxFields=2` /
`app.pubDataCacheTtlSeconds=60` / `app.pubManifestCacheTtlSeconds=600` / `app.pubRateLimitPerMinute=60`

## 28.8 与 P13 的接缝

- `is_public` 只是「自助公开」开关；P13 市场发布 = 独立状态机（审核中/已上架/已下架）+ 快照投影（D103），**不复用 is_public 做审核态**。
- `pub_code` / `source_app_id` P11 已就位；市场复制产生的副本 `is_public=0` 起步，复制不携带公开态。
