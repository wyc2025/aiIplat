# iplat —— 架构文档 P4a 增补：个人网站（site 域）+ 云盘公开机制

> **【已并入】** 本文 §14 全文已于 T40 并入 ARCHITECTURE.md（§4.8 / §5 / §8 / §9 / §14），主文档为准；本文保留为 P4a 过程细节的历史参考，后续修订只改主文档。
> 本文档是 ARCHITECTURE.md 的 P4a 增补，既定铁律（域边界、统一响应、gateway 层、资产复用、零新依赖）全部沿用。
> P4a 关键前提：**静态托管复用云盘**（cloud_file + StorageService），不建独立站点存储；**零新 npm 依赖**。

## 14. site 域（P4a 新增）

### 14.1 后端目录结构

```
api/src/modules/site/
├── site.module.ts            # 域模块：exports SiteFacade（门面）
├── facade/
│   └── site-facade.service.ts # SiteFacade：hasSite(userId)（R13 删用户预检，供 system 域）
├── manage/                   # 站点设置
│   ├── manage.controller.ts  #   GET/POST/PUT /api/site/mine
│   ├── manage.service.ts     #   创建站点（建公开目录+media/+模板复制）、编辑、启停
│   └── dto/
├── column/                   # 栏目树（≤3 级）
├── tag/                      # 标签
├── article/                  # 文章（含封面/字数/发布状态）
├── comment/                  # 评论（审核流）
└── open/                     # ★ 开放层：访客侧唯一出口，全部 @Public
    ├── open-api.controller.ts   # /api/open/:slug/api/*（数据接口，先注册，见 14.4 路由顺序）
    ├── open-static.controller.ts# /api/open/:slug 与 /api/open/:slug/{*path}（静态文件）
    ├── open.service.ts          # 数据接口编排 + 热数据缓存
    └── resolve.service.ts       # slug→站点、路径→cloud_file 解析（含缓存与负缓存）

apps/api/assets/site-template/  # 默认模板（应用静态资产，非用户文件，不受 StorageService 纪律约束）
├── index.html  ├── style.css  ├── app.js  └── README.txt
```

纪律：

- site 域**禁止** import cloud/system/ai 内部实现；云盘能力只经 `CloudFacade`（见 14.7）；system 删用户预检经 `SiteFacade.hasSite`
- 开放层（open/）只允许读操作 + 评论提交；任何写操作（文章/栏目/设置）不得出现在开放层
- 一切物理文件读写只经 `infra/storage/StorageService`（既有纪律）；模板目录属应用资产，读取可用 fs，写入用户站点必须经 StorageService

### 14.2 数据表（6 张 site_ + cloud_file 加列；relationMode="prisma" 逻辑外键）

**site_site —— 站点（每用户一站）**

| 字段                      | 类型               | 说明                                                   |
| ------------------------- | ------------------ | ------------------------------------------------------ |
| id                        | bigint PK          |                                                        |
| user_id                   | bigint unique      | 属主（逻辑关联 sys_user，禁 JOIN）；单站约束           |
| slug                      | varchar(32) unique | 站点标识（R11：格式 + 保留字黑名单 + 全局唯一）        |
| title                     | varchar(50)        | 站点标题                                               |
| description               | varchar(200) null  |                                                        |
| root_folder_id            | bigint             | 站点根目录（逻辑关联 cloud_file，经 CloudFacade 校验） |
| media_folder_id           | bigint             | 媒体目录（站点根下 media/），供后台上传定位            |
| status                    | tinyint default 1  | 1 启用 / 0 停用（停用即开放层全 404，R10）             |
| comment_audit             | tinyint default 1  | 评论审核开关（1 开=需审核 / 0 关=直过审）              |
| create_time / update_time | datetime           |                                                        |

**site_column —— 栏目树**

| 字段                    | 类型          | 说明                |
| ----------------------- | ------------- | ------------------- |
| id                      | bigint PK     |                     |
| site_id                 | bigint        | 冗余便于按站点过滤  |
| parent_id               | bigint        | 0 = 根；≤3 级（R6） |
| name                    | varchar(32)   |                     |
| sort                    | int default 0 | 同级排序，升序      |
| created_at / updated_at | datetime      |                     |

索引：`(site_id, parent_id)`。同级同名不去重（用户自理）。

**site_tag —— 标签**

`id / site_id / name varchar(32) / created_at`，`unique(site_id, name)`，索引 `(site_id)`。

**site_article —— 文章**

