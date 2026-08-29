# iplat —— 技术架构约定（ARCHITECTURE.md）

> 本文档是 iplat 的技术宪法。代码生成与审查以本文档为准；与对话中的口头约定冲突时，以本文档为准。

---

## 1. 技术选型总表

### 1.1 前端（apps/web）

| 类别          | 选型                                      | 约束                                                                                                               |
| ------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 框架          | Vue 3.5 + TypeScript                      | 全部 `<script setup>`，禁止 Options API                                                                            |
| 构建          | Vite 7                                    | dev 代理 `/api` → `http://localhost:3000`；dev cors 反射 Origin（沙箱站点页预检 Origin 为 null，须放行，见 §14.5） |
| 组件库        | Element Plus 2.x                          | unplugin-vue-components 按需自动引入，禁止全量 import                                                              |
| 图标          | @element-plus/icons-vue                   | 菜单图标选择器使用                                                                                                 |
| 路由          | Vue Router 4                              | 静态路由 + 动态路由（后端菜单驱动）                                                                                |
| 状态          | Pinia                                     | 固定四个 store：user / permission / tabs / settings                                                                |
| HTTP          | Axios                                     | 业务代码只允许使用 `src/utils/request.ts` 的封装实例                                                               |
| 样式          | Tailwind CSS 4 + SCSS + CSS 变量          | Tailwind 只做布局/间距/对齐工具类；组件风格、主题用 SCSS + CSS 变量                                                |
| 图表          | ECharts 5                                 | 按需引入                                                                                                           |
| 工具库        | VueUse、dayjs、lodash-es                  | 时间格式化统一用 dayjs                                                                                             |
| 规范          | ESLint 9 + Prettier + husky + lint-staged | 提交时自动校验                                                                                                     |
| 环境          | Node ≥ 20，pnpm 9                         |                                                                                                                    |
| Markdown 渲染 | markdown-it                               | 仅用于 AI 回复渲染；渲染输出必须防 XSS（不允许 raw HTML）                                                          |

### 1.2 后端（apps/api）

| 类别       | 选型                                   | 约束                                                                    |
| ---------- | -------------------------------------- | ----------------------------------------------------------------------- |
| 框架       | NestJS 11 + TypeScript                 | 严格分层 Controller → Service → Prisma                                  |
| ORM        | Prisma 6                               | model 用 PascalCase，数据库字段用 `@map` 映射 snake_case                |
| 数据库     | MySQL 8（utf8mb4）                     | docker-compose 启动                                                     |
| 缓存       | Redis 7（ioredis）                     | token 黑名单、登录失败计数、热点缓存                                    |
| 认证       | @nestjs/jwt + @nestjs/passport         | access + refresh 双 token                                               |
| 密码       | bcrypt（salt 10）                      | 任何接口不得返回 password 字段                                          |
| 校验       | class-validator + class-transformer    | 所有入参走 DTO，禁止在 Controller 里裸取 body                           |
| 接口文档   | @nestjs/swagger                        | 路径 `/api/docs`，带 JWT 调试按钮                                       |
| 安全       | @nestjs/throttler、helmet、CORS 白名单 | 全局限流 300 次/分/IP；登录接口 10 次/分                                |
| 文件       | Multer + 本地磁盘                      | 通过 StorageService 抽象访问，预留二期切换 MinIO/OSS                    |
| 日志       | winston（运行日志）+ 操作日志落库      |                                                                         |
| 配置       | @nestjs/config + .env 多环境           | 配置项集中定义在 `src/config/`                                          |
| 定时任务   | @nestjs/schedule                       | P2a 起启用（月度额度重置），新增 cron 统一放各域 `*.task.ts`            |
| 大模型接入 | openai（官方 SDK）                     | 用 `baseURL` 指向各家 OpenAI 兼容端点，**禁止**为单一厂商引入其专属 SDK |

**P2a 新依赖白名单（仅此 3 个，已在 PRD-P2A D3 批准）**：`@nestjs/schedule`、`openai`、`markdown-it`。

### 1.3 基础设施与端口

| 项         | 值                    |
| ---------- | --------------------- |
| MySQL      | 3306，库名 `iplat`    |
| Redis      | 6379                  |
| api        | 3000，全局前缀 `/api` |
| web（dev） | 5173，代理 `/api`     |

---

## 2. Monorepo 结构

```
iplat/
├── apps/
│   ├── web/                    # Vue3 后台前端
│   └── api/                    # NestJS 后端（第一期唯一服务，预留 apps/gateway 位）
├── packages/
│   └── shared/                 # 前后端共享类型/常量/权限标识（二期启用）
├── docs/                       # PRD / ARCHITECTURE / API / PROGRESS
├── AGENTS.md
├── docker-compose.yml          # mysql + redis（第一期 api/web 本地起，二期容器化）
├── package.json                # workspace 根，统一脚本入口
└── pnpm-workspace.yaml
```

根 package.json 统一脚本约定：

```json
{
  "scripts": {
    "dev:web": "pnpm -C apps/web dev",
    "dev:api": "pnpm -C apps/api start:dev",
    "db:migrate": "pnpm -C apps/api prisma migrate dev",
    "db:seed": "pnpm -C apps/api seed",
    "infra:up": "docker-compose up -d",
    "infra:down": "docker-compose down"
  }
}
```

---

## 3. 前端架构（apps/web）

### 3.1 目录结构

```
apps/web/src/
├── api/                    # 接口层：按域分文件，如 system/user.ts、system/auth.ts
├── assets/                 # 图片等静态资源
├── components/             # 全局公共组件（只有跨页面复用的才放这里）
│   ├── ProTable/           #   封装表格：搜索区 + 表格 + 分页 + 操作列
│   ├── FormDialog/         #   封装表单弹窗：新增/编辑复用
│   ├── Upload/             #   文件上传
│   └── IconSelect/         #   图标选择器
├── directives/             # v-permission 按钮权限指令
├── hooks/                  # useTable、useDict、usePermission
├── layout/                 # 布局：index.vue + Sidebar / Navbar / TabsBar / AppMain / Settings
├── router/                 # index.ts（静态路由）+ dynamic.ts（动态路由转换）+ guard.ts（守卫）
├── stores/                 # user.ts / permission.ts / tabs.ts / settings.ts
├── styles/                 # variables.scss、index.scss、transition.scss
├── types/                  # 全局 TS 类型：api.d.ts、menu.d.ts、user.d.ts
├── utils/                  # request.ts、token.ts、tree.ts、validate.ts
└── views/                  # ★ 按域分文件夹，与后端 modules 对齐
    ├── login/              #   登录页
    ├── dashboard/          #   首页工作台
    ├── system/             #   user / role / menu / dept / dict / log（login + operation）
    ├── profile/            #   个人中心
    ├── error/              #   404
    ├── cloud/              #   （二期）
    ├── site/               #   （三期）
    └── ai/                 #   P2a 新增域
```

`views/ai/` 目录结构：

```
views/ai/
├── chat/          # AI 对话页（含组件：会话列表侧栏、消息气泡、确认预留位）
├── plan/          # 开通套餐页
├── usage/         # 我的用量页
├── provider/      # 厂商模型管理（admin，左右布局复用字典页模式）
├── admin/plan/    # 套餐管理（admin）
├── admin/usage/   # 用量明细（admin）
├── components/    # P2b 新增：工具调用组件
│   ├── ToolConfirmCard.vue   # 确认卡片
│   └── ToolResultTag.vue     # 工具结果折叠标签
└── utils/sse.ts   # SSE 客户端（fetch + ReadableStream，见 §10）
```

### 3.2 权限链路（核心机制，不得偏离）

```
1. 登录成功 → 后端返回 accessToken + refreshToken → utils/token.ts 存 localStorage
2. 跳转首页前，调用 GET /api/auth/userinfo
   ← 返回 { user, roles: string[], perms: string[], menus: MenuTree[] }
3. router/dynamic.ts 把 menus（type=1 目录 / 2 菜单）递归转为 RouteRecordRaw：
   - component 字符串（如 "system/user/index"）→ import.meta.glob('../views/**/*.vue') 映射
   - router.addRoute('layout', route)
4. 侧边栏菜单用同一棵 menus 树渲染；perms 数组存进 permission store
5. v-permission 指令：v-permission="'system:user:create'"，无权限则移除该元素；
   传数组表示满足其一即可；超管（roles 含 admin）直接放行
6. 路由守卫：无 token → /login；有 token 但无菜单数据 → 先拉 userinfo 再放行；
   已登录访问 /login → 重定向首页
7. 【免登录公开路由】动态路由（后端菜单驱动）之外的「独立根路由」默认也受守卫拦截，
   必须显式加入免登录白名单才能匿名访问。当前免登录公开路由：
   - /login、/404（WHITE_LIST 基础项）
   - /share/:token（云盘访客分享页，凭链接 token 访问，不要求登录态；
     路由守卫通过判断 to.name === 'share-visitor' 放行，见 router/guard.ts 的 isPublicRoute）
   新增任何「访客可匿名访问」的独立路由时，必须同步在 guard.ts 的 isPublicRoute 注册，
   否则会被守卫误重定向到 /login（T31 联调实测踩坑：未注册导致访客页跳登录）。
   注意：免登录公开页仍须后端对应接口标记 @Public()，前端/后端任一缺失都不可匿名访问。
```

### 3.3 request.ts 封装行为规范

- 请求拦截器：自动携带 `Authorization: Bearer <accessToken>`
- 响应拦截器：
  - `code === 0` → 直接返回 `data`（业务代码拿到的就是 data，不是整个响应）
  - `code === 40100`（token 失效）→ **单例模式**调 refresh 接口静默刷新，期间并发请求挂起排队，成功后重放；刷新失败 → 清空 token 跳 /login
  - 其他 code → `ElMessage.error(message)` 并 reject
- 业务代码禁止直接处理原始 Axios 响应、禁止自行 catch 后吞掉错误

### 3.4 页面开发模式

- 列表页必须使用 `ProTable + useTable`，禁止每个页面手写分页/加载/查询重置逻辑
- 新增/编辑必须使用 `FormDialog`，表单校验规则写在组件内
- 删除操作必须 `ElMessageBox.confirm` 二次确认
- 所有列表页处理三态：加载中（骨架/loading）、空数据（empty 提示）、加载失败（错误提示 + 重试按钮）

---

## 4. 后端架构（apps/api）

### 4.1 目录结构

