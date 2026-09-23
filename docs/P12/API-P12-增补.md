# API-P12-增补：数据应用 B 侧（公开与展示）

> 并入目标：API 新增 §19。上游 §18（P11，+18 端点）已闭环。
> 编号：D97~~D104 / R100~~R108 / T108~T114。**HTTP 端点 +10（管理侧 5 + 公开侧 5）；错误码 +1（50012）；零新 AI 工具（37 不变）；零新依赖**。

## 19. P12：数据应用 B 侧（公开与展示）（增补并入）

> 管理侧：登录态 + 属主校验（50001），写挂 `@OperationLog`（同 §18 口径）。
> 公开侧：免登录 `@Public` + `@SkipTransform`，独立限流 60 次/分/IP（42900），**资源类失败统一 40400 防探测**（参数校验 40001 为例外）——开放层 §6/§8 同款结构。

### 19.1 管理侧端点（+5）

| 方法 | 路径                                | 说明                                                                                                                                                                                                |
| ---- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PUT  | `/api/app/:code/publish`            | body `{ isPublic: 0\|1 }`（照 `PUT /api/site/article/:id/status` 先例）。置 1 走 R103 校验，未过 **50012**（message 带缺项清单）；成功返 `{ pubCode, pubUrl }`；置 0 即时失效公开端（缓存同步 DEL） |
| GET  | `/api/app/:code/pub-config`         | 公开总览 `{ isPublic, pubCode, pubUrl, exposedTables[], publicPages[], missing[] }`（missing = 当前发布缺项，供前端引导）                                                                           |
| PUT  | `/api/app/:code/tables/:tid/expose` | body `{ isExposed }`；表级暴露开关（R100）                                                                                                                                                          |
| PUT  | `/api/app/:code/fields/:fid/expose` | body `{ isExposed }`；字段级暴露开关                                                                                                                                                                |
| PUT  | `/api/app/:code/pages/:pid/publish` | body `{ isPublic }`；**仅 kind=display**（admin 页 → 50004）；置 1 不单独校验暴露（发布时统一 R103）                                                                                                |

### 19.2 公开端点（+5，前缀 `/api/pub/app`）

| 方法 | 路径                                             | 说明                                                                                                                                                                                                                                                                                                                        |
| ---- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET  | `/api/pub/app/{pubCode}`                         | manifest `{ name, description, pages: [{ code, name, route }] }`（仅公开 display 页，按 sort）；应用不存在/未公开/已删 → 40400                                                                                                                                                                                              |
| GET  | `/api/pub/app/{pubCode}/pages/{pageCode}/schema` | display 页 schema（发布时已 R103 校验，原样输出）；页不存在/未公开 → 40400                                                                                                                                                                                                                                                  |
| GET  | `/api/pub/app/{pubCode}/data/{table}`            | 公开列表。参数：`page` `size`（≤50 默认 20）`sort=字段:asc\|desc`（≤2 组，重复参数）`filter=字段:eq\|contains:值`（≤3 组，值 URL 编码）`expand=refField[:f1,f2]`（≤1 层）。返回 `{ list, total, pageNo, pageSize }`；item 仅暴露字段 + rowId/createdAt/updatedAt；expand 结果放 `expanded[field]`；n:n 多值回填为 `rowId[]` |
| GET  | `/api/pub/app/{pubCode}/data/{table}/{rowId}`    | 单行（暴露字段投影）；行不存在 → 40400                                                                                                                                                                                                                                                                                      |
| GET  | `/api/pub/app/{pubCode}/file/{fileId}`           | 附件流。inline，MIME 口径 R26（文本强制 plain、html/svg attachment、图片/音视频/PDF inline）；`?download=1` → attachment + `filename*=UTF-8''` 原名；无引用 / 未暴露 → 40400                                                                                                                                                |

**参数口径（R104）**：可排序字段 = 暴露字段 + rowId/createdAt/updatedAt；filter 的 contains 限 text/enum；expand 限 ref 字段且目标表已暴露，请求字段子集仍按白名单裁剪；任一越界 → 40001。
**路由安全**：`/api/pub` 顶层无参数段（cloud 的 f/d 为静态段，app 亦为静态段），零冲突（P4e 遗留 14 教训）。
**缓存（R105）**：manifest/schema TTL 600s、data TTL 60s；DataService 写后按 appId DEL data 键；发布/取消/暴露/结构变更即 DEL 对应键。
**护栏复用**：公开查询与 A 侧同护栏——>2s 或内存路径 >1 万行 → 50009。

### 19.3 错误码

| 码                                            | 文案                           | 场景                                          |
| --------------------------------------------- | ------------------------------ | --------------------------------------------- |
| **50012**                                     | 发布校验未过（message 带缺项） | R103                                          |
| 40400 / 40001 / 42900 / 50009 / 50001 / 50004 | 复用                           | 防探测 / 参数 / 限流 / 护栏 / 属主 / 页面校验 |

50xxx 段用至 50012；30xxx（30021 封顶）、40xxx（40120 封顶）零新增。

### 19.4 配置登记（§18.5 app 配置组追加）

`app.pubListMaxSize=50` / `app.pubFilterMaxGroups=3` / `app.pubSortMaxFields=2` /
`app.pubDataCacheTtlSeconds=60` / `app.pubManifestCacheTtlSeconds=600` / `app.pubRateLimitPerMinute=60`

### 19.5 编号登记

| 系列      | 本期使用               | 说明                                        |
| --------- | ---------------------- | ------------------------------------------- |
| 决策      | D97~D104               | PRD-P12 §2                                  |
| 规则      | R100~R108              | PRD-P12 §3                                  |
| 任务      | T108~T114              | PROGRESS「P12 任务拆解」（待 CodeBuddy 立） |
| HTTP 端点 | +10（管理 5 + 公开 5） | §19.1 / §19.2                               |
| 错误码    | +1（50012）            | §19.3                                       |
| DB        | +0 表 +4 列            | ARCHITECTURE §28.2                          |
| AI 工具   | 0 新增（37 不变）      | `pnpm check:ai` 16/16 应保持                |
| 前端依赖  | +0                     | PublicRenderer 复用 app-renderer 既有资产   |
