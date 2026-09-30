# ARCHITECTURE-P14 增补（并入平台 ARCHITECTURE 文档为 §30）

> 前置：PRD-P14、台账 §20/§21。本期为模型修订期：+1 域 display、+2 表，退役 P12 公开面五端点与 PublicRenderer，市场快照 bundle 化。

## §30　展示应用与数据授权（P14）

### 30.1 新域 display

`apps/api/src/modules/display/`：**独立 Nest 模块**，两表，**零跨域 import**（铁律 6）；对外只经 `DisplayFacade`（铁律 3）。消费方：

- site 域开放层控制器：静态文件服务 + 数据端点的 R125 校验链，调 `DisplayFacade.assertCanRead(appCode, siteId)`；
- app 域（授权管理挂在展示应用视角）与 ai 域工具：经 `DisplayFacade` 创建/挂靠/授权/撤权；
- market 域复制物化：`MarketFacade` → `AppFacade.materializeListing` 扩展后，经 `DisplayFacade.materializeBundle` 落展示应用副本与授权重建（红线：仍全量经 DataService 写数据侧）。

### 30.2 表结构（迁移 `20260930100000_add_display_domain`，名称以实施为准）

```sql
disp_display (
  id            BIGINT UNSIGNED PK AI,
  owner_id      BIGINT UNSIGNED NOT NULL,        -- 复用现有属主语义（同 app_def.owner_id 口径）
  name          VARCHAR(64)  NOT NULL,
  site_id       BIGINT UNSIGNED NULL,            -- 挂靠站点，NULL=暂存区（未挂靠）
  folder_path   VARCHAR(512) NOT NULL,           -- 目录：挂靠时=站点目录内相对路径；暂存=云盘暂存区路径
  status        TINYINT NOT NULL DEFAULT 1,      -- 1 正常 0 删除（软删）
  ctime         DATETIME, mtime DATETIME,
  UNIQUE KEY uk_owner_name (owner_id, name)
);

disp_grant (
  id          BIGINT UNSIGNED PK AI,
  app_id      BIGINT UNSIGNED NOT NULL,      -- app_def.id
  display_id  BIGINT UNSIGNED NOT NULL,      -- disp_display.id
  granted_by  BIGINT UNSIGNED NOT NULL,
  ctime       DATETIME,
  UNIQUE KEY uk_app_display (app_id, display_id),
  KEY idx_display (display_id)
);
```

`app_def.pub_code` 列保留不删（历史数据无害），停止签发与消费（D115）。`app_page.kind` 收缩为仅 `admin`（存量 display 页登记后删，R126）。

### 30.3 文件与托管模型

- **挂靠即移动**（D116/R127）：展示应用目录物理位于所挂靠站点目录（`site_site.root_folder_id` 树）内，路径 `…/{站点目录}/disp/{displayId}/`；换挂靠 = 物理移动 + `site_id` 更新同事务。未挂靠 = 目录在属主云盘系统暂存区（`…/disp-staging/{ownerId}/{displayId}/`）。
- **开放层静态服务**：`GET /api/open/:slug/disp/:id/**`——校验该展示应用存在、未软删、且 `site_id` = 该 slug 站点；从站点目录（或暂存区，仅属主本人可访问？**否**：暂存区不对外服务，未挂靠即 40400）流式返回文件，`R26` MIME 判定沿用。`index.html` 缺省回退沿用站点静态机制。
- **生成规范**（R124）：AI 生成时提示词强制相对路径 + 同源 `/api/open/<slug>/api/app/<appCode>/...` 取数；目录初始文件命名建议 `index.html` 为入口。

### 30.4 开放层数据端点（匿名端点的授权化替代）

`GET /api/open/:slug/api/app/:appCode/` 下四端点（取代退役的 `/api/pub/app/:pubCode/*`，参数与 R104 固定口径不变）：

| 端点                            | 说明                                   |
| ------------------------------- | -------------------------------------- |
| `/schema`                       | 表结构（暴露三开关过滤后）             |
| `/tables/:table/records`        | 列表（size≤50、sort≤2、filter≤3 沿用） |
| `/tables/:table/records/:rowId` | 详情                                   |
| `/files/:fileId/stream`         | 附件流（R26 MIME；暴露校验沿用）       |

**校验链（R125）**：站点存在 → `DisplayFacade.assertCanRead`（站点下任一挂靠展示应用存在 `disp_grant` 命中该 app）→ `app_def.is_public=1` → 表/字段暴露三开关。任一不满足 → **40400**（对外不区分原因；参数错仍 40001；限流 42900 独立配额沿用）。**缓存与失效沿用 P12**：数据 60s + 写后 DEL（授权/暴露/is_public 变更均触发 DEL）、schema 600s。双路径执行器（DB 下推/内存 1 万行帽 50009）原样复用。

### 30.5 退役清单（T126/T127）

- `/api/pub/app/:pubCode/manifest|schema|tables/:t/records|records/:id|files/:f/stream` 五端点删除（访问 404）。
- `PublicRenderer`、前端 `/p/:pageCode` 路由、display 页编辑/预览入口移除；`PubDataService` 中匿名渲染相关收敛。
- PATCH2「README 三模板 · 数据应用公开接口」节与 `list_data_apps` 输出重写（D118）；`smoke:ai` M 场景用例按新口径改。

### 30.6 市场 bundle（T129）

- **快照结构扩展**：`market_listing.snapshot` 增加 `displays[]`（`{name, files:{path,content}[]}`）与 `grants[]`（`{appTable, displayName}`——以名字对记录，复制时按物化后的新 id 重建）；提交时由 `MarketFacade` 经 `DisplayFacade` 取**出边闭包**（该 app 授权的全部展示应用），随 `submit_market_app` 确认卡逐条列明。
- **复制物化**：`AppFacade.materializeListing` 扩展——先按原流程物化数据应用（DataService 红线不变），再 `DisplayFacade.materializeBundle(snapshot.displays, snapshot.grants, newAppId)`：接收方名下逐个建 `disp_display`（重名自动 `xxx(2)` 递增）、写文件（无站点→暂存区；有站点→挂第一站点并移入）、按 displayName→新 id 映射重建 `disp_grant`（指向新 appId）。返回值附 `displays: [{id,name,siteId|null}]`。
- **边界（R128）**：快照冻结；反向边不带；断链自担；审核含文件内容过目。

### 30.7 AI 工具链（41→43）

| #   | 工具                 | 类型         | 参数                              | 说明                                   |
| --- | -------------------- | ------------ | --------------------------------- | -------------------------------------- |
| 42  | `create_display_app` | 写（确认卡） | `{name, siteSlug?}`               | 创建展示应用；无站点/不填 → 暂存区     |
| 43  | `authorize_data_app` | 写（确认卡） | `{appCode, displayId, isGranted}` | 授权/撤权，镜像 `expose_data_app` 模式 |

既有工具修订：`list_data_apps` 输出改授权口径（不再给 pubCode 直链话术）；`submit_market_app` 确认卡扩展列 bundle；`publish_data_app`/`expose_data_app` 语义不变（描述文本同步 is_public 新口径）。`check:ai` + `smoke:ai`（新增 O：bundle 复制全链）必过（T95 纪律）。手册腾挪按 R129，交付附字数对照。

### 30.8 已知边界

① bundle 展示文件断链自担；② 管理端审核人工过目打包文件；③ 展示副本无数据时空渲染（与数据侧演示数据选项正交）；④ 暂存区展示应用仅属主后管可见，公开访问一律 40400；⑤ 跨用户复制的授权重建**不包含**接收方反向授予他人（复制后授权图 = 快照出边闭包的镜像）。