```
apps/api/src/
├── main.ts                 # 全局前缀 /api、ValidationPipe、全局过滤器、Swagger、helmet
├── app.module.ts           # 注册全局守卫/拦截器、各域模块
├── gateway/                # ★ 进程内网关层：所有横切关注点唯一实现地
│   ├── guards/             #   jwt-auth.guard.ts、permission.guard.ts
│   ├── interceptors/       #   transform.interceptor.ts、operation-log.interceptor.ts
│   ├── filters/            #   global-exception.filter.ts
│   └── decorators/         #   public.decorator.ts、require-permission.decorator.ts、
│                           #   current-user.decorator.ts、operation-log.decorator.ts
├── common/                 # 纯工具：constants、enums、dto（PageQueryDto、PageResultDto）、
│                           # exceptions（BusinessException）、utils
├── config/                 # 配置定义与校验（database、redis、jwt、upload）
├── infra/                  # 基础设施
│   ├── prisma/             #   prisma.service.ts（全局）
│   ├── redis/              #   redis.service.ts（全局）
│   └── storage/            #   storage.service.ts 抽象 + local-storage.service.ts 实现
└── modules/                # ★ 业务域。禁止在 modules/ 根目录平铺新建
    └── system/             # 第一期只有 system 域
        ├── auth/           #   登录/登出/刷新/userinfo（controller + service + dto）
        ├── user/
        ├── role/
        ├── menu/
        ├── dept/
        ├── dict/
        ├── log/            #   操作日志、登录日志的查询接口
        └── online/         #   P2a 新增：在线用户（controller + service）
    └── ai/                 # ★ P2a 新增域
        ├── provider/       #   厂商与模型配置（admin CRUD + 用户侧模型列表）
        ├── conversation/   #   会话与消息（会话懒创建于 chat 首条消息流程，无独立新建接口）
        ├── chat/           #   SSE 对话（controller 原生写流 + service 编排）
        ├── engine/         #   引擎层：provider.service.ts（OpenAI 兼容适配器，
        │                   #   按 provider 配置创建 client、发起流式调用、解析 usage）
        ├── credit/         #   CreditService：预检 / 结算（幂等）/ 余额查询
        ├── plan/           #   套餐：admin CRUD + 指派 + 用户侧开通/切换
        │   └── plan.task.ts #  月度重置 cron（每日 00:30 扫描过期周期）
        ├── usage/          #   用量明细（用户侧 + admin 侧查询）
        └── tool/           #   ★ P2b 新增：工具调用
            ├── tool.types.ts    #   AiTool 接口定义
            ├── tool.registry.ts #   工具注册表（Map<name, AiTool>，模块启动时收集）
            └── tools/           #   具体工具实现，一个工具一个文件
                ├── get-online-users.tool.ts
                ├── kick-user.tool.ts
                └── ...
    └── cloud/              # ★ P3 新增域（云盘）
        ├── cloud.module.ts #   域模块：exports CloudFacade（门面）/ FileModule 等
        ├── facade/         #   ★ 域门面：跨域能力唯一出口
        │   └── cloud-facade.service.ts # CloudFacade：对外暴露 hasFiles(userId) + saveAvatar
        ├── admin/          #   管理员（配额调整 / 统计）
        │   ├── admin.controller.ts  #   PUT/GET /api/cloud/admin/quota、GET /api/cloud/admin/stats
        │   ├── admin.service.ts     #   配额调整（下限=used）、单用户/全局统计
        │   └── dto/quota.dto.ts      #   UpdateQuotaDto（class-validator）
        ├── file/           #   我的文件
        │   ├── file.controller.ts   #   list/path/mkdir/rename/delete/avatar（头像预览流）
        │   ├── file.service.ts      #   文件树查询与维护 + hasFiles + getAvatarStream
        │   └── dto/                 #   MkdirDto / RenameDto（class-validator）
        ├── transfer/       #   上传下载（流式）
        │   ├── transfer.controller.ts # upload/preview/download
        │   └── transfer.service.ts    # 配额校验、used 记账、预览白名单
        │   └── tmp-storage.ts         # 自定义 Multer StorageEngine（流式落临时区）
        ├── recycle/        #   回收站（顶层被删项算法/还原/递归彻底删除）
        └── share/          #   公开链接
            ├── share.controller.ts      # 管理侧（登录）：create/list/stop/extend
            ├── share-public.controller.ts # 访客侧（@Public）：info/download
            └── share.service.ts
```

### 4.2 请求生命周期（守卫链，全局注册顺序固定）

```
请求 → helmet → throttler（限流）
     → JwtAuthGuard（验身份，遇 @Public() 跳过）
     → PermissionGuard（验权限，接口无 @RequirePermission() 则跳过）
     → ValidationPipe（DTO 校验，失败抛 40001）
     → OperationLogInterceptor / TransformInterceptor
     → Controller → Service → Prisma
     ← 异常一律由 GlobalExceptionFilter 兜底转为统一错误响应
```

### 4.3 API 约定（前后端必须一致）

- **统一前缀**：`/api`
- **统一响应**：`{ "code": 0, "message": "success", "data": ... }`
- **错误码**：

| code  | 含义                                                                                                   |
| ----- | ------------------------------------------------------------------------------------------------------ |
| 0     | 成功                                                                                                   |
| 40001 | 参数校验失败                                                                                           |
| 40100 | 未登录 / token 失效                                                                                    |
| 40300 | 无权限                                                                                                 |
| 40400 | 资源不存在                                                                                             |
| 50000 | 服务器内部错误                                                                                         |
| 1xxxx | 业务错误（各域自定义，如 10001 用户名已存在）                                                          |
| 2xxxx | ai 域业务错误（如 20001 无套餐 / 20002 余额不足 / 20007 并发流 / 20015 无工具权限 / 20016 确认单失效） |
| 3xxxx | cloud 域业务错误（见下「cloud 错误码 30xxx 段」）                                                      |

- **分页请求**：GET 参数 `pageNo`（从 1 起）、`pageSize`（默认 10，最大 100），列表条件平铺
- **分页返回**：`data = { "list": [], "total": 0, "pageNo": 1, "pageSize": 10 }`
- **ID 规范**：数据库主键 bigint，**序列化为字符串返回前端**（JS number 精度丢失），统一在 TransformInterceptor 处理
- **时间**：接口返回 ISO 8601 字符串，展示格式化由前端 dayjs 负责
- **树形数据**：返回平铺列表，前端 `utils/tree.ts` 组树（dept、menu 通用）

### 4.4 认证与双 token

- **登录** `POST /api/auth/login`：`{ username, password }` → `{ accessToken, refreshToken, expiresIn }`
  - access token：payload `{ sub: userId, username, jti }`，有效期 **2h**
  - refresh token：有效期 **7d**，Redis 存哈希：`refresh:{userId}:{jti}`，TTL 7d
  - 登录失败计数：Redis `login:fail:{username}`，**连续失败 5 次锁定 10 分钟**
- **userinfo** `GET /api/auth/userinfo` → `{ user, roles, perms, menus }`（menus 为当前用户权限过滤后的菜单树）
- **刷新** `POST /api/auth/refresh`：`{ refreshToken }` → 校验 Redis 中存在则签发新 token 对，旧 refresh token 立即失效（rotation）
- **登出** `POST /api/auth/logout`：access token jti 加入 Redis 黑名单（TTL = 剩余有效期），删除 refresh token
- **修改密码强制全端下线**（个人中心）：写 Redis `user:pwd:changed:{userId}`（秒级时间戳，TTL = access 有效期），JwtAuthGuard 校验 token 的 iat 早于该时间戳即拒绝（40100"密码已修改"）；同时 SCAN 删除该用户全部 refresh token、清权限缓存
- 禁用用户：登录拒绝；已签发的 token 自然过期（第一期不做实时踢下线）

### 4.5 操作日志

- 装饰器 `@OperationLog('用户管理', '新增用户')` 挂在 Controller 方法上
- OperationLogInterceptor 在响应后**异步**写入 `sys_operation_log`，不阻塞主流程，写库失败只记运行日志

### 4.6 文件上传（第一期为二期云盘打底）

- 存储：`UPLOAD_DIR/yyyyMM/uuid.ext`；业务代码只允许通过 `infra/storage/StorageService` 读写文件，禁止直接操作 fs
- **实际落地说明（T30 修订，2026-08-28）**：P1 规划的 system 通用上传口 `POST /api/system/file/upload`（Multer 10MB，落 sys_file）未实现；头像上传按 §4.7 域门面约定经 `CloudFacade.saveAvatar` 落 cloud_file（虚拟 parentId=-1，不污染根目录列表），sys_file 表暂无写入方。如后续出现新的 system 域上传消费场景，再按原规划另起任务建通用上传口

### 4.7 云盘（cloud 域）架构约定（P3）

> 域纪律：cloud 域的对外能力（被 system 等域消费）**只经 `CloudFacade` 暴露**，禁止跨域 import 对端内部 Service。sys_user 头像复用 cloud_file 存储，经 `CloudFacade.saveAvatar` 登记（R10 删用户预检经 `hasFiles`）。

- **表前缀**：`cloud_`；域边界同 R6（禁止跨域 JOIN / import）
- **流式上传纪律**：全程磁盘流，不进内存
  - 方案：`Multer` 的 `diskStorage` 在 pnpm 隔离下无法工作，改用自定义 `StorageEngine`（`infra/storage/tmp-storage.ts`：写 `UPLOAD_DIR/tmp/uuid.tmp`，`fs.stat` 回填权威 `file.size`，`_removeFile` 清半截，`fail` 兜底流错误/`aborted`）
  - 超大文件：数千 MB 仍安全；支持断电续传与断点续传（**当前未实现，仅预留**）
  - 状态机：pending（tmp，无记录）→ active（正式区，有记录，@SkipTransform）→ deleted（软删）
- **回收站语义（R2）**：只标自身（OWNER 不可删他人文件），顶层被删项并列展示，还原回原父（父已删则归位根目录），彻底删除递归 children
- **配额记账（R3）**：上传成功 `+size`；彻底删除/清空 `-size`；软删、还原、重命名、新建文件夹不动；头像登记 `+size` 并软删旧头像回退 `-size`；校验与记账存在 check-then-act 竞态，个人单用户场景接受轻微超额（≤单文件上限），不做分布式锁；admin 调整配额下限=当前 used
- **分享端点安全**：访客侧 `GET /cloud/share/:token`（返回分享基本信息）与 `GET /cloud/share/:token/download`（流式下载）为 `@Public` 独立 controller（`share-public.controller.ts`，免登录、独立限流 30 次/分/IP），凭 token 访问（token 经 path，而非 query/Referer）。下载前校验 token 有效性 / status=1 / 未过期 / 文件存在且未删 /（开关开启）审核门禁；下载成功 `visit_count + 1`。当前**不区分「登录可见 / 免密公开」**（分享可见性分级待做，**注意与 P4a 的 `cloud_file.is_public` 公开托管无关，勿混淆**）。**访问次数上限（max_visits：下载达 N 次自动失效）待实现**。前端访客页 `/share/:token` 须同时：① 后端接口 `@Public()`；② 前端 `router/guard.ts` 的 `isPublicRoute` 将 `share-visitor` 加入免登录白名单（详见 §3.2）——任一侧缺失都会匿名不可访问。
- **文件预览**：活跃且通过内容审核才可读；`transfer/preview` 用 `createReadStream`（支持 Range，`Content-Type` 取 `mime`）；`file/avatar/:id` 仅当前用户自己的头像记录可读
- **内容审核（开关）**：`CloudContentAuditService` 预留（AI 文本/图片识别），默认关闭；开启后未过审文件禁止分享
- **前端结构**：`views/cloud/FileExplorer.vue`（面包屑/双击/URL 同步/上传进度/预览弹层）、`Recycle.vue`、`Share.vue`，访客分享页独立路由 `share/:token`；复用 `ProTable` / `useTable` 等公共资产
- **前端门面约束**：访客侧只调公开接口，不携带登录态 token；管理员页组件可带 token

> AI 关系（预留）：用户上传的文档/图片可经 `ai` 域检索与问答（嵌入与向量检索），当前未实现。

**cloud 错误码 30xxx 段（30xxx 为 cloud 域业务错误）**

