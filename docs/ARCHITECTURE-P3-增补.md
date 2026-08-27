# iplat —— 架构文档 P3 增补：云盘模块（cloud 域）

> 本文档是 ARCHITECTURE.md 的 P3 增补，既定铁律（域边界、统一响应、gateway 层、资产复用）全部沿用。
> P3 关键前提：**复用 P1 已建 StorageService（本地磁盘）**，零新基础设施、零新 npm 依赖。

## 13. cloud 域（P3 新增）

### 13.1 后端目录结构

```
api/src/modules/cloud/
├── cloud.module.ts          # 域模块：imports infra（StorageService 经 infra 出口注入）
├── file/                    # 我的文件
│   ├── file.controller.ts   #   list/path/mkdir/rename/delete
│   ├── file.service.ts      #   文件树查询与维护（同名判定、R2/R5 语义）
│   └── dto/                 #   MkdirDto / RenameDto（class-validator）
├── transfer/                # 上传下载
│   ├── transfer.controller.ts # upload/preview/download（流式）
│   └── transfer.service.ts    # 配额校验、used 记账、预览白名单
├── recycle/                 # 回收站
│   ├── recycle.controller.ts
│   └── recycle.service.ts   # 顶层被删项算法、还原、递归彻底删除
├── share/                   # 公开链接
│   ├── share.controller.ts  # 管理侧（登录）：create/list/stop/extend
│   ├── share-public.controller.ts # 访客侧（@Public）：info/download
│   └── share.service.ts
├── quota/
│   ├── quota.service.ts     # cloud_usage 懒创建、增减记账、admin 调整
│   └── quota.controller.ts  # GET 我的配额 + PUT admin 调整
└── cloud.facade.ts          # ★ 域门面：对外（system 域）仅暴露 hasFiles(userId)
```

纪律：

- cloud 域**禁止** import system/ai 域内部实现；需要"用户名展示"等场景一律按现有分页接口范式在 cloud 域内查 sys_user？——**禁止**：跨域读表同样禁止。分享/配额等需要用户名的管理场景，经 system 域 exports 的门面 Service 获取（P2b ToolBootstrap 为范例）；system 删用户预检经 cloud 门面 `hasFiles`（CloudModule exports CloudFacade）。
- 云盘**不走** `/api/system/file/upload`（那是 system 域 10MB 通用口，落 sys_file 供头像等场景）；cloud 有自己的上传链路，落 cloud_file。
- 一切物理文件读写只经 `infra/storage/StorageService`，禁止业务代码直接操作 fs（既有纪律）。

### 13.2 数据表（3 张，cloud_ 前缀，relationMode="prisma" 逻辑外键）

**cloud_file —— 文件树（文件+文件夹统一建模）**

| 字段                      | 类型              | 说明                                                      |
| ------------------------- | ----------------- | --------------------------------------------------------- |
| id                        | bigint PK         |                                                           |
| user_id                   | bigint            | 属主（逻辑关联 sys_user，禁 JOIN）                        |
| parent_id                 | bigint            | 0 = 根目录                                                |
| name                      | varchar(64)       | 文件/文件夹名（不含路径）                                 |
| is_dir                    | tinyint           | 1 文件夹 / 0 文件                                         |
| size                      | bigint default 0  | 字节；文件夹恒 0                                          |
| mime                      | varchar(100) null |                                                           |
| ext                       | varchar(20) null  | 小写不带点，预览白名单判断用                              |
| storage_name              | varchar(120) null | StorageService 相对路径（yyyyMM/uuid.ext）；文件夹为 null |
| audit_status              | tinyint default 0 | 0 未审核 / 1 通过 / 2 驳回 / 3 审核中（D13 预留）         |
| deleted_at                | datetime null     | 非空 = 在回收站（R2 只标记自身）                          |
| create_time / update_time | datetime          |                                                           |

索引：`(user_id, parent_id, deleted_at)`、`(user_id, deleted_at)`。
**不加** (user_id,parent_id,name) 唯一索引（deleted_at 参与语义，MySQL 无法表达）——同名约束在应用层（R4 + 竞态兜底）。