| 字段                    | 类型              | 说明                                                  |
| ----------------------- | ----------------- | ----------------------------------------------------- |
| id                      | bigint PK         |                                                       |
| site_id                 | bigint            |                                                       |
| column_id               | bigint            | 逻辑关联 site_column                                  |
| title                   | varchar(100)      |                                                       |
| summary                 | varchar(200)      | 留空自动取正文纯文本前 100 字                         |
| cover_path              | varchar(255) null | 封面相对站点根路径（必须 media/ 前缀，R 校验见 14.7） |
| content_md              | longtext          | markdown 原文（开放层下发原文，渲染由站点代码负责）   |
| word_count              | int default 0     | 保存时统计（R14 口径）                                |
| view_count              | int default 0     | R8 去重计数                                           |
| status                  | tinyint default 0 | 0 草稿 / 1 已发布                                     |
| published_at            | datetime null     | 首次发布时间（下架再上架不刷新）                      |
| created_at / updated_at | datetime          | 无 deleted_at（R7 物理删除）                          |

索引：`(site_id, status, published_at)`、`(site_id, column_id)`。

**site_article_tag —— 文章-标签**

`id / article_id / tag_id`，`unique(article_id, tag_id)`，索引 `(article_id)`、`(tag_id)`。

**site_comment —— 评论**

| 字段         | 类型              | 说明                                                   |
| ------------ | ----------------- | ------------------------------------------------------ |
| id           | bigint PK         |                                                        |
| site_id      | bigint            | 冗余                                                   |
| article_id   | bigint            |                                                        |
| nickname     | varchar(32)       | 访客昵称                                               |
| content      | varchar(500)      |                                                        |
| audit_status | tinyint default 0 | 0 待审核 / 1 通过 / 2 驳回（审核开关关闭时提交直置 1） |
| ip           | varchar(50)       | 提交者 IP（R8 取值口径）                               |
| created_at   | datetime          |                                                        |

索引：`(article_id, audit_status)`、`(site_id, audit_status)`。

**cloud_file 变更**：新增列 `is_public tinyint default 0`，**三态语义**（R2 修订）：`0=继承父目录`（新建默认，上传/mkdir 不写此列）/ `1=显式公开`（继承链锚点，站点根恒为 1）/ `2=显式阻断`（"取消公开"落库值）。公开性上溯判定见 14.4。

### 14.3 站点创建流程（manage.service）

1. 校验 slug（R11：正则 `^[a-z0-9][a-z0-9-]{2,31}$` + 保留字黑名单 `api,www,admin,manage,system,open,static,assets,public,login,s,site` + 全局唯一 40102/40103）；校验当前用户无站点（40101 已开通）
2. 经 CloudFacade 在用户云盘根建目录「我的站点」（重名自动"(1)"）并 `is_public=1`，建子目录 `media/`
3. 复制模板：读 `assets/site-template/` 四文件 → StorageService 落盘 → 登记 cloud_file（parent=站点根，is_public 继承目录链无需单标）→ used 正常记账（R3 不变）
4. 落 site_site 行（root_folder_id / media_folder_id 回填）
5. 任一步失败回滚：删目录（经 cloud 域删除语义）+ 不建站点行

改 slug：更新 site_site → 主动失效 `site:resolve:{旧slug}`（新 slug 缓存随请求重建）。停用/启用：主动失效 `site:resolve:{slug}`。

### 14.4 公开访问链路（开放层核心）

**路由与顺序**（NestJS 11 / Express 5 通配语法）：

```ts
@Public()
@Controller('open')
// controllers 数组：OpenApiController 必须先于 OpenStaticController 注册
// OpenApiController:    @Get(':slug/api/...') 等具体数据路由
// OpenStaticController: @Get(':slug') 与 @Get(':slug/{*path}')（{*path} 得 string[]，join('/')）
// 双保险：静态端点解析到首段 === 'api' 一律 40400
```

**解析与输出流程**（resolve.service + open-static.controller）：