| code  | 文案                                                   | 处理                     |
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
| 30011 | 用户仍有云盘文件，禁止删除                             | 提示（R10 删用户预检）   |
| 30012 | 该文件类型不支持在线编辑（非文本白名单扩展名，P4b）    | 提示"请下载后编辑"       |
| 30013 | 内容超出在线编辑上限（1MB，P4b）                       | 提示"请下载后编辑"       |

### 4.8 个人网站（site 域）架构约定（P4a）

> 完整设计（目录结构 / 六表 DDL / 创建流程 / 开放链路逐行流程 / MIME 表 / 门面签名 / Redis Key / seed 树 / 错误码 / 环境变量 / 演进预留）见 **§14**（由 ARCHITECTURE-P4A-增补.md §14 并入）。本节为核心纪律速览。

- **表前缀**：`site_`；域边界同 R6：site 域禁止 import cloud/system/ai 内部实现，云盘能力只经 `CloudFacade`，system 删用户预检只经 `SiteFacade.hasSite`
- **静态托管复用云盘（D4）**：不设独立站点存储。`cloud_file.is_public` **三态**：0=继承父目录（新建默认）/ 1=显式公开（站点根恒为 1）/ 2=显式阻断（"取消公开"落库值）；公开性**访问时上溯判定**——遇第一个非继承节点定生死（R2 修订）。收益：公开目录内新上传/新建内容零操作自动可访问；子树取消公开仅标自身
- **开放层（/api/open/\*）**：访客侧唯一出口，全部 `@Public`、禁挂 `@OperationLog`、资源类失败统一 40400（限流 42900 / 评论间隔 40111 为验收明文例外）。**路由顺序铁律**：数据 API（`:slug/api/*`）必须先于静态通配（`:slug/{*path}`）注册，静态层首段 `api` 双保险兜底
- **脚本隔离（D3）**：html/svg/xml 输出强制 `CSP: sandbox allow-scripts allow-forms allow-popups allow-downloads allow-modals`（opaque origin，页面读不到主域凭证）；MIME 白名单 + nosniff；白名单外 octet-stream + attachment；CORS 对 /api/open 反射 `*`（main.ts 函数式，其余路径白名单不变）；CORP 对 /api/open 改写为 `cross-origin`（main.ts 中间件，helmet 默认 same-origin 会拦截 opaque origin 页面的子资源）；`trust proxy` 开启
- **缓存体系（D11/D12）**：`site:resolve:{slug}`（300s）/ `site:path:{siteId}:{path}`（60s + "404" 负缓存）/ `site:data:{siteId}:*`（60s 热数据）；site 域写操作主动失效（改 slug/启停 → DEL resolve + scanDel data；内容变更 → scanDel data），cloud 域变更靠 60s TTL 被动失效（R12：云盘侧改动最长 60 秒在公开站点生效）
- **覆盖上传（R5）**：`overwrite=1` 且同名未删文件 → 物理替换 + used 差额记账（`GREATEST(used+delta,0)` 兜底）+ URL（file id）不变
- **文章模块**：栏目树 ≤3 级（防环+40107 保护）；字数 R14（去 markdown 标记与空白计字符，仅展示）；摘要留空自动取正文纯文本前 100 字；发布状态机（首次发布写 published_at，下架再上架不刷新）；物理删除连带标签关联与评论（R7）
- **评论（R9）**：昵称制；站点级审核开关（关=直过审）；开放层仅返回已过审；限流 10 次/分/IP + 同文章同 IP 60s 一条（40111）；查看数 R8（`site:view:{articleId}:{ip}` SET NX EX 300 去重，IP 取 XFF 首段）
- **错误码**：site 域 40101~40112（表见 §14.11）；开放层对外统一 40400 防探测

---

## 5. 数据库设计（sys_ 前缀为 P1 底座；P2a 新增 7 张 ai_ 表；P3 新增 3 张 cloud_ 表；P4a 新增 6 张 site_ 表）

> Prisma model 用 PascalCase + `@@map("sys_user")`，字段 camelCase + `@map("user_name")`。以下为数据库层结构。时间字段统一 `created_at / updated_at`，软删除用 `deleted_at`。
>
> 外键策略（T3 决策）：schema 使用 `relationMode = "prisma"`（逻辑外键，不生成物理 FK 约束）。原因：`sys_menu`/`sys_dept` 自关联以 `parent_id = 0` 表示根节点，物理 FK 无法指向不存在的记录；软删除场景下物理 FK 会阻碍删除。关联完整性由 Service 层保证，关联查询仍走 Prisma relation。

### sys_user —— 用户

| 字段                                 | 类型                   | 说明                |
| ------------------------------------ | ---------------------- | ------------------- |
| id                                   | bigint PK              | 自增                |
| username                             | varchar(50) unique     | 登录名              |
| password                             | varchar(100)           | bcrypt 哈希         |
| nickname                             | varchar(50)            | 昵称                |
| email                                | varchar(100)           |                     |
| phone                                | varchar(20)            |                     |
| avatar                               | varchar(255)           | 头像 URL            |
| gender                               | tinyint                | 0 未知 1 男 2 女    |
| dept_id                              | bigint                 | 关联 sys_dept，可空 |
| status                               | tinyint                | 1 启用 0 禁用       |
| remark                               | varchar(255)           |                     |
| last_login_at / last_login_ip        | datetime / varchar(50) |                     |
| created_at / updated_at / deleted_at | datetime               |                     |

### sys_role —— 角色

| 字段                                 | 类型               | 说明                       |
| ------------------------------------ | ------------------ | -------------------------- |
| id                                   | bigint PK          |                            |
| name                                 | varchar(50)        | 角色名                     |
| code                                 | varchar(50) unique | 角色标识，如 admin、common |
| sort                                 | int                | 显示顺序                   |
| status                               | tinyint            | 1 启用 0 禁用              |
| remark                               | varchar(255)       |                            |
| created_at / updated_at / deleted_at | datetime           |                            |

### sys_user_role —— 用户-角色

`id / user_id / role_id`，`unique(user_id, role_id)`

### sys_menu —— 菜单（目录/菜单/按钮三级）

| 字段                    | 类型         | 说明                                           |
| ----------------------- | ------------ | ---------------------------------------------- |
| id                      | bigint PK    |                                                |
| parent_id               | bigint       | 0 为根                                         |
| name                    | varchar(50)  | 显示名                                         |
| type                    | tinyint      | 1 目录 2 菜单 3 按钮                           |
| path                    | varchar(200) | 路由地址（type 1/2）                           |
| component               | varchar(200) | 前端组件路径，如 system/user/index（type 2）   |
| perms                   | varchar(100) | 权限标识，如 system:user:create（type 3 必填） |
| icon                    | varchar(50)  | 图标名                                         |
| sort                    | int          |                                                |
| visible                 | tinyint      | 1 显示 0 隐藏                                  |
| status                  | tinyint      | 1 启用 0 禁用                                  |
| created_at / updated_at | datetime     |                                                |

### sys_role_menu —— 角色-菜单

`id / role_id / menu_id`，`unique(role_id, menu_id)`

### sys_dept —— 部门

`id / parent_id / name / sort / status / created_at / updated_at / deleted_at`

### sys_dict_type —— 字典类型

`id / name / type(varchar(100) unique，如 sys_common_status) / status / remark / created_at / updated_at`

### sys_dict_data —— 字典数据

`id / type_id / label / value / sort / status / remark / created_at / updated_at`

### sys_login_log —— 登录日志

`id / username / ip / browser / os / status(1成功 0失败) / message / created_at`

### sys_operation_log —— 操作日志

`id / user_id / username / module / action / method / url / params(text) / ip / status / error_msg(text) / duration(int,ms) / created_at`

### sys_file —— 文件记录

`id / original_name / storage_name / path / url / size(bigint) / mime_type / uploader_id / created_at`

### ai_provider —— 大模型厂商

| 字段                    | 类型               | 说明                           |
| ----------------------- | ------------------ | ------------------------------ |
| id                      | bigint PK          |                                |
| name                    | varchar(50)        | 显示名，如 DeepSeek            |
| code                    | varchar(30) unique | deepseek / kimi / qwen / zhipu |
| base_url                | varchar(200)       | OpenAI 兼容端点                |
| api_key                 | varchar(255)       | 接口返回一律掩码               |
| status                  | tinyint            | 1 启用 0 禁用                  |
| sort                    | int                |                                |
| remark                  | varchar(255)       |                                |
| created_at / updated_at | datetime           |                                |

### ai_model —— 模型

| 字段                    | 类型          | 说明                                 |
| ----------------------- | ------------- | ------------------------------------ |
| id                      | bigint PK     |                                      |
| provider_id             | bigint        | 关联 ai_provider                     |
| display_name            | varchar(50)   | 显示名                               |
| model                   | varchar(100)  | API 模型名，如 deepseek-chat         |
| input_price             | decimal(8,4)  | 输入单价（积分/千 tokens）           |
| output_price            | decimal(8,4)  | 输出单价（积分/千 tokens）           |
| max_context             | int           | 上下文长度（tokens），用于消息截取   |
| support_tool            | tinyint       | 是否支持工具调用（P2b 用，本期存值） |
| status / sort           | tinyint / int |                                      |
| created_at / updated_at | datetime      |                                      |
|                         |               | unique(provider_id, model)           |

### ai_conversation —— 会话

| 字段                                 | 类型         | 说明                                 |
| ------------------------------------ | ------------ | ------------------------------------ |
| id                                   | bigint PK    |                                      |
| user_id                              | bigint       | 归属用户                             |
| title                                | varchar(100) | 首条消息前 20 字自动生成，可改       |
| model_id                             | bigint       | 当前选用模型（切换模型即更新此字段） |
| created_at / updated_at / deleted_at | datetime     | 软删                                 |

索引：(user_id, updated_at)

### ai_message —— 消息

| 字段                         | 类型        | 说明                                            |
| ---------------------------- | ----------- | ----------------------------------------------- |
| id                           | bigint PK   |                                                 |
| conversation_id              | bigint      |                                                 |
| role                         | varchar(20) | user / assistant（system 不持久化，由后端拼装） |
| content                      | longtext    |                                                 |
| model_id                     | bigint      | assistant 消息记录所用模型，可空                |
| tokens_input / tokens_output | int         | assistant 消息记录实际用量                      |
| credits                      | int         | 本条消息扣减积分（user 消息为 0）               |
| status                       | tinyint     | 1 正常 2 失败（流中断/上游错误）                |
| created_at / deleted_at      | datetime    |                                                 |

索引：(conversation_id, created_at)

### ai_plan —— 套餐

| 字段                                 | 类型               | 说明                     |
| ------------------------------------ | ------------------ | ------------------------ |
| id                                   | bigint PK          |                          |
| name                                 | varchar(50)        |                          |
| code                                 | varchar(50) unique |                          |
| monthly_credits                      | bigint             | 每月积分额度             |
| price                                | decimal(10,2)      | 展示用（本期无真实支付） |
| description                          | varchar(500)       |                          |
| status / sort                        | tinyint / int      |                          |
| created_at / updated_at / deleted_at | datetime           |                          |

### ai_user_plan —— 用户订阅（每用户一行生效记录）