**cloud_share —— 公开链接**

| 字段        | 类型               | 说明                                                     |
| ----------- | ------------------ | -------------------------------------------------------- |
| id          | bigint PK          |                                                          |
| user_id     | bigint             | 创建者                                                   |
| file_id     | bigint             | 逻辑关联 cloud_file（仅文件，is_dir=0）                  |
| token       | varchar(32) unique | 随机 URL-safe 串（nanoid/crypto.randomBytes，禁自增 ID） |
| visit_count | int default 0      | 下载成功 +1                                              |
| expire_at   | datetime null      | null = 永久                                              |
| status      | tinyint default 1  | 1 有效 / 0 已停止（过期不置状态，靠 expire_at 判定）     |
| create_time | datetime           |                                                          |

**cloud_usage —— 配额**

| 字段        | 类型             | 说明                                  |
| ----------- | ---------------- | ------------------------------------- |
| user_id     | bigint PK        | 懒创建（首次上传/查询配额时）         |
| quota       | bigint           | 字节，默认 CLOUD_DEFAULT_QUOTA（1GB） |
| used        | bigint default 0 | 字节（R3 记账规则）                   |
| update_time | datetime         |                                       |

### 13.3 上传/下载流式纪律（防内存事故，铁律）

- **禁止 `memoryStorage`**。上传流式落临时区 `UPLOAD_DIR/tmp/`：mulerr 为 @nestjs/platform-express 的传递依赖，pnpm 隔离下不可运行时 import（`diskStorage` 工厂拿不到），故以**等价的自定义 `StorageEngine`** 实现磁盘流式落盘（`modules/cloud/transfer/tmp-storage.ts`，类型走 devDep `@types/multer` 的 type-only import）；`limits.fileSize = CLOUD_MAX_FILE_SIZE` + `defParamCharset: 'utf8'`（busboy 默认 latin1 会把中文文件名解析成 mojibake）；超限错误经 platform-express 包装为 `PayloadTooLargeException`（HTTP 413），由全局过滤器按状态码映射 30004
- Controller 校验（配额 30003 / 目录限制 30006 / 同名自动"(1)"）通过 → StorageService 将临时文件**移动**到正式区 `yyyyMM/uuid.ext` → 落 cloud_file + `used += size`；任一失败 → 删临时文件回滚
- StorageService 允许扩展方法（moveTo / remove / createReadStream / stat），属 infra 公共层，**扩展后回写资产表**
- 预览/下载：`createReadStream` 管道响应，**支持 HTTP Range**（视频拖动依赖 206 Partial Content）；下载 `Content-Disposition: attachment; filename*=UTF-8''<encodeURIComponent(原名)>`；预览为 inline + 真实 mime，**但文本类一律强制 `text/plain; charset=utf-8`**（R7：防 html/svg 内联执行脚本）
- 孤儿对象：上传流程失败即清理；全局孤儿对账 cron 列入后续（PRD D12 不做）

### 13.4 回收站语义与查询（R2 实现规约）

- **顶层被删项** = 自身 deleted_at 非空 且 沿 parent_id 上溯无 deleted 祖先。
  实现（禁 JOIN）：查该用户全部 deleted 项 → 集合内比对祖先；祖先不在集合时需补查父行 deleted_at。单用户回收站量级小，应用层过滤即可
- 浏览被删文件夹内容：`GET recycle/list?parentId=X`，前置校验 X 自身 deleted 或处于 deleted 子树内；直接按 parentId 查子项（子项 deleted_at 一律为空——R2 只标顶层）
- **还原**：只清自身 deleted_at；父目录存在且未删 → 原位，否则 parent_id=0 落根目录（响应 message 说明）；落位前同名判定，冲突自动"(1)"
- **彻底删除**：BFS 收集整棵子树 id 与 storage_name → 删 DB 行 → 删物理文件（单个失败记 warn 日志不阻断）→ `used -= Σ文件size`（不小于 0 兜底）→ **连带删除**子树内文件的 cloud_share 行
- **清空回收站**：对该用户全部顶层被删项执行同一递归逻辑