```
GET /api/open/{slug}/[path]
 1. ThrottlerGuard：静态桶 120 次/分/IP（site 配置组）
 2. slug 解析：读缓存 site:resolve:{slug}（TTL 300s，JSON：siteId/rootFolderId/status/title/description/commentAudit）
    未命中查 site_site 写缓存；站点不存在/停用 → 40400
 3. 路径规范化：解码 → 拒绝空段/反斜杠/`.`/`..` 段 → join；非法 → 40400
 4. 目录语义（R4）：path 空 → "index.html"；尾斜杠 → path+"index.html"；
    无扩展名且按文件找不到但按目录找到 → 301 补斜杠
 5. 路径解析：读缓存 site:path:{siteId}:{path}（TTL 60s，值=fileId 或 "404" 负缓存）
    未命中：经 CloudFacade.resolvePublicPath(rootFolderId, path)：
      自根目录逐段下行（每段一次查询，深度 ≤10 有界）→ 命中 cloud_file 行；
      再自目标上溯（R2 修订·三态继承）：遇第一个非继承节点定生死——is_public=1 放行
      （可穿透父级显式阻断）/ =2 阻断；一路继承（0）到根仍无显式锚点 → 阻断；
      结果（含 "404" 负缓存）写缓存；解析到目录不算文件命中（交由 301/目录语义）
 6. 缓存头协商：ETag = W/"{size}-{updateTime毫秒}"；If-None-Match 命中 → 304；
    Last-Modified = update_time；Cache-Control：html → no-cache，其余白名单 → public,max-age=3600
 7. 输出：经 CloudFacade.getPublicStream(fileId) → StorageService.createReadStream 管道；
    响应头按 14.5 MIME 表 + nosniff + ACAO:*；Range 支持复用既有流式逻辑；
    socket.setTimeout(30_000)（空闲超时，活跃流不受影响，防慢连接占 fd）
 8. 全程禁挂 @OperationLog；异常（除业务 40400）记 winston 运行日志
```

**缓存失效**：

- 主动失效（site 域写操作）：改 slug/停用/启用/换根目录 → `DEL site:resolve:{slug}`；文章/栏目/标签/评论变更 → `scanDel site:data:{siteId}:*`
- 被动失效（cloud 域变更：重命名/移动/删除/还原/公开性变更）：不跨域回调，靠 `site:path` 60s TTL 兜底（R12，文档明示"最长 60 秒生效"）

### 14.5 MIME 白名单与安全响应头

| 类别       | 扩展名                                           | Content-Type                            | 附加头                          |
| ---------- | ------------------------------------------------ | --------------------------------------- | ------------------------------- |
| 可执行文档 | html / htm                                       | text/html; charset=utf-8                | **CSP sandbox**                 |
| 可执行文档 | svg                                              | image/svg+xml                           | **CSP sandbox**                 |
| 可执行文档 | xml                                              | application/xml                         | **CSP sandbox**                 |
| 脚本       | js / mjs                                         | text/javascript                         | —                               |
| 样式       | css                                              | text/css                                | —                               |
| 数据       | json                                             | application/json                        | —                               |
| 纯文本     | txt / md / log / yml / yaml / csv                | text/plain; charset=utf-8（沿用 P3 R7） | —                               |
| 图片       | jpg / jpeg / png / gif / webp / ico / bmp / avif | 各自标准 mime                           | —                               |
| 字体       | woff / woff2 / ttf / otf                         | font/woff2 等                           | —                               |
| 音视频     | mp4 / mp3 / webm / ogg / wav / m4a               | 各自标准 mime                           | —                               |
| 文档       | pdf                                              | application/pdf                         | —                               |
| 其他一切   | *                                                | application/octet-stream                | Content-Disposition: attachment |

- CSP sandbox 头固定值：`sandbox allow-scripts allow-forms allow-popups allow-downloads`（opaque origin：页面读不到主域凭证，这是对 P3 R7「文本强制 text/plain」铁律的**收窄豁免——仅限本开放链路、仅限白名单类型、必须配 sandbox + nosniff**；云盘后台预览链路 R7 维持不变，同一文件两条路由两种策略互不干扰）
- svg 必须进沙箱（可携带脚本，最易漏防）
- helmet 全局 nosniff 已开启：MIME 映射错误会导致 js/css 被拒执行，映射表必须与上表一致
- **CORS**：opaque origin 下一切 fetch 均跨源 → /api/open 全链路返回 `Access-Control-Allow-Origin: *`，并允许 `Content-Type` 头（评论提交 application/json 会触发 preflight）。main.ts 的 CORS 配置改为函数：路径以 `/api/open` 开头 → origin 反射为 `*`；其余路径维持 CORS_ORIGINS 白名单不变（后台面不受影响）
- 字体加载（@font-face）强制 CORS，已由上条覆盖

### 14.6 开放数据 API（约定，契约详见 API.md §6.3）