| 字段                    | 类型          | 说明                               |
| ----------------------- | ------------- | ---------------------------------- |
| id                      | bigint PK     |                                    |
| user_id                 | bigint unique |                                    |
| plan_id                 | bigint        |                                    |
| cycle_start / cycle_end | datetime      | 当前计费周期（开通日起一个自然月） |
| total_credits           | bigint        | 本周期总额度（快照，换套餐即更新） |
| used_credits            | bigint        | 本周期已用                         |
| created_at / updated_at | datetime      |                                    |

### ai_usage_log —— 用量明细

| 字段                         | 类型      | 说明                                                 |
| ---------------------------- | --------- | ---------------------------------------------------- |
| id                           | bigint PK |                                                      |
| user_id                      | bigint    |                                                      |
| conversation_id / message_id | bigint    | message_id 用于结算幂等（unique）                    |
| model_id                     | bigint    |                                                      |
| tokens_input / tokens_output | int       |                                                      |
| estimated                    | tinyint   | 1 = usage 为字符数估算（上游未返回），0 = 上游真实值 |
| credits                      | int       |                                                      |
| created_at                   | datetime  |                                                      |

索引：(user_id, created_at)、unique(message_id)

### ai_tool_call —— 工具调用留痕（P2b 新增）

| 字段                         | 类型         | 说明                                               |
| ---------------------------- | ------------ | -------------------------------------------------- |
| id                           | bigint PK    | 即确认单 ID（confirm 接口路径参数）                |
| conversation_id / message_id | bigint       | 关联会话与 assistant 消息                          |
| user_id                      | bigint       | 操作人                                             |
| tool_name                    | varchar(50)  |                                                    |
| params                       | json         | 模型生成的调用参数                                 |
| risk                         | varchar(10)  | read / write                                       |
| status                       | varchar(20)  | pending / confirmed / rejected / executed / failed |
| result                       | text         | 执行结果摘要（截断存储，最多 2000 字符）           |
| error_msg                    | varchar(500) | 失败原因                                           |
| created_at / updated_at      | datetime     |                                                    |

索引：(conversation_id)、(user_id, created_at)

### cloud_file —— 文件树（P3 新增，文件+文件夹统一建模）

| 字段                      | 类型              | 说明                                                                   |
| ------------------------- | ----------------- | ---------------------------------------------------------------------- |
| id                        | bigint PK         |                                                                        |
| user_id                   | bigint            | 属主（逻辑关联 sys_user，禁 JOIN）                                     |
| parent_id                 | bigint            | 0 = 根目录                                                             |
| name                      | varchar(64)       | 文件/文件夹名（不含路径）                                              |
| is_dir                    | tinyint           | 1 文件夹 / 0 文件                                                      |
| size                      | bigint default 0  | 字节；文件夹恒 0                                                       |
| mime                      | varchar(100) null |                                                                        |
| ext                       | varchar(20) null  | 小写不带点，预览白名单判断用                                           |
| storage_name              | varchar(120) null | StorageService 相对路径（yyyyMM/uuid.ext）；文件夹为 null              |
| audit_status              | tinyint default 0 | 0 未审核 / 1 通过 / 2 驳回 / 3 审核中（D13 预留）                      |
| is_public                 | tinyint default 0 | **三态**（P4a）：0=继承父目录 / 1=显式公开 / 2=显式阻断，见 §4.8/§14.2 |
| deleted_at                | datetime null     | 非空 = 在回收站（R2 只标记自身）                                       |
| create_time / update_time | datetime          |                                                                        |

索引：(user_id, parent_id, deleted_at)、(user_id, deleted_at)。

> 同名判定在 Service 层（同目录 name+is_dir 查重），**未加唯一索引**：软删 + 回收站期间会短暂出现同名记录（还原/重名场景），物理唯一键会冲突。

### cloud_share —— 公开链接（P3 新增）

| 字段        | 类型               | 说明                                                 |
| ----------- | ------------------ | ---------------------------------------------------- |
| id          | bigint PK          |                                                      |
| user_id     | bigint             | 创建者                                               |
| file_id     | bigint             | 逻辑关联 cloud_file（仅文件，is_dir=0）              |
| token       | varchar(32) unique | 随机 URL-safe 串（crypto.randomBytes）               |
| visit_count | int default 0      | 下载成功 +1                                          |
| expire_at   | datetime null      | null = 永久                                          |
| status      | tinyint default 1  | 1 有效 / 0 已停止（过期不置状态，靠 expire_at 判定） |
| create_time | datetime           |                                                      |

索引：`@@index([fileId])`、`@@index([userId])`。

> 注：`(user_id, status, expire_at)` 复合索引未建（本期管理列表量小，直接走 userId 查询即可；后续量大再补建）。

### cloud_usage —— 配额（P3 新增）

| 字段        | 类型             | 说明                                  |
| ----------- | ---------------- | ------------------------------------- |
| user_id     | bigint PK        | 懒创建（首次上传/查询配额时）         |
| quota       | bigint           | 字节，默认 CLOUD_DEFAULT_QUOTA（1GB） |
| used        | bigint default 0 | 字节（R3 记账规则）                   |
| update_time | datetime         |                                       |

### site_ 域六表（P4a 新增，DDL 详见 §14.2）

`site_site`（站点，每用户一行，user_id unique，slug unique，root_folder_id/media_folder_id 关联 cloud_file，status/comment_audit 开关，create_time/update_time）、`site_column`（栏目树 ≤3 级，索引 (site_id,parent_id)）、`site_tag`（unique(site_id,name)）、`site_article`（含 cover_path/word_count/view_count/status/published_at，索引 (site_id,status,published_at) 与 (site_id,column_id)，无 deleted_at——R7 物理删除）、`site_article_tag`（unique(article_id,tag_id)+双索引）、`site_comment`（audit_status/ip，索引 (article_id,audit_status) 与 (site_id,audit_status)）。
`cloud_file` 加列 `is_public tinyint default 0`（三态语义，见 §4.8 / §14.2）。全部 relationMode="prisma" 逻辑外键，域内仅 article→column/articleTags/comments 三条 Prisma relation，跨域一律逻辑外键。

### 索引约定

- 唯一键：sys_user.username、sys_role.code、sys_dict_type.type、两张关联表的联合唯一
- 查询索引：sys_login_log(username)、sys_operation_log(user_id)、sys_menu(parent_id)、sys_dept(parent_id)

### seed 初始数据

- 用户：`admin / Admin@123`（超管，roles 含 admin 时拥有全部权限，不可禁用/删除/改角色）
- 角色：超级管理员（admin）、普通角色（common，仅 dashboard 可见）
- 菜单树（含按钮权限标识，命名规范 `域:模块:操作`）：

```
首页工作台        /dashboard            dashboard/index          icon: Odometer
系统管理          /system               （目录）                 icon: Setting
├─ 用户管理       system/user           system/user/index        perms 查询
│  └─ 按钮：system:user:list / system:user:create / system:user:update /
│          system:user:delete / system:user:reset-password / system:user:assign-role
├─ 角色管理       system/role           system/role/index
│  └─ 按钮：system:role:list / create / update / delete / assign-menu
├─ 菜单管理       system/menu           system/menu/index
│  └─ 按钮：system:menu:list / create / update / delete
├─ 部门管理       system/dept           system/dept/index
│  └─ 按钮：system:dept:list / create / update / delete
├─ 字典管理       system/dict           system/dict/index
│  └─ 按钮：system:dict:list / create / update / delete
└─ 日志管理       system/log            （目录）
   ├─ 登录日志    system/log/login      system/log/login/index   system:log:login
   └─ 操作日志    system/log/operation  system/log/operation/index  system:log:operation
个人中心          /profile              profile/index            （hidden，不进菜单）
```

### seed 增补（P2a AI 模块）

- ai_provider 四行（DeepSeek / Kimi / 通义千问 / 智谱 GLM，baseUrl 按各家兼容端点预填，apiKey 空）
- 每家 1~2 个示例模型（status=0 停用，填 key 后管理员启用）
- ai_plan 两个示例：体验版（月 10,000 积分）、标准版（月 100,000 积分）
- AI 菜单树 + 权限标识（见 PRD-P2A 第 3 节），common 角色分配"AI 助手"目录三页

### seed 增补（P2b 工具调用）

- ai_model 表：将支持 Function Calling 的模型 `support_tool` 置 1（各家主流对话模型均支持，按厂商文档核实后勾选）

### seed 增补（P3 云盘模块）

- 云盘菜单树（见 §4.7 / §5 接口约定）：云盘管理目录（我的文件 / 公开链接 / 回收站三页及 cloud:* 按钮权限标识）
- 系统管理/用户管理下追加按钮"调整配额"（cloud:admin:quota）
- common 角色授予「云盘管理」整棵子树（不含 cloud:admin:quota，仅 admin 可调整）；超管 `*` 自动覆盖

### seed 增补（P4a 个人网站）

- 「个人网站」目录（/site，icon Monitor）+ 五页（站点设置/栏目/文章/标签/评论，site/xxx/index）+ 16 个 site:* 按钮权限标识；站点设置为菜单级 perms（site:site:manage）
- 云盘「我的文件」下追加按钮"设为公开"（cloud:file:public）
- common 角色授予「个人网站」整棵子树；cloud:file:public 由既有云盘子树 BFS 自动纳入；超管 `*` 自动覆盖

---

## 6. 域边界纪律与微服务演进

1. 表名域前缀：`sys_`（system）、`cloud_`、`site_`、`ai_`
2. 禁止跨域 JOIN、禁止跨域 import 对方模块内部文件；域间协作只能通过对方暴露的 Service
3. 演进路径：`apps/api` 单体 → 某域需要独立部署时，整个域文件夹平移为 `apps/xxx` 服务，`gateway/` 层平移为 `apps/gateway`，共享逻辑下沉 `packages/`
4. 第一期不建 apps/gateway，不做服务拆分

---

## 7. 前端设计规范（第一期）

- 桌面优先，最小适配宽度 1280px，**不做移动端适配**
- 布局尺寸：侧边栏展开 210px / 折叠 64px；顶栏 50px；TabsBar 40px；内容区 padding 16px，背景 `#f0f2f5`
- 主题色：Element Plus 默认 `#409EFF`，第一期不自定义主题色、**不做暗色模式**
- 正文字号 14px；表格操作列按钮统一用 `link` 类型
- 页面卡片：白底、圆角 6px、无阴影（或极浅阴影）
- 组件 class 名以 `v-` 开头，样式一律 scoped

---

## 8. 环境变量约定

`apps/api/.env`：

```
DATABASE_URL="mysql://root:root@localhost:3306/iplat"
REDIS_URL="redis://localhost:6379"
JWT_ACCESS_SECRET=（随机 64 位）
JWT_ACCESS_EXPIRES=2h
JWT_REFRESH_SECRET=（随机 64 位）
JWT_REFRESH_EXPIRES=7d
PORT=3000
UPLOAD_DIR=./uploads
CORS_ORIGINS=http://localhost:5173
```

`apps/web/.env.development`：`VITE_API_BASE_URL=/api`

P2a 增补：无新增环境变量（apiKey 存 ai_provider 表）。`.env` 增补可选项：`AI_CHAT_THROTTLE_LIMIT=20`（聊天限流，默认 20 次/分）。

P3 增补（upload 配置组，见 `apps/api/src/config/upload.config.ts`）：