### 13.5 配额记账（R3）

- 变动时机：上传成功 `+size`；彻底删除/清空 `-size`；软删、还原、重命名、新建文件夹**不动**
- 校验与记账存在 check-then-act 竞态：个人单用户场景接受轻微超额（不超过单文件上限），文档明示，不做分布式锁
- admin 调整配额：`quota` 下限 = 当前 used；upsert（懒创建兼容）

### 13.6 公开分享端点（安全纪律）

- `share-public.controller.ts` 两个端点标 `@Public()`（免登录），**独立限流**：30 次/分/IP（@Throttle 覆盖全局）
- 访问校验链：token 存在 → status=1 → expire_at 未过 → 关联文件存在且未删除 →（开关开启时）audit_status=1；任一失败统一 30008，不区分具体原因（防探测）
- 下载成功 `visit_count += 1`；token 生成用 `crypto.randomBytes(16).toString('base64url')`，碰撞重试
- 前端访客页为**静态路由** `/share/:token`（不进 layout、不挂路由守卫），样式极简独立

### 13.7 内容审核状态机（D13 预留）

- cloud_file.audit_status：0 未审核 / 1 通过 / 2 驳回 / 3 审核中；本期上传恒置 0
- 门禁代码：ShareService.create 中 `if (config.cloudAuditEnabled && file.auditStatus !== 1) throw 30010`
- 审核引擎接入点：TransferService 上传成功末尾留 `// TODO(P3后续): 触发内容审核事件 cloud.file.uploaded`——**本期不引入 event-emitter 等新依赖**，下期接入时实现
- 开关：upload 配置组 `CLOUD_AUDIT_ENABLED`（默认 false）

### 13.8 前端结构

```
views/cloud/
├── file/index.vue          # 我的文件（FileExplorer）
├── recycle/index.vue       # 回收站（复用面包屑交互，只读浏览模式）
├── share/index.vue         # 公开链接管理（复用 ProTable）
├── components/
│   ├── FileExplorer.vue    # 面包屑 + 工具栏 + 列表（自绘，见下）
│   ├── FilePreview.vue     # 预览弹层（img/video/audio/pdf iframe/文本）
│   └── UploadButton.vue    # el-upload 自定义 http-request + 进度条
└── share-public/           # 不在此处——访客页见下
router 静态路由新增：/share/:token → views/public/share.vue（独立极简页，免登录）
```

- **FileExplorer 为自定义组件，不复用 ProTable**——双击进入/面包屑/URL 同步超出表格范式（本条写入是防止 AI 硬套 ProTable）；弹窗（新建/重命名/分享）仍用 FormDialog 范式，消息/确认用既有 ElMessage 规范
- URL 同步：`route.query.parentId`，进入目录 push、回退 back/push 均可，刷新后按 query 还原
- 预览类型判断用行数据 `ext`；文本预览 ≤2MB 时 GET 拉取渲染（禁 raw HTML，纯文本转义）
- 上传：el-upload `:http-request` 自定义（FormData + request.ts），`on-progress` 进度条；多文件并发 ≤3
- 图标：用 @element-plus/icons-vue 既有图标按 ext 映射，**不引入图标新依赖**

### 13.9 seed 菜单树（P3 增量）

```
云盘管理（目录，icon Folder，path /cloud）
├── 我的文件（菜单，cloud/file，component cloud/file/index，perms cloud:file:list）
│   ├── 上传（按钮 cloud:file:upload）
│   ├── 新建文件夹（按钮 cloud:file:mkdir）
│   ├── 重命名（按钮 cloud:file:rename）
│   ├── 删除（按钮 cloud:file:delete）
│   └── 创建分享（按钮 cloud:share:create）
├── 公开链接（菜单，cloud/share，component cloud/share/index，perms cloud:share:list）
│   └── 停止/延长（按钮 cloud:share:stop）
└── 回收站（菜单，cloud/recycle，component cloud/recycle/index，perms cloud:recycle:list）
    ├── 恢复（按钮 cloud:recycle:restore）
    └── 彻底删除（按钮 cloud:recycle:delete）
系统管理/用户管理 下追加按钮：调整配额（cloud:quota:update）
```