- 统一 `/api/open/:slug/api/` 前缀；全部 @Public；独立限流 60 次/分/IP（评论提交 10 次/分/IP）
- 一切失败统一 40400（站点不存在/停用、文章不存在、栏目不存在同码，防探测）
- 列表强制分页：pageNo/pageSize，pageSize 上限 50（DTO @Max(50)）
- 文章列表/详情仅返回 status=1（已发布）；评论仅返回 audit_status=1
- 热数据缓存 `site:data:{siteId}:{接口}:{参数摘要}` TTL 60s：columns/tags/articles 列表/articles 详情（详情缓存不含 view_count 展示实时性——view_count 直接读库回覆盖缓存值即可，计数仍在 Redis 窗口控制）；site 域写操作主动 scanDel 失效
- 栏目树返回**嵌套 children 结构**（例外于平台"平铺+前端组树"惯例：消费者是用户站点代码，没有 tree.ts 可用；栏目 ≤3 级规模小，后端组树）
- 文章详情触发查看数（R8）；评论提交限流（R9）
- IP 取值：`X-Forwarded-For` 首段，无该头时取 socket 地址（main.ts 设 `trust proxy`；文档前提：将来接入反向代理后该假设成立，纯直连部署下两者等价）

### 14.7 域门面扩展

**CloudFacade 新增**（cloud 域实现，随 CloudModule 导出）：

```ts
setPublic(userId: number, fileId: number, isPublic: boolean): Promise<void>
// 校验归属（30001）；仅标记自身（级联语义由上溯判定承担，不级联写）

resolvePublicPath(rootFolderId: number, path: string): Promise<CloudFile | null>
// 自根逐段下行 + 上溯校验公开链与删除态（R2）；任一不满足返回 null（开放层转 40400）

getPublicStream(fileId: number): Promise<{ stream, size, mime, ext, name, updateTime }>
// 内部复用 StorageService.createReadStream（Range 由调用方处理）

createFolder(userId: number, parentId: number, name: string): Promise<CloudFile>
// 供站点创建流程建目录（复用 R4 同名自动"(1)"与 R6 限制）

registerPublicFile(userId: number, folderId: number, name: string, tmpMeta): Promise<CloudFile>
// 供模板复制：tmp→正式区 + 落 cloud_file + used 记账（复用 T27 链路）
```

**SiteFacade 新增**（site 域实现，随 SiteModule 导出）：

```ts
hasSite(userId: number): Promise<boolean>
// R13 删用户预检：有 site_site 行即 true；system UserService.remove 依次调 hasFiles → hasSite
```

### 14.8 覆盖上传（cloud 域 transfer 增量）

- `POST /api/cloud/file/upload` 新增 query `overwrite`（0/1，缺省 0）
- overwrite=1 且同目录存在同名**未删文件**：tmp→新正式区 → 更新该行 size/mime/ext/storage_name/update_time → `used += 新size - 旧size`（差额可负，`$executeRawUnsafe` 兜底不为负）→ 删旧物理文件；命中文件夹或 overwrite=0 → 维持 R4 自动"(1)"
- 覆盖成功使旧公开 URL 内容即时指向新文件（storage_name 更新即生效，URL 不变）

### 14.9 Redis Key 增补（写入 RedisKey 常量）

| Key                                  | 类型/TTL               | 用途                                                                                             |
| ------------------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------ |
| `site:resolve:{slug}`                | string(JSON)，TTL 300s | slug → { siteId, rootFolderId, status, title, description, commentAudit }；site 域写操作主动 DEL |
| `site:path:{siteId}:{path}`          | string，TTL 60s        | 路径 → fileId；`"404"` 为负缓存；cloud 侧变更靠 TTL 被动失效（R12）                              |
| `site:data:{siteId}:{...}`           | string(JSON)，TTL 60s  | 开放数据热缓存；site 域内容变更 scanDel 前缀失效                                                 |
| `site:view:{articleId}:{ip}`         | string，SET NX EX 300  | 查看数去重窗口（R8）                                                                             |
| `site:comment:rate:{articleId}:{ip}` | string，TTL 60s        | 同文章同 IP 评论间隔（R9，命中即 40111）                                                         |

### 14.10 seed 菜单树（P4a 增量）

```
个人网站（目录，icon Monitor，path /site）
├── 站点设置（菜单，component site/setting/index，perms site:site:manage）
├── 栏目管理（菜单，site/column/index，site:column:list）
│   └── 按钮：site:column:create / site:column:update / site:column:delete
├── 文章管理（菜单，site/article/index，site:article:list）
│   └── 按钮：site:article:create / site:article:update / site:article:publish / site:article:delete
├── 标签管理（菜单，site/tag/index，site:tag:list）
│   └── 按钮：site:tag:create / site:tag:update / site:tag:delete
└── 评论管理（菜单，site/comment/index，site:comment:list）
    └── 按钮：site:comment:audit / site:comment:delete
云盘管理/我的文件 下追加按钮：设为公开（cloud:file:public）
```