- `UPLOAD_DIR`：物理根目录（默认 `./uploads`，临时区 `UPLOAD_DIR/tmp`）
- `CLOUD_MAX_FILE_SIZE`：单文件上限字节（默认 100MB）
- `CLOUD_DEFAULT_QUOTA`：默认配额字节（默认 1GB）
- `CLOUD_ALLOWED_PREVIEW_TYPES`：预览白名单（默认 `image/*,text/*,application/pdf`）
- `CLOUD_AUDIT_ENABLED`：内容审核开关（默认 `false`，预留）
- `CLOUD_PUBLIC_SHARE_RATE_LIMIT`：公开分享限流（待补）

P4a 增补（site 配置组，见 `apps/api/src/config/site.config.ts`，均有默认值）：

- `SITE_OPEN_STATIC_RATE_LIMIT`：开放静态限流（次/分/IP，默认 120）
- `SITE_OPEN_API_RATE_LIMIT`：开放数据限流（次/分/IP，默认 60）
- `SITE_COMMENT_RATE_LIMIT`：评论提交限流（次/分/IP，默认 10）

main.ts 增补：`app.set('trust proxy', true)`（R8 IP 口径）；CORS 函数式（/api/open 反射 `*` + 放行 Content-Type/Range，其余维持 CORS_ORIGINS 白名单）。

---

## 9. 公共资产表（优先复用，禁止重复造；新增后必须回写登记）

| 名称                                                        | 位置                                                 | 用途                                                                                                                                                                                                      | 状态                              |
| ----------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| request                                                     | web/src/utils/request.ts                             | Axios 封装（双 token 静默刷新）                                                                                                                                                                           | 已建（T7）                        |
| v-permission                                                | web/src/directives/permission.ts                     | 按钮权限指令                                                                                                                                                                                              | 已建（T7）                        |
| useTable                                                    | web/src/hooks/useTable.ts                            | 列表页通用逻辑（分页/查询/加载态）                                                                                                                                                                        | 已建（T9）                        |
| token                                                       | web/src/utils/token.ts                               | 双 token localStorage 读写                                                                                                                                                                                | 已建（T7）                        |
| tree                                                        | web/src/utils/tree.ts                                | 平铺列表组树（dept/menu 通用）                                                                                                                                                                            | 已建（T7）                        |
| validate                                                    | web/src/utils/validate.ts                            | 密码/手机号/邮箱校验规则                                                                                                                                                                                  | 已建（T7）                        |
| useUserStore 等四 store                                     | web/src/stores                                       | user/permission/tabs/settings                                                                                                                                                                             | 已建（T7）                        |
| useDict                                                     | web/src/hooks/useDict.ts                             | 字典取值与渲染（带缓存）                                                                                                                                                                                  | 已建（T9）                        |
| ProTable                                                    | web/src/components/ProTable                          | 搜索+表格+分页+操作列                                                                                                                                                                                     | 已建（T9）                        |
| FormDialog                                                  | web/src/components/FormDialog                        | 新增/编辑表单弹窗                                                                                                                                                                                         | 已建（T9）                        |
| IconSelect                                                  | web/src/components/IconSelect                        | 图标选择器                                                                                                                                                                                                | 待建（T9）                        |
| Upload                                                      | web/src/components/Upload                            | 文件上传                                                                                                                                                                                                  | 待建（T9）                        |
| JwtAuthGuard                                                | api/src/gateway/guards                               | 全局认证守卫                                                                                                                                                                                              | 已建（T2）                        |
| PermissionGuard                                             | api/src/gateway/guards                               | 全局权限守卫                                                                                                                                                                                              | 已建（T2）                        |
| TransformInterceptor                                        | api/src/gateway/interceptors                         | 统一响应 + bigint 转字符串                                                                                                                                                                                | 已建（T2）                        |
| OperationLogInterceptor                                     | api/src/gateway/interceptors                         | 操作日志异步落库（配 @OperationLog）                                                                                                                                                                      | 已建（T6）                        |
| GlobalExceptionFilter                                       | api/src/gateway/filters                              | 全局异常兜底                                                                                                                                                                                              | 已建（T2）                        |
| @Public / @RequirePermission / @CurrentUser / @OperationLog | api/src/gateway/decorators                           | 装饰器组                                                                                                                                                                                                  | 已建（T2）                        |
| PageQueryDto / PageResultDto                                | api/src/common/dto                                   | 分页基类                                                                                                                                                                                                  | 已建（T2）                        |
| BusinessException                                           | api/src/common/exceptions                            | 业务异常（code + message）                                                                                                                                                                                | 已建（T2）                        |
| ErrorCode                                                   | api/src/common/constants/error-code.ts               | 统一错误码常量                                                                                                                                                                                            | 已建（T2）                        |
| RedisKey                                                    | api/src/common/constants/redis-key.ts                | Redis Key 生成约定                                                                                                                                                                                        | 已建（T2）                        |
| parseDurationToSeconds                                      | api/src/common/utils/duration.ts                     | '2h'/'7d' 时长解析为秒                                                                                                                                                                                    | 已建（T10，自 auth.service 抽出） |
| 配置模块组                                                  | api/src/config                                       | database/redis/jwt/upload 配置 + validate.ts 启动环境变量校验                                                                                                                                             | 已建（T2）                        |
| PrismaService / RedisService                                | api/src/infra/prisma、api/src/infra/redis            | 基础设施服务（全局模块，懒连接；RedisService 含 scanDel 按前缀批量清理）                                                                                                                                  | 已建（T2）                        |
| StorageService                                              | api/src/infra/storage                                | 文件存储抽象（moveToStorage/remove/removeTmp/createReadStream/stat/tmpDir，本地磁盘，预留 MinIO/OSS 切换；tmp 区 UPLOAD_DIR/tmp，正式区 yyyyMM/uuid.ext，路径穿越防御；静态 tmpDirPath() 供 multer 引擎） | 已建（T27/T30）                   |
| 通用 tmp StorageEngine                                      | api/src/infra/storage/tmp-storage.ts                 | Multer 临时区流式落盘引擎（公共资产）：写 UPLOAD_DIR/tmp/uuid.tmp、stat 回填 file.size、_removeFile 清半截、fail 兜底流错误/aborted；cloud/transfer 与 system/avatar 统一复用                             | 已建（T27 提至 infra，T30 复用）  |
| CloudFacade                                                 | api/src/modules/cloud/facade/cloud-facade.service.ts | 跨域门面（随 CloudModule 导出）：hasFiles(userId)（R10 删用户预检）+ saveAvatar(userId, meta)（头像登记/used 同步/旧头像软删回退）；system 域仅经此调用                                                   | 已建（T30）                       |
| FileExplorer / FilePreview / UploadButton                   | web/src/views/cloud                                  | 云盘前端公共组件（面包屑/双击/URL 同步/上传进度/预览弹层），复用 ProTable/useTable                                                                                                                        | 已建（T31/T32）                   |
| ProviderService                                             | api/src/modules/ai/engine                            | OpenAI 兼容适配器（流式调用 + usage 解析）                                                                                                                                                                | 已建（T12）                       |
| CreditService                                               | api/src/modules/ai/credit                            | 积分预检/结算/余额                                                                                                                                                                                        | 已建（T14）                       |
| @SkipTransform                                              | api/src/gateway/decorators                           | SSE 接口跳过统一响应                                                                                                                                                                                      | 已建（T14）                       |
| sse                                                         | web/src/views/ai/utils/sse.ts                        | 前端 SSE 客户端                                                                                                                                                                                           | 已建（T17）                       |
| MarkdownView                                                | web/src/components/MarkdownView                      | markdown-it 渲染封装（禁 raw HTML）；T39 由 ai 域提升为公共组件（site 文章编辑预览复用）                                                                                                                  | 已建（T17），已提升（T39）        |
| AiTool / ToolRegistry                                       | api/src/modules/ai/tool                              | 工具类型与注册表（新增工具 = tools/ 下加一个文件并注册）                                                                                                                                                  | 已建（T19）                       |
| PermissionService                                           | api/src/gateway/services                             | 权限判定共用服务（PermissionGuard 与工具层同源）                                                                                                                                                          | 已建（T19）                       |
| PLATFORM-GUIDE                                              | docs/PLATFORM-GUIDE.md                               | AI 平台手册，注入 system prompt；功能变更必须同步更新                                                                                                                                                     | 已建（T23）                       |
| SystemPromptService                                         | api/src/modules/ai/chat                              | system prompt 拼装（手册缓存 + 用户上下文 + 工具原则）                                                                                                                                                    | 已建（T23）                       |
| ToolConfirmCard                                             | web/src/views/ai/components                          | 确认卡片组件（参数摘要 + 确认/取消 + 过期态）                                                                                                                                                             | 已建（T24）                       |
| ToolResultTag                                               | web/src/views/ai/components                          | 工具结果折叠标签                                                                                                                                                                                          | 已建（T24）                       |
| SiteFacade                                                  | api/src/modules/site/facade                          | 跨域门面：hasSite（R13 删用户预检）+ P4b 站点语义校验层（getMySiteInfo / invalidateSitePaths / listFiles / readFile / writeFiles，§15.3）；SiteFacadeModule 独立注册随 SiteModule 导出                    | 已建（T33/T41）                   |
| CloudFacade 机械原语（P4b）                                 | api/src/modules/cloud/facade                         | listSubtreeRaw / readFileRaw / writeFileRaw（管理侧语义，mkdir -p 逐段复用，§15.3）                                                                                                                       | 已建（T41）                       |
| FileService.replaceFileContent                              | api/src/modules/cloud/file                           | 替换文件内容公共实现（配额差额校验 + 事务行更新 + used 记账 + 删旧物理；覆盖上传与在线编辑共用）                                                                                                          | 已建（T43）                       |
| FileEditorDialog                                            | web/src/views/cloud/components                       | CodeMirror 6 全屏在线编辑弹窗（语言包动态 import + Ctrl/Cmd+S + 脏检查）                                                                                                                                  | 已建（T43）                       |
| AiTool.summarize                                            | api/src/modules/ai/tool                              | write 工具确认卡结构化摘要钩子（缺省回退现状，既有工具零改动）                                                                                                                                            | 已建（T42）                       |
| 站点模板库                                                  | apps/api/assets/site-templates                       | 三套预置模板（default/portfolio/card，各四件套 + template.json）                                                                                                                                          | 已建（T44）                       |
| CloudFacade 扩展（P4a）                                     | api/src/modules/cloud/facade                         | resolvePublicPath（三态继承判定）/ getPublicStream（Range + 缓存失效 40400）/ createFolder（重名自动(1)）/ registerPublicFile（used upsert）/ discardSiteDraft（建站回滚）                                | 已建（T34/T36，三态随修订记录）   |
| SiteResolveService                                          | api/src/modules/site/open                            | slug/路径解析 + 正/负缓存（resolve 300s、path 60s）                                                                                                                                                       | 已建（T35）                       |
| StorageService.writeFromBuffer                              | api/src/infra/storage                                | 内存内容直写正式区（模板复制等应用内生成文件场景）                                                                                                                                                        | 已建（T36）                       |
| 站点默认模板                                                | apps/api/assets/site-template                        | 一键建站四件套（原生 JS + CDN markdown-it，textContent 防 XSS）                                                                                                                                           | 已建（T36）                       |
| rate-limit.util                                             | api/src/modules/site/open                            | 开放层限流工具（Redis 计数，static/api/comment 三桶共用）+ extractIp                                                                                                                                      | 已建（T38）                       |