默认角色（普通用户）授予"云盘管理"整棵子树（不含 cloud:quota:update）；超管 `*` 自动覆盖。seed 幂等（按 perms/path 判重，沿用既有 seed 风格）。

### 13.10 错误码 30xxx 段

| code  | 含义                                                   | 前端处理                 |
| ----- | ------------------------------------------------------ | ------------------------ |
| 30001 | 文件/文件夹不存在或无权访问                            | 刷新当前目录列表         |
| 30002 | 同目录下已存在同名项                                   | 提示更换名称             |
| 30003 | 存储配额不足                                           | 提示用量与配额，引导清理 |
| 30004 | 文件超出大小限制                                       | 提示上限值               |
| 30005 | 该类型不支持预览                                       | 提示"请下载查看"         |
| 30006 | 超出目录限制（深度>10 / 单目录>500 项 / 名称>64 字符） | 提示具体限制             |
| 30007 | 回收站记录不存在                                       | 刷新回收站列表           |
| 30008 | 分享链接无效（不存在/已停止/已过期/文件已删/未过审）   | 访客页提示失效           |
| 30009 | 文件夹暂不支持创建公开链接                             | 提示                     |
| 30010 | 文件未通过内容审核，禁止分享                           | 提示（开关开启后生效）   |

### 13.11 环境变量与配置增补

`upload` 配置组扩展（均有默认值，`.env` 可选覆盖）：

```
CLOUD_MAX_FILE_SIZE=104857600    # 100MB
CLOUD_DEFAULT_QUOTA=1073741824   # 1GB
CLOUD_AUDIT_ENABLED=false        # 内容审核门禁开关
```

UPLOAD_DIR 沿用既有配置（P1 已建）。Redis **无新增 key**（公开端点限流走 throttler）。

### 13.12 资产表增补（完成后回写 §9）

| 名称                     | 位置                                          | 用途                                                                                                                                                                         | 状态                 |
| ------------------------ | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| CloudFacade              | api/src/modules/cloud/cloud.facade.ts         | 跨域门面（hasFiles，R10 删用户预检用）                                                                                                                                       | 待建（T30）          |
| StorageService 扩展方法  | api/src/infra/storage/storage.service.ts      | moveToStorage（tmp→正式区 yyyyMM/uuid.ext）/remove/removeTmp/createReadStream（Range）/stat/tmpDir，含路径穿越与 tmp 区越界防御                                              | 已建（T27）          |
| 自定义 tmp StorageEngine | api/src/modules/cloud/transfer/tmp-storage.ts | Multer 临时区流式落盘引擎（pnpm 隔离下 diskStorage 的等价替代）：stat 回填 file.size / _removeFile 清半截 / fail 兜底流错误与客户端中断（三行为对齐 diskStorage 并实测通过） | 已建（T27 补充验收） |
| FileExplorer             | web/src/views/cloud/components                | 文件管理器（面包屑/双击/URL 同步）                                                                                                                                           | 待建（T31）          |
| FilePreview              | web/src/views/cloud/components                | 预览弹层                                                                                                                                                                     | 待建（T31）          |
| UploadButton             | web/src/views/cloud/components                | 上传+进度                                                                                                                                                                    | 待建（T31）          |

### 13.13 与 AI 域的关系（说明，本期无工作）

cloud 与 ai 无直接耦合。后续若加 AI 云盘工具（如 get_my_files），按 P2b `tool.types.ts` 的 AiTool 接口在 ai 域新增工具文件，handler 经 CloudFacade 调用——**禁止** ai 域直接 import cloud 内部 Service。
