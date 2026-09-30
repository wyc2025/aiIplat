# API-P14 增补（并入平台 API 文档为 §21）

> 前置：PRD-P14 / ARCHITECTURE §30。本期 +11 端点、+3 错误码、AI 工具 41→43；退役 §19 公开面五端点（API 文档中标注「已退役，见 §21」）。

## §21　展示应用与数据授权（P14）

### 21.1 端点总览（+11）

**后管（登录态，display 域自服务）：**

| #   | 方法与路径                                | 说明                                                     | 错误码            |
| --- | ----------------------------------------- | -------------------------------------------------------- | ----------------- |
| 1   | `POST /api/display`                       | 创建展示应用 `{name, siteId?}`；无 siteId → 暂存区       | 50018 重名、40001 |
| 2   | `GET /api/display`                        | 我的展示应用列表（含挂靠站点名、授权数）                 | —                 |
| 3   | `PUT /api/display/:id/affiliate`          | 换挂靠 `{siteId}`（移动到目标站点目录，事务）            | 50016、40001      |
| 4   | `DELETE /api/display/:id`                 | 软删（清授权、目录保留于云盘由用户处置）                 | 50016             |
| 5   | `POST /api/display/:id/grants`            | 授权 `{appCode}`（is_public=0 的应用给出提示但仍可授权） | 50001、50017      |
| 6   | `DELETE /api/display/:id/grants/:appCode` | 撤权                                                     | 50016、50017      |

**开放层（匿名可达，R125 校验链）：**

| #   | 方法与路径                                                          | 说明                                             | 错误码            |
| --- | ------------------------------------------------------------------- | ------------------------------------------------ | ----------------- |
| 7   | `GET /api/open/:slug/disp/:id/**`                                   | 展示页静态文件（挂靠校验、index 回退、R26 MIME） | 40400             |
| 8   | `GET /api/open/:slug/api/app/:appCode/schema`                       | 暴露后表结构                                     | 40400/40001/42900 |
| 9   | `GET /api/open/:slug/api/app/:appCode/tables/:table/records`        | 列表（R104 固定口径：size≤50、sort≤2、filter≤3） | 同上              |
| 10  | `GET /api/open/:slug/api/app/:appCode/tables/:table/records/:rowId` | 详情                                             | 同上              |
| 11  | `GET /api/open/:slug/api/app/:appCode/files/:fileId/stream`         | 附件流                                           | 同上              |

**退役（§19 标注）**：`/api/pub/app/:pubCode/**` 五端点整体下线，访问一律 404（不存在路由）；`pub_code` 停止签发。`/api/open/:slug/api/**` 与既有 `/api/open/:slug/` 站点开放能力同前缀、零歧义（D31 口径）。

### 21.2 错误码（+3）

| 码    | 含义                             | 场景                                         |
| ----- | -------------------------------- | -------------------------------------------- |
| 50016 | 展示应用不存在或已删除           | 后管/开放层                                  |
| 50017 | 授权关系已存在 / 不存在          | grant / revoke                               |
| 50018 | 展示应用名称冲突（owner 内唯一） | 创建 / 市场物化重名自动 `(2)` 递增时不会出现 |

开放层未授权（未授权/未公开/未挂靠/未暴露）**统一 40400**，不区分原因（R125，防探测口径沿用）。

### 21.3 请求/响应要点

- **创建展示应用**：`POST /api/display` → `{id, name, siteId|null, folderPath, urlPreview}`；`urlPreview` = 挂靠后开放层入口 `/api/open/{slug}/disp/{id}/`（未挂靠为 null）。
- **换挂靠**：`PUT /api/display/:id/affiliate` → 事务内完成目录移动 + site_id 更新；响应 `{id, siteId, movedFiles}`；中断全回滚（R127）。
- **授权**：`POST /api/display/:id/grants` → `{appCode}`；撤权后立即触发该 app 开放层缓存 DEL（写后失效沿用）。
- **开放层数据端点**：响应结构 = §19 公开面对应端点的响应体（去掉 manifest 专属字段），`schema` 不再含 `route`（P12 走查 W2 口径保持）。
- **市场 bundle**：`POST /api/market/:code/copy` 响应扩展 `displays: [{id, name, siteId|null}]`（快照含 bundle 时返回；无则字段缺省）。`POST /api/market/submissions` 请求扩展 `withDisplayApps?: boolean`（默认 true——存在出边授权闭包时随快照打包，确认卡逐条列明）。

### 21.4 配置

| 键                          | 默认           | 说明                                                                       |
| --------------------------- | -------------- | -------------------------------------------------------------------------- |
| `display.stagingPath`       | `disp-staging` | 暂存区根目录（云盘内）                                                     |
| `display.copyNameSuffixMax` | `20`           | 市场物化重名递增上限 `(2)…(20)`，超出报 50015 风格失败并入 skippedDisplays |

### 21.5 AI 工具（41→43）

新增与修订同 ARCHITECTURE §30.7。手册三版同步：`能力清单` +2 行（写工具）、`通用版` 入口提示微调、`合注` 先腾挪后新增（R129，交付附 trim 前后字数对照）。`smoke:ai` 新增 **O 场景：bundle 复制全链**（提交含授权应用 → 审核通过 → 接收方复制 → 三副本就位、授权指向副本、无站点进暂存）。

### 21.6 冒烟与回归

- `smoke:ai` O 场景全过；M 场景（PATCH2 公开面引导）按新口径改写后全过。
- 开放层五端点（7~11）回归：授权正例 200 + 负例全 40400（未授权/未公开/未挂靠/未暴露各一）；42900 独立限流复测。
- 退役检查：`/api/pub/app/*` 任意路径 404（非 401/403，避免探测差异）。