### Redis Key 增补约定（写入 RedisKey 常量）

| Key                                  | 类型/TTL                                                 | 用途                                                                                         |
| ------------------------------------ | -------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `online:{userId}`                    | hash，30min 滑动                                         | 在线用户（username/nickname/ip/loginAt/lastActiveAt），JwtAuthGuard 校验通过时刷新，登出删除 |
| `ai:chatting:{userId}`               | string，TTL 300s（兜底防进程崩溃残留），流结束时主动删除 | 单用户并发流限制（存在即拒绝新流，20007）                                                    |
| `ai:confirm:{toolCallId}`            | string（JSON），TTL 600s                                 | write 工具确认单：{ userId, conversationId, toolName, params }，确认/取消/过期即失效         |
| `site:resolve:{slug}`                | string（JSON），TTL 300s                                 | slug → 站点信息；site 域写操作（改 slug/启停）主动 DEL                                       |
| `site:path:{siteId}:{path}`          | string，TTL 60s                                          | 路径 → fileId；"404" 为负缓存；cloud 侧变更靠 TTL 被动失效（R12）                            |
| `site:data:{siteId}:{...}`           | string（JSON），TTL 60s                                  | 开放数据热缓存；site 域内容变更 scanDel 前缀失效                                             |
| `site:view:{articleId}:{ip}`         | string，SET NX EX 300                                    | 查看数去重窗口（R8）                                                                         |
| `site:comment:rate:{articleId}:{ip}` | string，TTL 60s                                          | 同文章同 IP 评论间隔（R9，命中即 40111）                                                     |
| `site:rate:{bucket}:{ip}`            | counter，60s 窗口                                        | 开放层独立限流计数（bucket = static/api/comment）                                            |

---

## 10. SSE 接口特例约定（P2a 新增）

1. 统一响应格式的例外清单（除此之外一律 `{code,message,data}`）：
   - **SSE**：`POST /api/ai/chat` 与 `POST /api/ai/tool/confirm`（本节）
   - **cloud 域流式**：分享下载 / 预览 / 头像读取（§4.7）
   - **site 域开放层**：`/api/open/*` 静态与数据接口（§14.4，@Public + @SkipTransform）
     SSE 细则如下，仅限上述两个对话接口：
   - 前置校验失败 → 统一 JSON 错误响应（走 GlobalExceptionFilter）
   - 进入流式 → `@Res()` 原生写流，Controller 标记 `@SkipTransform()`（新增装饰器），TransformInterceptor 与 OperationLogInterceptor 识别后跳过
2. 前端 SSE 客户端 `views/ai/utils/sse.ts`：
   - 用 `fetch` + `response.body.getReader()` 手动解析 `data:` 行（EventSource 不支持自定义请求头，禁用）
   - 40100 时先调 refresh 再重试一次（复用 token.ts，与 request.ts 同策略）
   - 维护 AbortController 支持"停止生成"
3. 聊天接口限流 20 次/分/用户；同用户并发流式对话数 = 1

## 11. AI 域内部协作约定（P2a 新增）

1. **引擎层单向依赖**：chat → engine/provider.service → 上游；engine 不感知会话、积分
2. **CreditService 接口**：`precheck(userId)`（无套餐 20001 / 余额不足 20002）、`settle(messageId, usage)`（按 message_id 幂等，事务内写 usage_log + 扣 used_credits）
3. **上下文截取**：发送前按模型 max_context 从最新消息往回装，装不下的老消息丢弃；system prompt 固定放最前（P2a 的 system prompt：简洁的助手设定即可）。token 估算口径：不引入分词库，按字符数保守估算（1 token ≈ 1 字符，宁可多截不可超限）；usage 兜底估算同口径
4. **价格换算口径**：1 积分 = 内部计量单位，模型单价由运营按"厂商定价 × 加价率"换算后人工录入 ai_model 表，系统不做实时汇率
5. 所有 AI 域写操作（开通/切换/指派/踢人）挂 @OperationLog

## 12. 工具调用架构（P2b 新增）

### 12.1 AiTool 接口（tool.types.ts）

```ts
export interface AiTool {
  name: string // 蛇形命名，如 get_online_users
  description: string // 给模型看的中文功能描述（决定模型选对工具的关键）
  parameters: Record<string, any> // JSON Schema（OpenAI tools 参数格式）
  perms?: string // 绑定权限标识；缺省 = 登录即可
  risk: 'read' | 'write' // read 自动执行 / write 需用户确认
  handler: (ctx: { user: AuthUser }, params: any) => Promise<any> // 返回值会序列化回喂模型
  summarize?: (params: any, ctx: { user: AuthUser }) => any // write 工具确认卡结构化摘要（P4b §15.6）；缺省 = params 截断字符串
}
```

### 12.2 调用流程（chat.service 编排）

1. 引擎层扩展：ProviderService.streamChat 当前仅传 messages，本期扩展 `tools` 参数透传与上游 `tool_calls` 事件解析（EngineStreamEvent 新增事件类型）。模型 `support_tool=1` 且存在可用工具时携带 `tools`（**按当前用户权限过滤后的子集**，无权限工具不下发；**过滤后为空则不携带 tools 字段**，空数组会触发部分厂商 400）；工具 schema 本身占用上下文，与历史消息共用 max_context 预算（必要时下调历史截取比例）。注意：**tool_calls 在流式 delta 中分片下发**（function.arguments 逐段追加），引擎层需累积分片、聚合至 finish_reason=tool_calls 后再解析执行，禁止读到就解析
2. 上游返回 tool_calls → 逐个处理：
   - 执行前再次校验 perms（防缓存间隙），无权限 → 20015 结果回喂模型告知。权限判定逻辑不得复制：从 PermissionGuard 抽出共用的 PermissionService（gateway 层），守卫与工具层都调它
   - read：执行 handler → 结果作为 `role: "tool"` 消息追加 → 再次调用上游（**最多 3 轮**，超限截断并提示）
   - write：写 ai_tool_call（status=pending）+ Redis 确认单 → SSE 下发 `tool_confirm` 事件 → 本轮流结束（done 照常下发并结算本轮；该 assistant 消息 content 允许为空，仅承载卡片）
3. 确认链路：`POST /api/ai/tool/confirm` → 前置校验（套餐/积分预检 20001/20002、并发流锁与 /ai/chat 共用 ai:chatting 冲突 20007、确认单归属与有效期 20016、工具权限二次校验 20015）→ approved=true 执行 handler（status=executed/failed）→ 结果回喂上游 → **本接口同样以 SSE 流式返回**模型的后续自然语言总结（含 15s 心跳），**总结落库为新的 assistant 消息并独立结算**——避免与首轮共用 message_id 撞 ai_usage_log 的 unique 幂等键
4. 一次用户消息引发的所有上游调用，tokens 累加进同一条 assistant 消息，统一结算一次；**role=tool 的工具消息不持久化**（只在本轮调用链内存中传递），上下文重建仍只用 ai_message 的 user/assistant 消息，工具结果由 assistant 的最终自然语言回答承载
5. 工具参数校验：handler 入口按 parameters schema 校验（模型可能生成非法参数），失败结果回喂让模型自我修正（计入轮次）

### 12.3 域门面约定（域边界纪律的落地方式）

- ai 域工具需要 system 域能力时，**只允许注入 system 域模块 export 出来的 Service**（如 UserService、OnlineService、RoleService）
- ai 域工具操作个人网站时，**只注入 site 域门面 SiteFacade**（P4b 站点三件套，§15.2；ToolModule imports SiteModule）
- system 域各模块需在 module 的 `exports` 中显式声明可被外部使用的 Service；未导出 = 私有
- handler 禁止直接操作其他域的表、禁止绕过 Service 写旁路逻辑

### 12.4 system prompt 结构（chat.service 拼装，顺序固定）

```
1. 助手设定（固定文案：你是 iplat 平台内置 AI 助手，可使用提供的工具帮助用户操作系统……）
2. docs/PLATFORM-GUIDE.md 全文（启动时读入内存缓存，文件变更重启生效）
3. 当前用户上下文：昵称、角色名列表、当前日期（不注入权限标识明细，权限由工具过滤兜底）
4. 工具使用原则：read 类直接执行；write 类必须先经用户确认；不确定的操作路径引导用户查看菜单，禁止编造
```

---

## 13. API 列表风格约定（P3 增补 §13.14 并入）

1. **分页列表**：返回 `PageResultDto`（`{ list, total, pageNo, pageSize }`）
2. **非分页列表**（树平铺、字典、不分页关联数据）：返回**裸数组** `[...]`，前端直接接数组，禁止套 `{ list: [...] }` 壳
3. **附带数据才包对象**：列表之外还要携带聚合/附加字段时（如 `{ list, summary }`），才允许包对象
4. **时间列**：接口返回 ISO 8601 字符串，前端表格/详情展示**必须**经 `formatTime`（dayjs）格式化，禁止 prop 直出原始值
5. 前端取数类型必须与后端实际返回形态一致（裸数组就接 `T[]`，禁止按 `result.list` 取裸数组接口）

---

## 14. 个人网站（site 域）完整架构（P4a，自 ARCHITECTURE-P4A-增补.md 并入；增补文档保留为历史细节参考）

### 14.1 后端目录结构

```
api/src/modules/site/
├── site.module.ts            # 域模块：re-export SiteFacadeModule（对外契约）
├── facade/
│   ├── site-facade.service.ts # SiteFacade：hasSite（R13 删用户预检）+ P4b 站点语义校验层（§15.3）
│   └── site-facade.module.ts  # SiteFacade 独立模块（P4b T44：子模块同域直注，零循环）
├── manage/                   # 站点设置（GET/POST/PUT /api/site/mine）
├── template/                 # P4b 模板库（GET /api/site/templates、POST /api/site/mine/apply-template，§15.7）
├── column/                   # 栏目树（≤3 级）
├── tag/                      # 标签
├── article/                  # 文章（封面/字数/发布状态）
├── comment/                  # 评论（审核流）
└── open/                     # ★ 开放层：访客侧唯一出口，全部 @Public
    ├── open-api.controller.ts   # /api/open/:slug/api/*（数据接口，先注册，见 14.4 路由顺序）
    ├── open-static.controller.ts# /api/open/:slug 与 /api/open/:slug/{*path}（静态文件）
    ├── open.service.ts          # 数据接口编排 + 热数据缓存
    ├── site-resolve.service.ts  # slug→站点、路径→cloud_file 解析（缓存与负缓存）
    ├── rate-limit.util.ts       # 限流工具（static/api/comment 三桶）+ extractIp
    └── mime.ts                  # MIME 白名单 + CSP sandbox 常量

apps/api/assets/site-templates/ # 模板库（P4b T44 迁移自单数 site-template/；读取可用 fs，写入用户站点必须经 SiteFacade）
├── default/   # 默认博客（index.html / style.css / app.js / README.txt / template.json）
├── portfolio/ # 作品集（P4b 新增）
└── card/      # 名片站（P4b 新增）
```

纪律：site 域**禁止** import cloud/system/ai 内部实现；开放层只允许读 + 评论提交；物理文件读写只经 StorageService（站点内容写入经 SiteFacade → CloudFacade 机械原语，§15.3）。

### 14.2 数据表（6 张 site_ + cloud_file 加列；relationMode="prisma" 逻辑外键）