common 角色授予「个人网站」整棵子树 + cloud:file:public；超管 `*` 自动覆盖。seed 幂等（按 perms/path 判重，沿用既有风格）。

### 14.11 错误码 40xxx 段（site 域；40101 起，避开通用码）

| code  | 含义                                           | 处理                                     |
| ----- | ---------------------------------------------- | ---------------------------------------- |
| 40101 | 站点不存在或未开通                             | 后台引导创建；开放层不出现（统一 40400） |
| 40102 | slug 已被占用                                  | 提示更换                                 |
| 40103 | slug 格式非法或命中保留字                      | 提示规则                                 |
| 40104 | 站点已停用                                     | 后台提示（开放层统一 40400）             |
| 40105 | 站点根目录不可用（被删或已取消公开）           | 提示去云盘检查目录                       |
| 40106 | 栏目不存在                                     | 刷新栏目列表                             |
| 40107 | 栏目下存在子栏目或文章，不可删除               | 提示先清空                               |
| 40108 | 标签已存在                                     | 提示更换名称                             |
| 40109 | 文章不存在                                     | 刷新文章列表                             |
| 40110 | 评论不存在                                     | 刷新评论列表                             |
| 40111 | 评论提交过于频繁                               | 提示稍后再试                             |
| 40112 | 用户已开通个人网站，禁止删除（R13 删用户预检） | 提示先删除站点                           |

### 14.12 环境变量与配置增补

新增 `site` 配置组（`apps/api/src/config/site.config.ts`，均有默认值，.env 可选覆盖）：

```
SITE_OPEN_STATIC_RATE_LIMIT=120   # 开放静态限流（次/分/IP）
SITE_OPEN_API_RATE_LIMIT=60       # 开放数据限流（次/分/IP）
SITE_COMMENT_RATE_LIMIT=10        # 评论提交限流（次/分/IP）
```

main.ts 增补：`app.set('trust proxy', ...)`（R8 IP 口径）；CORS 改函数式（仅 /api/open 放行任意源，见 14.5）。

### 14.13 资产表增补（完成后回写 ARCHITECTURE §9）

| 名称               | 位置                            | 用途                                                                                                           | 状态                               |
| ------------------ | ------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| SiteFacade         | api/src/modules/site/facade     | 跨域门面：hasSite（R13）；随 SiteModule 导出                                                                   | 已建（T33）                        |
| CloudFacade 扩展   | api/src/modules/cloud/facade    | 新增 resolvePublicPath（三态继承判定）/ getPublicStream / createFolder / registerPublicFile / discardSiteDraft | 已建（T34，R2 三态修订随修订记录） |
| SiteResolveService | api/src/modules/site/open       | slug/路径解析 + 缓存 + 负缓存                                                                                  | 已建（T35）                        |
| 站点默认模板       | apps/api/assets/site-template   | 一键建站四件套（原生 JS + CDN markdown-it）                                                                    | 已建（T36）                        |
| MarkdownView       | web/src/components/MarkdownView | markdown 渲染（html:false 禁 raw HTML）；T39 由 ai 域提升为公共组件，文章编辑/预览复用                         | 已提升（T39）                      |

### 14.14 与 AI 域的关系（说明，本期无工作）

P4b 的"AI 编写站点文件"按既有 AiTool 框架加工具：write 类必走确认卡片（T21 链路）、经 CloudFacade 写文件、消耗积分；**禁止** ai 域 import site/cloud 内部 Service。PLATFORM-GUIDE.md 在 T40 回写站点能力说明。

### 14.15 演进预留（本期不做，架构不堵路）

| 项                         | 触发条件              | 预留设计                                                               |
| -------------------------- | --------------------- | ---------------------------------------------------------------------- |
| `/s/{slug}` 短路径         | 部署侧有反向代理后    | 新增控制器映射同一 service 即可                                        |
| 子域名 `{slug}.sites.域名` | 多用户真实部署        | slug 唯一键 + 保留字黑名单已铺路；接入层按 Host 解析 slug              |
| X-Accel-Redirect           | 公开流量显著增长      | NestJS 只做鉴权解析，字节由 nginx sendfile 送出                        |
| CDN                        | 公开文件被盗链/流量大 | 开放静态天然可缓存，挂 CDN 即源站卸压                                  |
| 开放层拆独立进程           | 可靠性隔离诉求        | /api/open 无鉴权、无状态、只读为主，是模块化单体拆分纪律的第一个实践点 |