**site_site —— 站点（每用户一站）**：`id` / `user_id`（unique，逻辑关联 sys_user）/ `slug`（unique varchar32，R11）/ `title` varchar50 / `description` varchar200 null / `root_folder_id`（逻辑关联 cloud_file）/ `media_folder_id` / `status` tinyint（1 启用 0 停用，R10）/ `comment_audit` tinyint / `create_time` `update_time`。

**site_column —— 栏目树**：`id` / `site_id` / `parent_id`（0=根，≤3 级 R6）/ `name` varchar32 / `sort` / `created_at` `updated_at`；索引 `(site_id,parent_id)`；同级同名不去重。

**site_tag**：`id` / `site_id` / `name` / `created_at`；`unique(site_id,name)`，索引 `(site_id)`。

**site_article —— 文章**：`id` / `site_id` / `column_id` / `title` varchar100 / `summary` varchar200（留空自动取正文纯文本前 100 字）/ `cover_path` varchar255 null（必须 media/ 前缀）/ `content_md` longtext / `word_count`（R14）/ `view_count`（R8）/ `status`（0 草稿 1 发布）/ `published_at` null（首次发布写，下架再上架不刷新）/ `created_at` `updated_at`（无 deleted_at，R7 物理删除）；索引 `(site_id,status,published_at)`、`(site_id,column_id)`。

**site_article_tag**：`id` / `article_id` / `tag_id`；`unique(article_id,tag_id)` + 双索引。

**site_comment —— 评论**：`id` / `site_id` / `article_id` / `nickname` varchar32 / `content` varchar500 / `audit_status`（0 待审 1 通过 2 驳回）/ `ip` varchar50 / `created_at`；索引 `(article_id,audit_status)`、`(site_id,audit_status)`。

**cloud_file 变更**：`is_public tinyint default 0` **三态**：0=继承父目录（新建默认）/ 1=显式公开（站点根恒为 1）/ 2=显式阻断。公开性上溯判定见 14.4。域内 Prisma relation 仅 article→column / articleTags / comments 三条，跨域一律逻辑外键。

### 14.3 站点创建流程（manage.service）

1. 校验 slug（R11 正则 + 保留字黑名单 + 全局唯一 40102/40103）；校验当前用户无站点（40101）
2. 经 CloudFacade 建目录「我的站点」（重名自动"(1)"）`is_public=1`（继承锚点）→ media/ 子目录
3. 模板复制：读 assets 四文件 → StorageService.writeFromBuffer → CloudFacade.registerPublicFile（used 记账 upsert，兼容懒创建）
4. 落 site_site 行
5. 任一步失败回滚：`discardSiteDraft`（软删行 + 删物理文件 + used 回退）+ 不建站点行

改 slug：更新后 `DEL site:resolve:{旧slug}` + scanDel `site:data:*`（coverUrl 内嵌 slug）。停用/启用：DEL resolve。任何编辑均失效 resolve 缓存。

### 14.4 公开访问链路（开放层核心）

**路由顺序铁律**：controllers 数组 `OpenApiController`（`:slug/api/*` 具体路由）必须先于 `OpenStaticController`（`:slug` 与 `:slug/{*path}`，Express 5 通配得 string[]）；静态层首段 `api` 双保险 40400。

```
GET /api/open/{slug}/[path]
 1. 独立限流（static 桶 120 次/分/IP，site 配置组；rate-limit.util）
 2. slug 解析：site:resolve:{slug}（TTL 300s）；不存在/停用 → 40400
 3. 路径规范化：拒绝空段/反斜杠/./..（R3 防穿越）；首段 api 双保险 40400
 4. 目录语义（R4）：根/尾斜杠请求 → 目录 index.html；无斜杠目录请求（含根）→ 301 补斜杠（Location 带 /api/open/{slug} 前缀，修正相对引用基址）；目录存在但无 index.html → 40400（nginx 无 autoindex 语义，防 301 自循环）
 5. 路径解析：site:path:{siteId}:{path}（TTL 60s，fileId 或 "404" 负缓存）
    经 CloudFacade.resolvePublicPath：下行逐段（深度≤10 防环）→ 上溯三态判定（R2 修订）；
    目录不算文件命中（不写负缓存）；getPublicStream 对失效 fileId 抛 40400（禁 500）
 6. ETag（W/"size-mtime"）/304；Cache-Control：全部白名单统一 no-cache（D28/P4b 修订——AI/编辑器高频迭代要求"改完立即可见"，max-age 会导致 js/css 最长 1 小时旧版；未变资源仅 304 头部零字节体），白名单外 no-store
 7. 输出：getPublicStream 管道；MIME 表 + nosniff + ACAO:* + CORP:cross-origin（main.ts 中间件对 /api/open 改写）；Range 206/416；res.setTimeout(30s)
 8. 全程禁挂 @OperationLog
```

**缓存失效**：site 域写操作主动失效（改 slug/启停 → DEL resolve + scanDel data；内容变更 → scanDel data）；cloud 域变更靠 `site:path` 60s TTL 被动失效（R12：最长 60 秒生效，文档明示）。

### 14.5 MIME 白名单与安全响应头

| 类别       | 扩展名                                           | Content-Type              | 附加头                          |
| ---------- | ------------------------------------------------ | ------------------------- | ------------------------------- |
| 可执行文档 | html / htm / svg / xml                           | 各自标准 mime             | **CSP sandbox**                 |
| 脚本       | js / mjs                                         | text/javascript           | —                               |
| 样式       | css                                              | text/css                  | —                               |
| 数据       | json                                             | application/json          | —                               |
| 纯文本     | txt / md / log / yml / yaml / csv                | text/plain; charset=utf-8 | —                               |
| 图片       | jpg / jpeg / png / gif / webp / ico / bmp / avif | 各自标准 mime             | —                               |
| 字体       | woff / woff2 / ttf / otf                         | font/*                    | —                               |
| 音视频     | mp4 / mp3 / webm / ogg / wav / m4a               | 各自标准 mime             | —                               |
| 文档       | pdf                                              | application/pdf           | —                               |
| 其他一切   | *                                                | application/octet-stream  | Content-Disposition: attachment |

CSP sandbox 固定值 `sandbox allow-scripts allow-forms allow-popups allow-downloads allow-modals`（opaque origin 读不到主域凭证；allow-modals 为访客页 alert/confirm 反馈所必需，缺失时弹窗被静默忽略；对 P3 R7 文本铁律的收窄豁免——仅限本开放链路、白名单类型、必配 sandbox+nosniff；后台预览链路 R7 不变）。CORS：/api/open 反射 `*` 并放行 Content-Type/Range（main.ts 函数式），其余路径白名单不变。CORP：/api/open 全部响应由 main.ts 中间件改写为 `Cross-Origin-Resource-Policy: cross-origin`（helmet 默认 same-origin）——sandbox 页面处于 opaque origin，其 css/js/img 等 no-cors 子资源一律按跨源校验，不改写会被浏览器拦截、站点停在"加载中"。

### 14.6 开放数据 API（契约详见 API.md §6.3）

统一 `/api/open/:slug/api/`；@Public；api 桶 60 次/分/IP（评论 10 次/分/IP + 同文章同 IP 60s 一条 → 40111）；资源类失败统一 40400 防探测（参数校验 40001、限流 42900、评论间隔 40111 为例外）；分页 pageSize ≤50；文章仅 status=1、评论仅 audit_status=1；热数据缓存 60s（详情缓存不含 view_count，返回前读库覆盖）；columns 后端组嵌套树（消费者是用户站点代码）；详情触发查看数（R8）。

### 14.7 域门面扩展

**CloudFacade**：`setPublic`（仅标自身，0→落库 2）/ `resolvePublicPath`（三态上溯）/ `getPublicStream`（可选 Range；失效 fileId → 40400）/ `createFolder`（重名自动"(1)"+R6+isPublic 锚点）/ `registerPublicFile`（used upsert 懒创建）/ `discardSiteDraft`（建站回滚）。
**SiteFacade**：`hasSite(userId)`（R13 预检，system remove 依次 hasFiles → hasSite）。

### 14.8 覆盖上传（R5）

`overwrite=1` 且同目录同名未删文件 → tmp→新正式区 → 更新行 → used 差额（`$executeRawUnsafe GREATEST(used+delta,0)`）→ 删旧物理文件；URL（file id）不变；命中文件夹或缺省维持自动"(1)"。

### 14.9 Redis Key（见 §9 Redis Key 增补约定表，site:* 六条）

### 14.10 seed 菜单树（P4a 增量，见 §5 seed 增补；common 授「个人网站」整棵子树）

### 14.11 错误码 40xxx 段

| code  | 含义                                                                | 处理                                     |
| ----- | ------------------------------------------------------------------- | ---------------------------------------- |
| 40101 | 站点不存在或未开通                                                  | 后台引导创建；开放层不出现（统一 40400） |
| 40102 | slug 已被占用                                                       | 提示更换                                 |
| 40103 | slug 格式非法或命中保留字                                           | 提示规则                                 |
| 40104 | 站点已停用                                                          | 后台提示（开放层统一 40400）             |
| 40105 | 站点根目录不可用 / 封面不在 media/                                  | 提示去云盘检查目录                       |
| 40106 | 栏目不存在                                                          | 刷新栏目列表                             |
| 40107 | 栏目下存在子栏目或文章 / 超 3 级，不可操作                          | 提示先清空                               |
| 40108 | 标签已存在                                                          | 提示更换名称                             |
| 40109 | 文章不存在                                                          | 刷新文章列表                             |
| 40110 | 评论不存在                                                          | 刷新评论列表                             |
| 40111 | 评论提交过于频繁                                                    | 提示稍后再试                             |
| 40112 | 用户已开通个人网站，禁止删除（R13 预检）                            | 提示先删除站点                           |
| 40113 | 站点文件路径非法（越出站点根 / 含 `..` / 绝对路径 / 空段，P4b R17） | AI 工具回喂，模型修正路径                |
| 40114 | 文件类型不允许（非文本白名单扩展名，P4b R17）                       | AI 工具回喂 / 编辑器按钮不显示           |
| 40115 | 内容超限（AI 写 >256KB / 单次 >10 个 / 读 >64KB，P4b R17）          | AI 工具回喂，模型拆分或精简              |
| 40116 | 模板不存在（P4b T44 apply-template）                                | 刷新模板列表                             |

> 注：标签不存在（tag PUT/DELETE、文章 tagIds 含不存在项）复用通用 40400，不设细分码（T37 偏差登记，T40 备案）。

### 14.12 环境变量与配置（见 §8 P4a 增补）

### 14.13 资产表（见 §9 公共资产表 P4a 行）

### 14.14 与 AI 域的关系（P4b 预留）

P4b"AI 编写站点文件"按既有 AiTool 框架加工具：write 类必走确认卡片、经 CloudFacade 写文件、消耗积分；禁止 ai 域 import site/cloud 内部 Service。

### 14.15 演进预留（本期不做，架构不堵路）

| 项                         | 触发条件           | 预留设计                                                   |
| -------------------------- | ------------------ | ---------------------------------------------------------- |
| `/s/{slug}` 短路径         | 部署侧有反向代理后 | 新增控制器映射同一 service                                 |
| 子域名 `{slug}.sites.域名` | 多用户真实部署     | slug 唯一 + 保留字已铺路；接入层按 Host 解析               |
| X-Accel-Redirect           | 公开流量显著增长   | 鉴权解析与字节输出分离（nginx sendfile）                   |
| CDN                        | 盗链/流量大        | 开放静态天然可缓存                                         |
| 开放层拆独立进程           | 可靠性隔离诉求     | /api/open 无鉴权无状态只读为主，模块化单体拆分第一个实践点 |

---

## 15. 个人网站二期（P4b）：AI 编写站点 + 在线编辑器 + 模板库（自 ARCHITECTURE-P4B-增补.md 并入；增补文档保留为历史细节参考）

> 前提：P4a 全部机制（三态 is_public / 开放层 / 缓存体系）不动；唯一新依赖 = 前端 CodeMirror 6（D20）。

### 15.1 后端/前端目录结构增量

```
api/src/modules/site/template/      # 模板库子模块
├── template.controller.ts # GET /api/site/templates、POST /api/site/mine/apply-template
├── template.service.ts    # 模板清单实时读 + 温和覆盖应用（写入经 SiteFacade.writeFiles）
└── template.module.ts     # imports SiteFacadeModule（同域直注；见下方"模块形态"说明）

api/src/modules/site/facade/
└── site-facade.module.ts  # SiteFacade 独立模块（T44：子模块无法注入父聚合 provider，
                           #  独立成模块后 template 同域直注零循环；SiteModule re-export 保持对外契约）

api/src/modules/ai/tool/tools/      # P4b 三个工具文件（P2b 框架原位扩展，tool.bootstrap 注册）
web/src/views/cloud/components/FileEditorDialog.vue  # CodeMirror 6 全屏编辑弹窗

apps/api/assets/site-templates/{default,portfolio,card}/  # 三套模板（四件套 + template.json）
```

### 15.2 AI 工具契约（三件套，handler 只注入 SiteFacade 一个门面）

| 工具               | risk  | perms            | parameters 要点                             | handler 返回                                                                                       |
| ------------------ | ----- | ---------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `list_site_files`  | read  | site:site:manage | `{}`（无参数）                              | `{ site: { slug, title, status }, files: [{ path, isDir, size, updatedAt }], truncated: boolean }` |
| `read_site_file`   | read  | site:site:manage | `{ path }`（必填）                          | `{ path, size, content }`（UTF-8）                                                                 |
| `write_site_files` | write | site:site:manage | `{ files: [{ path, content }] }`（1~10 个） | 逐文件明细 `[{ path, ok, action, size, error? }]`（部分成功语义）                                  |

description 纪律：操作的是当前用户自己的站点（根 = 云盘「我的站点」）；改写前先 read README.txt；README 缺失按 PLATFORM-GUIDE 摘要保守操作（兼容 P4a 旧站）；读取类并行一轮发出；只能写文本，图片引导用户上传 media/；>10 个分批（每批一张确认卡）。未开通站点回喂 `{ ok:false, errorCode:40101 }` 引导文案，不抛栈。

### 15.3 SiteFacade 站点语义校验层 + CloudFacade 机械原语

**SiteFacade 新增**（抛 site 段码 40101/40113~40115/40400）：

- `getMySiteInfo(userId)` → `{ id, slug, title, status, rootFolderId } | null`（null = 未开通，工具回喂引导）
- `invalidateSitePaths(siteId, paths)`：逐路径 DEL `site:path:{siteId}:{path}`（含 "404" 负缓存）
- `listFiles(userId)`：站点文件树（属主视角，经 `CloudFacade.listSubtreeRaw`）；null = 未开通
- `readFile(userId, path)`：路径规范（40113）→ 白名单（40114）→ ≤64KB（40115）→ 机械读（cloud 30001 → 统一 40400）
- `writeFiles(userId, files)`：批量 ≤10（40115）→ 逐文件校验（40113/40114/40115，失败记 per-file error 不中断）→ 机械写入（cloud 30001/30003/30006 捕获为该文件 error）→ 全部完成后仅对 ok 路径失效缓存（部分成功语义 R18）

常量（写死代码 §15.11）：`SITE_FILE_TEXT_EXTS`（html/htm/css/js/mjs/txt/md/json/svg/xml/yml/yaml/csv）、AI 写单文件 256KB、单次 10 个、读 64KB。

**CloudFacade 机械原语**（管理侧语义，只抛 cloud 段码 30001/30003/30006，禁止 site 段码）：

- `listSubtreeRaw(rootFolderId, { maxDepth=10, limit=500 })`：有界 BFS，不含回收站，超限 truncated=true
- `readFileRaw(rootFolderId, path)`：逐段下行 ≤10；读盘返回 Buffer（解码由调用方负责）
- `writeFileRaw(userId, rootFolderId, path, content)`：配额预检（30003）→ **中间目录 mkdir -p：逐段下行，已存在目录直接复用，不存在才 createFolder（严禁无脑逐段 createFolder——二次写入会造出 "pages (1)" 平行目录，站点路径即 URL 下致命）** → 中间段撞同名文件 / 末段撞同名目录 30001 → R6 子项上限（排除将软删旧文件）→ 同路径旧文件软删进回收站（used 不动可回滚）→ writeFromBuffer → registerPublicFile（used += size，is_public 默认 0=继承）→ 登记失败删新物理防孤儿

### 15.4 缓存失效口径（AI/模板写入路径）

`SiteFacade.writeFiles` 全部完成后对 ok 路径逐个 DEL `site:path`（含负缓存）——AI/模板写完访客立即可见。**编辑器保存（R19）无需失效**：fileId/URL 不变，缓存的 fileId 仍有效，开放层 ETag 随 size/mtime 变化自然失效（PRD F4 定论）。cloud 侧公开性变更（set-public）仍走 60s TTL 被动生效（§14.4 R12 不变）。

### 15.5 编辑器保存接口（cloud 域）

`PUT /api/cloud/file/:id/content`，`@RequirePermission('cloud:file:upload')` + `@OperationLog('云盘','在线编辑保存')`：

1. assertOwned（30001）→ isDir=1 拒绝（40001）
2. ext ∈ 文本白名单（与 §15.11 同集）→ 否则 30012；`Buffer.byteLength(content)` ≤1MB → 否则 30013
3. writeFromBuffer 写新物理 → `FileService.replaceFileContent`（公共方法，§9 资产表）→ 删旧物理
4. 更新行语义：fileId/URL 不变，**仅 storage_name/size/update_time 三列**（mime/ext/is_public 不动；开放层 MIME 输出按 ext 解析，与 DB mime 无关）
5. DTO `{ content }` @IsString + @MaxLength(1_048_576) 字符级粗拦，字节级 service 精算；**main.ts json body limit 须 ≥2MB**（默认 100KB 会在进 DTO 前 PayloadTooLarge）

### 15.6 确认卡结构化清单（AiTool.summarize 钩子）

```ts
summarize?: (params: any, ctx: { user: AuthUser }) => any
// （实现注：较初版草图 (params) => any 补充 ctx 入参——summarize 需按当前用户查数据）
```

- chat.service 写确认单时：工具有 summarize 则 `summary = await tool.summarize(params, ctx)`（返回 null/抛错回退 P2b 现状 params 截断字符串），既有 7 工具零改动；summary 进 Redis 确认单与 tool_confirm 事件；**ai_tool_call.params 仍存原始 params（content 全文）**，不加列——恢复链路（messages()）对 pending write 工具按 params 重算 summary
- write_site_files 的 summarize：复用 listFiles（只读）逐路径预判 action（树中同名 → overwritten 带旧大小 / 否则 created 带入参字节）；action 为预判，以执行结果为准
- ToolConfirmCard.vue：summary 为数组 → 渲染文件清单表格（路径 / 动作标签 created 绿 overwritten 橙 / 大小 formatSize）+「动作为预估，以执行结果为准」；字符串 → 维持现状

### 15.7 模板库

- 资产：`apps/api/assets/site-templates/{id}/`（四件套 + template.json `{ name, description, version, preview? }`；preview 本期恒 null）
- `GET /api/site/templates`（site:site:manage）：readdir → 逐目录读 template.json → `[{ id, name, description }]`；缺失/解析失败跳过并记运行日志；**实时读不缓存**
- `POST /api/site/mine/apply-template`（site:site:manage，@OperationLog）：未开通 40101（先于模板校验）→ templateId 由 DTO 正则 `^[A-Za-z0-9_-]{1,64}$` 挡穿越（40001）→ 目录不存在 40116 → 遍历模板文件（排除 template.json）→ 经 `SiteFacade.writeFiles` 温和覆盖（R20/D23：同名软删 + 新建，media/ 与模板外文件不动，失效由 writeFiles 内建）→ 返回逐文件清单
- 建站（manage.create）模板源读 `site-templates/default/`；discardSiteDraft 回滚不变；已建站用户不受迁移影响
- 模板纪律（R22）：README.txt 为字段级契约，三套主体逐字一致；开放 API 变更必须同步三套 README

### 15.8 README 契约与 PLATFORM-GUIDE 分工（D26/R22，见 §14.9）

### 15.9 错误码（40113~~40116 见 §14.11；30012~~30013 见 §4.7 表）

### 15.10 seed 变更

**零变更**：工具 perms 复用 site:site:manage（common 已授）；编辑器复用 cloud:file:upload；模板接口复用 site:site:manage。无新菜单、无新权限标识。

### 15.11 常量（写死代码 + 文档，不进配置组、不加环境变量）

| 常量                | 值                                                   | 位置                                       |
| ------------------- | ---------------------------------------------------- | ------------------------------------------ |
| SITE_FILE_TEXT_EXTS | html/htm/css/js/mjs/txt/md/json/svg/xml/yml/yaml/csv | SiteFacade（前端编辑器按钮另维护同集显示） |
| AI 写单文件上限     | 256KB                                                | write-site-files.tool.ts                   |
| AI 单次文件数上限   | 10                                                   | 同上                                       |
| AI 读文件上限       | 64KB（同时是模型上下文护栏）                         | read-site-file.tool.ts                     |
| 编辑器内容上限      | 1MB                                                  | cloud file service + 前端按钮显示条件      |
| json body limit     | 2mb                                                  | main.ts（编辑器 1MB + 转义余量）           |

### 15.12 资产表（并入 §9，见 SiteFacade/CloudFacade 机械原语/replaceFileContent/FileEditorDialog/AiTool.summarize/站点模板库行）

### 15.13 与 P4a 走查修复的关系

W1/W3~W10 文档补丁已并入（T41 开工前）；W2 代码修复（file.list 三态 int + 前端双标签，R23）已随 T43 生效。

### 15.14 演进预留（本期不做，架构不堵路）

| 项                | 触发条件             | 预留设计                                                            |
| ----------------- | -------------------- | ------------------------------------------------------------------- |
| AI 文章/栏目工具  | P4c 产品语义明确     | AiTool 框架原位加工具，perms 用 site:article:* 等既有标识           |
| 模板预览图        | 模板数量 >5          | template.json.preview 已预留；GET templates 原样透传                |
| 模板/功能分享市场 | 用户愿景落地期       | 模板即目录，导出=打包 assets 子目录，导入=解压 + template.json 校验 |
| 站点多版本历史    | 回滚诉求超回收站语义 | SiteFacade.writeFiles 已集中写入点，加版本快照表即可                |
| 用户自建表/接口   | 平台化愿景           | 开放层已证明"@Public + 独立限流 + 40400 防探测"模式可复制           |
