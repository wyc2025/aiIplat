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

**P6 新依赖白名单（仅此 1 个，已在 PRD-P6 D71 特批）**：`@codemirror/merge`（编辑器只读差异对比视图；按需 `await import()` 异步加载，不进首屏包，§21.4）。

### 1.2 后端（apps/api）

| 类别       | 选型                                           | 约束                                                                                |
| ---------- | ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| 框架       | NestJS 11 + TypeScript                         | 严格分层 Controller → Service → Prisma                                              |
| ORM        | Prisma 6                                       | model 用 PascalCase，数据库字段用 `@map` 映射 snake_case                            |
| 数据库     | MySQL 8（utf8mb4）                             | docker-compose 启动                                                                 |
| 缓存       | Redis 7（ioredis）                             | token 黑名单、登录失败计数、热点缓存                                                |
| 认证       | @nestjs/jwt + @nestjs/passport                 | access + refresh 双 token                                                           |
| 密码       | bcrypt（salt 10）                              | 任何接口不得返回 password 字段                                                      |
| 校验       | class-validator + class-transformer            | 所有入参走 DTO，禁止在 Controller 里裸取 body                                       |
| 接口文档   | @nestjs/swagger                                | 路径 `/api/docs`，带 JWT 调试按钮                                                   |
| 安全       | @nestjs/throttler、helmet、CORS 白名单         | 全局限流 300 次/分/IP；登录接口 10 次/分                                            |
| 文件       | Multer + 本地磁盘                              | 通过 StorageService 抽象访问，预留二期切换 MinIO/OSS                                |
| 日志       | Nest Logger（console，运行日志）+ 操作日志落库 | winston 依赖在库但零使用未接入；接入时 URL 字段统一过 `maskSensitiveQuery`（§18.6） |
| 配置       | @nestjs/config + .env 多环境                   | 配置项集中定义在 `src/config/`                                                      |
| 定时任务   | @nestjs/schedule                               | P2a 起启用（月度额度重置），新增 cron 统一放各域 `*.task.ts`                        |
| 大模型接入 | openai（官方 SDK）                             | 用 `baseURL` 指向各家 OpenAI 兼容端点，**禁止**为单一厂商引入其专属 SDK             |

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
   - `/share/*`（云盘访客分享页：`/share/:token` 内容页 + P4d 新增 `/share/:token/file`
     文件夹内子文件预览页；凭链接 token 访问，不要求登录态；guard.ts 以 `to.path.startsWith('/share/')` 放行）
   - /view/*（P4c 公开落地页：/view/f/:token、/view/d/:token、/view/d/:token/file，
     guard.ts 以 to.path.startsWith('/view/') 放行）
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
- **userinfo** `GET /api/auth/userinfo` → `{ user, roles, roleLabels, perms, menus }`（menus 为当前用户权限过滤后的菜单树；`roleLabels` 为角色**显示名**、与 `roles` 同源同序，供界面展示「超级管理员」而不是内部标识 `admin` —— 见 `AGENTS.md`「界面文案准则」）
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

| code  | 文案                                                   | 处理                       |
| ----- | ------------------------------------------------------ | -------------------------- |
| 30001 | 文件/文件夹不存在或无权访问                            | 刷新当前目录列表           |
| 30002 | 同目录下已存在同名项                                   | 提示更换名称               |
| 30003 | 存储配额不足                                           | 提示用量与配额，引导清理   |
| 30004 | 文件超出大小限制                                       | 提示上限值                 |
| 30005 | 该类型不支持预览                                       | 提示"请下载查看"           |
| 30006 | 超出目录限制（深度>10 / 单目录>500 项 / 名称>64 字符） | 提示具体限制               |
| 30007 | 回收站记录不存在                                       | 刷新回收站列表             |
| 30008 | 分享链接无效（不存在/已停止/已过期/文件已删/未过审）   | 访客页提示失效             |
| 30009 | 文件夹暂不支持创建分享链接                             | 提示                       |
| 30010 | 文件未通过内容审核，禁止分享                           | 提示（开关开启后生效）     |
| 30011 | 用户仍有云盘文件，禁止删除                             | 提示（R10 删用户预检）     |
| 30012 | 该文件类型不支持在线编辑（非文本白名单扩展名，P4b）    | 提示"请下载后编辑"         |
| 30013 | 内容超出在线编辑上限（1MB，P4b）                       | 提示"请下载后编辑"         |
| 30014 | 压缩包格式不支持或已损坏（P4c）                        | 提示"仅支持 zip 解压"      |
| 30015 | 解压超限（条目数 / 累计总大小 / 单条目，P4c）          | 提示超限具体原因           |
| 30016 | 压缩包含非法路径条目（Zip Slip 整包拒绝，P4c）         | 提示压缩包非法             |
| 30017 | 该分享需要提取码（未验证或凭证过期，P4d）              | 跳密码门禁页               |
| 30018 | 提取码错误（含连续 5 次锁 10 分钟，P4d）               | 门禁页提示剩余次数         |
| 30019 | 非法移动目标（自身子树 / 站点根 / 回收站，P4d）        | 提示                       |
| 30020 | 站点根目录禁止直接删除（须先删除站点，P4e R52）        | 提示先到站点列表删站       |
| 30021 | 文件被应用数据引用，禁止删除（P11 D96）                | 提示先删除应用中的引用数据 |

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
- **错误码**：site 域 40101~40119（表见 §14.11；**40117 为 P4c 开放层码，见 §16.2**；40118/40119 为 P4e 配额满 / 站点不存在或非属主）；开放层对外统一 40400 防探测

---

## 5. 数据库设计（sys_ 前缀为 P1 底座；P2a 新增 7 张 ai_ 表；P3 新增 3 张 cloud_ 表；P4a 新增 6 张 site_ 表；**P4e 新增 1 张 `site_quota` 表并解除 `site_site.user_id` 唯一索引**；**P11 新增 7 张 app\_ 表，见 §27.2**；**P12 增 4 列，见 §28.2**；**P13 新增 1 张 `market_listing` 表（`market_` 前缀），见 §29.2**；**P14 新增 2 张 `disp_display` / `disp_grant` 表（`disp_` 前缀）并收缩 `app_page.kind` 为仅 admin，见 §30.2**；**P15 新增 2 张 `acc_credential` / `acc_audit` 表（`acc_` 前缀），见 §31.2**）

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

| 字段                         | 类型              | 说明                                                                                                              |
| ---------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| id                           | bigint PK         |                                                                                                                   |
| conversation_id              | bigint            |                                                                                                                   |
| role                         | varchar(20)       | user / assistant（system 不持久化，由后端拼装）                                                                   |
| content                      | longtext          |                                                                                                                   |
| model_id                     | bigint            | assistant 消息记录所用模型，可空                                                                                  |
| tokens_input / tokens_output | int               | assistant 消息记录实际用量                                                                                        |
| credits                      | int               | 本条消息扣减积分（user 消息为 0）                                                                                 |
| status                       | tinyint           | 1 正常 2 失败（流中断/上游错误）                                                                                  |
| error_msg                    | varchar(500) NULL | P21 T174：上游失败详情（`[status=…]` 前缀，status=2 时记录；终端日志外可追溯 429/400 等）                         |
| attachments                  | json              | P10 附件元信息 `[{fileId,name,ext,size,chars,mode,path}]`（mode=inject\|listed）；**只存元信息不存内容**（§26.1） |
| created_at / deleted_at      | datetime          |                                                                                                                   |

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

| 字段                      | 类型              | 说明                                                                         |
| ------------------------- | ----------------- | ---------------------------------------------------------------------------- |
| id                        | bigint PK         |                                                                              |
| user_id                   | bigint            | 属主（逻辑关联 sys_user，禁 JOIN）                                           |
| parent_id                 | bigint            | 0 = 根目录                                                                   |
| name                      | varchar(64)       | 文件/文件夹名（不含路径）                                                    |
| is_dir                    | tinyint           | 1 文件夹 / 0 文件                                                            |
| size                      | bigint default 0  | 字节；文件夹恒 0                                                             |
| mime                      | varchar(100) null |                                                                              |
| ext                       | varchar(20) null  | 小写不带点，预览白名单判断用                                                 |
| storage_name              | varchar(120) null | StorageService 相对路径（yyyyMM/uuid.ext）；文件夹为 null                    |
| audit_status              | tinyint default 0 | 0 未审核 / 1 通过 / 2 驳回 / 3 审核中（D13 预留）                            |
| is_public                 | tinyint default 0 | **三态**（P4a）：0=继承父目录 / 1=显式公开 / 2=显式阻断，见 §4.8/§14.2       |
| public_token              | varchar(32) null  | 公开链接 token（P4c，unique；仅显式公开行有值，取消公开置空=轮换），见 §16.1 |
| allow_listing             | tinyint default 1 | 公开文件夹允许访客浏览列表（P4c D32，仅文件夹有意义），见 §16.1              |
| deleted_at                | datetime null     | 非空 = 在回收站（R2 只标记自身）                                             |
| create_time / update_time | datetime          |                                                                              |

索引：(user_id, parent_id, deleted_at)、(user_id, deleted_at)。

> 同名判定在 Service 层（同目录 name+is_dir 查重），**未加唯一索引**：软删 + 回收站期间会短暂出现同名记录（还原/重名场景），物理唯一键会冲突。

### cloud_share —— 公开链接（P3 新增）

| 字段         | 类型               | 说明                                                                                          |
| ------------ | ------------------ | --------------------------------------------------------------------------------------------- |
| id           | bigint PK          |                                                                                               |
| user_id      | bigint             | 创建者                                                                                        |
| file_id      | bigint             | 逻辑关联 cloud_file（仅文件，is_dir=0）                                                       |
| token        | varchar(32) unique | 随机 URL-safe 串（crypto.randomBytes）                                                        |
| visit_count  | int default 0      | 下载成功 +1                                                                                   |
| expire_at    | datetime null      | null = 永久                                                                                   |
| status       | tinyint default 1  | 1 有效 / 0 已停止（过期不置状态，靠 expire_at 判定）                                          |
| create_time  | datetime           |                                                                                               |
| password_enc | varchar(255) null  | 提取码密文（AES-256-GCM，仅供创建者回显；与 P4d 的 `password_hash` 同源，详见 §17.1 / §23.2） |

索引：`@@index([fileId])`、`@@index([userId])`。

> 注：`(user_id, status, expire_at)` 复合索引未建（本期管理列表量小，直接走 userId 查询即可；后续量大再补建）。

### cloud_usage —— 配额（P3 新增）

| 字段        | 类型             | 说明                                  |
| ----------- | ---------------- | ------------------------------------- |
| user_id     | bigint PK        | 懒创建（首次上传/查询配额时）         |
| quota       | bigint           | 字节，默认 CLOUD_DEFAULT_QUOTA（1GB） |
| used        | bigint default 0 | 字节（R3 记账规则）                   |
| update_time | datetime         |                                       |

### site_ 域表（P4a 六表 + P4e 配额表，DDL 详见 §14.2 / §18.1）

`site_site`（站点，**P4e 起每用户多行**，slug unique，root_folder_id/media_folder_id 关联 cloud_file，status/comment_audit 开关，create_time/update_time；`user_id` 唯一索引已于 P4e 解除 → 普通索引 `idx_site_user(user_id)`）、`site_column`（栏目树 ≤3 级，索引 (site_id,parent_id)）、`site_tag`（unique(site_id,name)）、`site_article`（含 cover_path/word_count/view_count/status/published_at，索引 (site_id,status,published_at) 与 (site_id,column_id)，无 deleted_at——R7 物理删除）、`site_article_tag`（unique(article_id,tag_id)+双索引）、`site_comment`（audit_status/ip，**P6 增 reply_content/reply_at 一级作者回复**，索引 (article_id,audit_status) 与 (site_id,audit_status)）、**`site_quota`（P4e 新增，user_id PK + quota int，站点数上限，懒创建，照 `cloud_usage` 先例）**。
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

1. 表名域前缀：`sys_`（system）、`cloud_`、`site_`、`ai_`、`app_`、`market_`
2. 禁止跨域 JOIN、禁止跨域 import 对方模块内部文件；**域间协作只许经对方域的「门面」（`apps/api/src/modules/<域>/facade/`，如 CloudFacade / SiteFacade / AppFacade / MarketFacade）**；
   `gateway/`（`apps/api/src/gateway/`）**只放横切关注点**（认证/鉴权/统一响应/异常过滤/操作日志），不放业务门面（P11 走查 W1 修订，2026-09-26 用户拍板）
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
- `CLOUD_PUBLIC_SHARE_RATE_LIMIT`：分享（`cloud_share`）限流——**未实现，保留占位**：P3 原规划 30 次/分/IP 实际以 `@Throttle` 静态装饰器落地（`share-public.controller.ts`），未走配置组；P4c 公开端点（`/api/pub`）限流另见 §16.2（硬编码 120/60，与该占位无关，勿混淆）

P4c 增补（upload 配置组续）：

- `CLOUD_UNZIP_MAX_ENTRIES`：在线解压单包条目数上限（默认 5000）
- `CLOUD_UNZIP_MAX_TOTAL_SIZE`：在线解压单包累计总大小上限字节（默认 500MB）；单条目大小复用 `CLOUD_MAX_FILE_SIZE`

P4F 增补（upload 配置组续，T67，见 §19.1）：

- `CLOUD_RECYCLE_RETENTION_DAYS`：回收站保留天数（默认 30）；`deleted_at` 早于 now−N 天的行由每日 03:30 的 cron 物理清除
- `CLOUD_RECYCLE_CLEAN_ENABLED`：回收站自动清理总开关（默认开；仅显式 `false`/`0` 关闭，关闭时空跑只记一条日志）

P4a 增补（site 配置组，见 `apps/api/src/config/site.config.ts`，均有默认值）：

- `SITE_OPEN_STATIC_RATE_LIMIT`：开放静态限流（次/分/IP，默认 120）
- `SITE_OPEN_API_RATE_LIMIT`：开放数据限流（次/分/IP，默认 60）
- `SITE_COMMENT_RATE_LIMIT`：评论提交限流（次/分/IP，默认 10）

P6 增补（ai 配置组，见 `apps/api/src/config/ai.config.ts`，D68）：`DEBUG_AI`（工具路由明细日志开关，显式 `1`/`true` 才开，默认关；开启后 debug 级输出命中关键字明细，§21.1）。

P5 增补（ai 配置组，见 `apps/api/src/config/ai.config.ts`，D65）：

- `AI_MAX_TOOL_ROUNDS`：单轮用户消息的工具调用轮次上限（默认 3，**上限 10** 防失控；越界/非法一律回退默认值）。此前为 chat.service 硬编码常量 `MAX_TOOL_ROUNDS`，P5 起改为配置组读取（每次现读，改配置无需重启）

main.ts 增补：`app.set('trust proxy', true)`（R8 IP 口径）；CORS 函数式（/api/open 反射 `*` + 放行 Content-Type/Range，其余维持 CORS_ORIGINS 白名单）。

P11 增补（app 配置组，见 `apps/api/src/config/app.config.ts`，§27.8）：`APP_MAX_APPS_PER_USER=10` / `APP_MAX_DRAFTS_PER_USER=3` /
`APP_MAX_TABLES_PER_APP=20` / `APP_MAX_ROWS_PER_TABLE=50000` / `APP_MAX_PAGES_PER_APP=50` / `APP_MAX_ATTACHMENT_SIZE=10MB` /
`APP_MAX_IMPORT_SIZE=5MB` / `APP_HOT_INDEX_FIELDS=5` / `APP_QUERY_TIMEOUT_MS=2000` / `APP_DRAFT_TTL_DAYS=7`（均可不配）。

---

## 9. 公共资产表（优先复用，禁止重复造；新增后必须回写登记）

| 名称                                                        | 位置                                                 | 用途                                                                                                                                                                                                                                      | 状态                              |
| ----------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| request                                                     | web/src/utils/request.ts                             | Axios 封装（双 token 静默刷新）                                                                                                                                                                                                           | 已建（T7）                        |
| v-permission                                                | web/src/directives/permission.ts                     | 按钮权限指令                                                                                                                                                                                                                              | 已建（T7）                        |
| useTable                                                    | web/src/hooks/useTable.ts                            | 列表页通用逻辑（分页/查询/加载态）                                                                                                                                                                                                        | 已建（T9）                        |
| token                                                       | web/src/utils/token.ts                               | 双 token localStorage 读写                                                                                                                                                                                                                | 已建（T7）                        |
| tree                                                        | web/src/utils/tree.ts                                | 平铺列表组树（dept/menu 通用）                                                                                                                                                                                                            | 已建（T7）                        |
| validate                                                    | web/src/utils/validate.ts                            | 密码/手机号/邮箱校验规则                                                                                                                                                                                                                  | 已建（T7）                        |
| useUserStore 等四 store                                     | web/src/stores                                       | user/permission/tabs/settings                                                                                                                                                                                                             | 已建（T7）                        |
| useDict                                                     | web/src/hooks/useDict.ts                             | 字典取值与渲染（带缓存）                                                                                                                                                                                                                  | 已建（T9）                        |
| ProTable                                                    | web/src/components/ProTable                          | 搜索+表格+分页+操作列                                                                                                                                                                                                                     | 已建（T9）                        |
| FormDialog                                                  | web/src/components/FormDialog                        | 新增/编辑表单弹窗                                                                                                                                                                                                                         | 已建（T9）                        |
| IconSelect                                                  | web/src/components/IconSelect                        | 图标选择器                                                                                                                                                                                                                                | 待建（T9）                        |
| Upload                                                      | web/src/components/Upload                            | 文件上传                                                                                                                                                                                                                                  | 待建（T9）                        |
| JwtAuthGuard                                                | api/src/gateway/guards                               | 全局认证守卫                                                                                                                                                                                                                              | 已建（T2）                        |
| PermissionGuard                                             | api/src/gateway/guards                               | 全局权限守卫                                                                                                                                                                                                                              | 已建（T2）                        |
| TransformInterceptor                                        | api/src/gateway/interceptors                         | 统一响应 + bigint 转字符串                                                                                                                                                                                                                | 已建（T2）                        |
| OperationLogInterceptor                                     | api/src/gateway/interceptors                         | 操作日志异步落库（配 @OperationLog）                                                                                                                                                                                                      | 已建（T6）                        |
| GlobalExceptionFilter                                       | api/src/gateway/filters                              | 全局异常兜底                                                                                                                                                                                                                              | 已建（T2）                        |
| @Public / @RequirePermission / @CurrentUser / @OperationLog | api/src/gateway/decorators                           | 装饰器组                                                                                                                                                                                                                                  | 已建（T2）                        |
| PageQueryDto / PageResultDto                                | api/src/common/dto                                   | 分页基类                                                                                                                                                                                                                                  | 已建（T2）                        |
| BusinessException                                           | api/src/common/exceptions                            | 业务异常（code + message）                                                                                                                                                                                                                | 已建（T2）                        |
| ErrorCode                                                   | api/src/common/constants/error-code.ts               | 统一错误码常量                                                                                                                                                                                                                            | 已建（T2）                        |
| RedisKey                                                    | api/src/common/constants/redis-key.ts                | Redis Key 生成约定                                                                                                                                                                                                                        | 已建（T2）                        |
| parseDurationToSeconds                                      | api/src/common/utils/duration.ts                     | '2h'/'7d' 时长解析为秒                                                                                                                                                                                                                    | 已建（T10，自 auth.service 抽出） |
| 配置模块组                                                  | api/src/config                                       | database/redis/jwt/upload 配置 + validate.ts 启动环境变量校验                                                                                                                                                                             | 已建（T2）                        |
| PrismaService / RedisService                                | api/src/infra/prisma、api/src/infra/redis            | 基础设施服务（全局模块，懒连接；RedisService 含 scanDel 按前缀批量清理）                                                                                                                                                                  | 已建（T2）                        |
| StorageService                                              | api/src/infra/storage                                | 文件存储抽象（moveToStorage/remove/removeTmp/createReadStream/stat/tmpDir，本地磁盘，预留 MinIO/OSS 切换；tmp 区 UPLOAD_DIR/tmp，正式区 yyyyMM/uuid.ext，路径穿越防御；静态 tmpDirPath() 供 multer 引擎）                                 | 已建（T27/T30）                   |
| 通用 tmp StorageEngine                                      | api/src/infra/storage/tmp-storage.ts                 | Multer 临时区流式落盘引擎（公共资产）：写 UPLOAD_DIR/tmp/uuid.tmp、stat 回填 file.size、_removeFile 清半截、fail 兜底流错误/aborted；cloud/transfer 与 system/avatar 统一复用                                                             | 已建（T27 提至 infra，T30 复用）  |
| CloudFacade                                                 | api/src/modules/cloud/facade/cloud-facade.service.ts | 跨域门面（随 CloudModule 导出）：hasFiles(userId)（R10 删用户预检）+ saveAvatar(userId, meta)（头像登记/used 同步/旧头像软删回退）；system 域仅经此调用                                                                                   | 已建（T30）                       |
| FileExplorer / FilePreview / UploadButton                   | web/src/views/cloud                                  | 云盘前端公共组件（面包屑/双击/URL 同步/上传进度/预览弹层），复用 ProTable/useTable                                                                                                                                                        | 已建（T31/T32）                   |
| ProviderService                                             | api/src/modules/ai/engine                            | OpenAI 兼容适配器（流式调用 + usage 解析）                                                                                                                                                                                                | 已建（T12）                       |
| CreditService                                               | api/src/modules/ai/credit                            | 积分预检/结算/余额                                                                                                                                                                                                                        | 已建（T14）                       |
| @SkipTransform                                              | api/src/gateway/decorators                           | SSE 接口跳过统一响应                                                                                                                                                                                                                      | 已建（T14）                       |
| sse                                                         | web/src/views/ai/utils/sse.ts                        | 前端 SSE 客户端                                                                                                                                                                                                                           | 已建（T17）                       |
| MarkdownView                                                | web/src/components/MarkdownView                      | markdown-it 渲染封装（禁 raw HTML）；T39 由 ai 域提升为公共组件（site 文章编辑预览复用）                                                                                                                                                  | 已建（T17），已提升（T39）        |
| AiTool / ToolRegistry                                       | api/src/modules/ai/tool                              | 工具类型与注册表（新增工具 = tools/ 下加一个文件并注册）                                                                                                                                                                                  | 已建（T19）                       |
| PermissionService                                           | api/src/gateway/services                             | 权限判定共用服务（PermissionGuard 与工具层同源）                                                                                                                                                                                          | 已建（T19）                       |
| PLATFORM-GUIDE                                              | docs/PLATFORM-GUIDE.md                               | AI 平台手册**通用版**（system prompt 第一段，静态注入 ≤1000 字）；功能变更必须同步更新；能力细节自 P6 起移入 `capability.manifest.ts`（§21.1）                                                                                            | 已建（T23），P6 改两段式          |
| SystemPromptService                                         | api/src/modules/ai/chat                              | system prompt 拼装（助手设定 + 通用版手册缓存 + **按权限动态能力清单** + 用户上下文；P6 §21.1）                                                                                                                                           | 已建（T23）                       |
| ToolConfirmCard                                             | web/src/views/ai/components                          | 确认卡片组件（参数摘要 + 确认/取消 + 过期态）                                                                                                                                                                                             | 已建（T24）                       |
| ToolResultTag                                               | web/src/views/ai/components                          | 工具结果折叠标签                                                                                                                                                                                                                          | 已建（T24）                       |
| SiteFacade                                                  | api/src/modules/site/facade                          | 跨域门面：hasSite（R13 删用户预检）+ P4b 站点语义校验层（getMySiteInfo / invalidateSitePaths / listFiles / readFile / writeFiles，§15.3）；SiteFacadeModule 独立注册随 SiteModule 导出                                                    | 已建（T33/T41）                   |
| CloudFacade 机械原语（P4b）                                 | api/src/modules/cloud/facade                         | listSubtreeRaw / readFileRaw / writeFileRaw（管理侧语义，mkdir -p 逐段复用，§15.3）                                                                                                                                                       | 已建（T41）                       |
| FileService.replaceFileContent                              | api/src/modules/cloud/file                           | 替换文件内容公共实现（配额差额校验 + 事务行更新 + used 记账 + 删旧物理；覆盖上传与在线编辑共用）                                                                                                                                          | 已建（T43）                       |
| FileEditorDialog                                            | web/src/views/cloud/components                       | CodeMirror 6 全屏在线编辑弹窗（语言包动态 import + Ctrl/Cmd+S + 脏检查）                                                                                                                                                                  | 已建（T43）                       |
| AiTool.summarize                                            | api/src/modules/ai/tool                              | write 工具确认卡结构化摘要钩子（缺省回退现状，既有工具零改动）                                                                                                                                                                            | 已建（T42）                       |
| 站点模板库                                                  | apps/api/assets/site-templates                       | 三套预置模板（default/portfolio/card，各四件套 + template.json）                                                                                                                                                                          | 已建（T44）                       |
| CloudFacade 扩展（P4a）                                     | api/src/modules/cloud/facade                         | resolvePublicPath（三态继承判定）/ getPublicStream（Range + 缓存失效 40400）/ createFolder（重名自动(1)）/ registerPublicFile（used upsert）/ discardSiteDraft（建站回滚）                                                                | 已建（T34/T36，三态随修订记录）   |
| SiteResolveService                                          | api/src/modules/site/open                            | slug/路径解析 + 正/负缓存（resolve 300s、path 60s）                                                                                                                                                                                       | 已建（T35）                       |
| StorageService.writeFromBuffer                              | api/src/infra/storage                                | 内存内容直写正式区（模板复制等应用内生成文件场景）                                                                                                                                                                                        | 已建（T36）                       |
| 站点默认模板                                                | （已迁移至 site-templates/default，T44）             | 见「站点模板库」行                                                                                                                                                                                                                        | 已迁移                            |
| rate-limit.util                                             | api/src/modules/site/open                            | 开放层限流工具（Redis 计数，static/api/comment 三桶共用）+ extractIp                                                                                                                                                                      | 已建（T38）                       |
| 公开访问判定链（P4c）                                       | api/src/modules/cloud/public                         | token 校验 + R25 祖先阻断上溯 + path 逐段下行（modules/cloud/public/pub.service.ts；含 pub-mime.ts R26 MIME 白名单、独立限流桶 static/data；**未复用 P4a resolvePublicPath——R25「任一祖先阻断」与 P4a「首个非继承节点定生死」语义不同**） | 已建（T46）                       |
| CloudFacadeModule                                           | api/src/modules/cloud/facade/cloud-facade.module.ts  | CloudFacade 独立注册模块（照 T44 SiteFacadeModule 先例，cloud 域内子模块同域直注；CloudModule 仍 re-export，对外契约不变）                                                                                                                | 已建（T46）                       |
| UploadQueue / useUploadQueue                                | web/src/views/cloud/file                             | 批量上传队列（P4c：并发 3 worker 池、单失败不阻塞、字节加权总进度、beforeunload 拦截；后端零改动 D34）                                                                                                                                    | 已建（T48）                       |
| FileView / FolderView                                       | web/src/views/cloud/public-view                      | 公开落地页（类型分支）/ 公开文件夹列表页（下钻），/view/* 免登录路由                                                                                                                                                                      | 已建（T47）                       |
| UnzipService                                                | api/src/modules/cloud/transfer                       | 在线解压（P4c R29 安全四件套：Zip Slip / 双上限+配额 / GBK / 不递归；tmp 中转事务 D36）                                                                                                                                                   | 已建（T49）                       |
| StorageService tmp 能力扩展                                 | api/src/infra/storage                                | copyToTmp（正式区→tmp 复制）+ createTmpWriteStream（tmp 写入流），与 moveToStorage/removeTmp 组成完整 tmp 链路                                                                                                                            | 已建（T49）                       |
| 依赖白名单（P4c）                                           | apps/api/package.json                                | yauzl（流式解压）+ iconv-lite（GBK 条目名解码），D37 特批；yauzl 类型走本地窄声明 src/types/yauzl.d.ts                                                                                                                                    | 已建（T49）                       |

| usePublicSource | web/src/views/cloud/public-view | pub/share 双寻址数据源适配层（P4d D46）；FileView/FolderView 接收可选 source prop 复用同一渲染组件 | 已建（T56） |
| PackService / PackModule | api/src/modules/cloud/transfer | yazl 流式打包（管理侧 pack-download + 分享侧整包双调用；零落盘 D45/R41） | 已建（T54） |
| 分享密码门（verify + sid + 防爆破） | api/src/modules/cloud/share | 提取码 bcrypt 校验、短期凭证签发、IP+token 错误计数锁定（P4d D47/R42） | 已建（T55） |
| useMoveClipboard | web/src/views/cloud/file | 剪切/粘贴/拖拽移动状态（模块级单例，会话内存态） | 已建（T53） |
| SiteRootService / SiteRootModule | api/src/modules/site/facade | 站点根锚点查询（getRootFolderId / isSiteRoot）；零跨域依赖，供 cloud 域 import 不成环（P4d §17.6） | 已建（T52） |
| StorageService.resolvePath | api/src/infra/storage | storage_name → 正式区绝对路径（yazl 惰性读盘用；穿越校验与内部读写同源） | 已建（T54） |
| 依赖白名单（P4d） | apps/api/package.json | yazl@^3.3.1（流式打包），D45 特批；类型走本地窄声明 src/types/yazl.d.ts | 已建（T54） |
| SiteQuotaService | api/src/modules/site/quota | 站点数配额（getQuota 懒创建 / checkCanCreate 建站链首单点 / adminUpdate 下限=站点数，P4E §18.2） | 已建（T60） |
| CloudFacade.removeSiteRoot | api/src/modules/cloud/facade | 删站内部通道：站点根连同子树软删进回收站（used 不动，绕过 R52 用户面 30020） | 已建（T60） |
| SiteFacade（P4E 扩展） | api/src/modules/site/facade | getSites / resolveSite(userId, slug?)（R56）/ createSite（R57 委托 manage）/ getQuota；原 listFiles/readFile/writeFiles/getSiteInfo 全部带 siteId | 已建（T60/T62） |
| resolveSiteForTool | api/src/modules/ai/tool/tools/list-site-files.tool.ts | AI 工具站点解析统一入口（0 站 40101 / 1 站直通 / 多站 needSitePick / 查无 40119+站点列表） | 已建（T62） |
| useSiteStore | web/src/stores/site.ts | 当前站点全局状态（站点列表 + 配额 + localStorage 持久化 + 失效回退链） | 已建（T63） |
| SiteSwitcher | web/src/components/SiteSwitcher | 站点切换器（仅多站显示，单站用户无感；切换即改 store，页面 watch 重载） | 已建（T63） |
| maskSensitiveQuery | api/src/common/utils/url-mask.util.ts | 日志 URL 查询参数脱敏（sid/password → \*\*\*，零依赖；异常/未命中原样返回） | 已建（T64） |
| fetchAvatarBlob + useUserStore.avatarUrl | web/src/api/cloud/file.ts、web/src/stores/user.ts | 头像展示链（Blob → objectURL）：头像端点为登录态流式接口，`<img>` 直连带不了 Authorization 必然 401，故由 user store 统一取图（幂等 + 竞态丢弃 + revoke 回收），组件只消费 `avatarUrl`（空则回退昵称首字母）。**接 MinIO/OSS 改预签名 URL 时只需替换本实现** | 已建（P3 遗留 18 收口，2026-09-13） |
| saveBlob | web/src/utils/download.ts | **全仓 Blob 下载唯一口径**（P4F T69）：createObjectURL → a.click → 延时 10s revokeObjectURL（紧接 revoke 在部分浏览器会取消下载）。单文件下载 / 打包下载 / 访客整包下载统一复用，禁止再写第二份 createObjectURL + a.click 实现 | 已建（T69，收敛自 cloud/file/index.vue 与 public-view/FolderView.vue 两处私有实现） |
| RecycleCleanTask + RecycleService.cleanExpired | api/src/modules/cloud/recycle | 回收站超期自动清理（P4F T67/D58/R58/R59）：cron 每日 03:30，分批 ≤500 行、以「超期行中的最顶层项」为执行单元（子树去重）、单行失败续扫、幂等可重入；复用既有彻底删除链，头像旧行只删行/物理文件不二次回退 used | 已建（T67） |
| 配额对账两端点（GET/PUT usage-reconcile） | api/src/modules/cloud/admin | 诊断（R60 三段 groupBy 聚合 + 公式差额，userId 缺省 = 全用户）/ 修正（R61 used = 公式重算值，@OperationLog('云盘','配额对账修正')）；前端入口 = 用户管理「调整云盘配额」弹窗内嵌对账行 + diff≠0 才出现的修正按钮（D59） | 已建（T68） |
| 全局中文语言包 | web/src/App.vue | ElConfigProvider + `element-plus/es/locale/lang/zh-cn` 在最外层注入：组件走 unplugin 按需自动引入，没有 `app.use(ElementPlus,{locale})` 这一步，函数式弹窗（ElMessageBox/ElMessage）读全局配置后按钮即中文（P4F T69 根因级修复） | 已建（T69） |
| SiteFacade CMS 层扩展（P5） | api/src/modules/site/facade | listArticles / readArticle / createArticle / updateArticle / publishArticle / ensureColumn / ensureTags / listColumns / listTags（全部收 siteId，slug 解析在工具层经 resolveSiteForTool，§20.1）；SiteFacadeModule 增 imports 文章/栏目/标签三模块（同域直注） | 已建（T71） |
| SiteFacade 生命周期扩展（P5） | api/src/modules/site/facade | updateSite（委托 manage.update）/ getSiteDeleteImpact（R66 计数预检）/ deleteSite（委托 manage.remove） | 已建（T71） |
| SiteArticleService.getOwnedSiteId | api/src/modules/site/article | 文章 → 所属站点 id（复用同一属主链：40109/40119），供门面 CMS 写路径定位站点作用域 | 已建（T71） |
| CloudFacade 云盘根基点原语（P5） | api/src/modules/cloud/facade | listUserFiles / readUserFile / writeUserFile / moveUserFiles / deleteUserFiles / isUserDirPublic（基点 = 用户云盘根 parent_id=0，路径防穿越 + 文本白名单 + **2MB**（P10 T97 由 64KB 放宽）/256KB 上限 + 批量上限 20，§20.1）；CloudFacadeModule 增 imports SiteRootModule（inSite 标注） | 已建（T71，P10 读上限放宽） |
| AI 云盘五件套 | api/src/modules/ai/tool/tools | list_cloud_files / read_cloud_file / write_cloud_file / move_cloud_files / delete_cloud_files（handler 只注入 CloudFacade，§20.2） | 已建（T72） |
| AI 站点 CMS 七件套 | api/src/modules/ai/tool/tools | list/read/create/update/publish_site_article + ensure_site_column / ensure_site_tags（D63 代发语义：默认草稿、明示才发布、不提供删除文章） | 已建（T73） |
| AI 站点生命周期两件套 | api/src/modules/ai/tool/tools | update_site / delete_site（R66 确认卡三段影响 + 文章数统计） | 已建（T74） |
| tool-params.ts | api/src/modules/ai/tool/tools | 工具入参整形三件套 readStrParam / readStrArrayParam / readNumParam（云盘/CMS/生命周期 14 个工具共用；模型参数不可信，统一整形后再透传门面） | 已建（T72） |
| ai 配置组 + 预算动态化 | api/src/config/ai.config.ts、api/src/modules/ai/chat/chat.service.ts | `ai.maxToolRounds`（env `AI_MAX_TOOL_ROUNDS`，默认 3 上限 10）替代硬编码；历史截取预算 = maxContext − 输出预留 25% − system 实测 − tools schema 实测 − 当前消息，低于 2000 字符保底并告警；每轮 debug 日志记实算值（§20.3/R67） | 已建（T75） |
| R14 字数口径转出 | api/src/modules/site/facade/site-facade.service.ts | `export { countWordsR14 }`（口径单一来源仍在 article.service.ts）：AI 工具确认卡需在**执行前**展示字数，经门面模块转出而非跨域直插站点域内部文件（铁律 6） | 已建（T73） |
| prompt.sections.ts | api/src/modules/ai/chat | system prompt 分段拼装纯函数（助手设定文案 + composeSystemPrompt + textLength；零 Nest 依赖，供核查脚本直接 import，§21.1） | 已建（T77） |
| capability.manifest.ts | api/src/modules/ai/chat | **能力清单常量表**（17 行：能力名 + 注入权限 + 一行文案 + 覆盖工具；`pickCapabilityRows` 按权限过滤 / `renderCapabilityList` 渲染）；与工具注册表三方同源，机械核查 | 已建（T77） |
| tool.groups.ts | api/src/modules/ai/tool | **工具分组与确定性路由**（TOOL_GROUPS 7 组 43 工具 / KEYWORD_TO_GROUPS 词根 / resolveToolGroups / checkToolGroupCoverage 孤儿与陈旧校验；P21 T176 起豁免口径 = ALWAYS_GROUPS 恒下发 + app/siteLifecycle 创建意图触发，见 §37.4） | 已建（T77，P9 T92 补两工具） |
| check-ai-prompt（`pnpm check:ai`） | apps/api/scripts/check-ai-prompt.ts | 手册分段三阈值 + 工具归组全覆盖 + 能力清单同源 + 路由样例机械核查（失败退出码 1；`pnpm --filter @iplat/api check:ai`） | 已建（T77） |
| smoke-ai-tools（`pnpm smoke:ai`） | apps/api/scripts/smoke-ai-tools.ts | **AI 工具链路冒烟**（真实对话 → `ai_tool_call` / `ai_message` 落库断言：F 排版 / I 导入 / J 附件 inject / K 附件 listed 自读；退出码 0 全过 / 1 失败 / 2 前置不满足；单用例重试 3 次 + 3s 间隔；附件夹具见 §26.9-7）；「何时必跑」清单见 PROGRESS「AI 冒烟清单」 | 已建（T95，P10 T99 扩两用例） |
| SiteFacade 评论层扩展（P6） | api/src/modules/site/facade | listComments / auditComments（≤20 逐条独立成败）/ replyComment / getCommentBrief（全部收 siteId；SiteFacadeModule 增 imports SiteCommentModule） | 已建（T78） |
| SiteFacade.resolveCoverPath（P6） | api/src/modules/site/facade | 封面判定对象（R72：media/ 前缀 + 真实图片行 + 可公开访问 + 扩展名白名单；失败附 media/ 可用图片前 10 条） | 已建（T79） |
| AI 评论三件套 | api/src/modules/ai/tool/tools | list_site_comments / audit_site_comments / reply_site_comment（D69 代审 + 代回；跨站评论 40119） | 已建（T78） |
| confirmDialog | web/src/utils/confirm.ts | **确认弹窗全仓唯一入口**（内置 try/catch，取消/关闭静默返回 false）；全仓 30 处 ElMessageBox.confirm 调用点已统一（§21.5） | 已建（T81） |
| @codemirror/merge 只读对比 | web/src/views/cloud/components/FileEditorDialog.vue | 「对比改动」= 打开时快照 ↔ 当前编辑内容 只读双栏（highlightChanges + gutter，不做合并编辑）；包按需 `await import()`（独立异步 chunk，§21.4） | 已建（T80），依赖白名单（D71 特批） |
| 模板预览图资产 | web/public/templates/{default,portfolio,card}/preview.png + api/assets/site-templates/*/template.json#preview | 三套模板预览图（Vite 构建直出 `/templates/{id}/preview.png`）；API 列表按 template.json#preview 返回 previewUrl（缺图 null → 卡片占位） | 已建（T80） |
| AppLogo | web/src/components/AppLogo | 平台图标（内联 SVG，与 `public/favicon.svg` 同几何，`size` prop）；侧边栏与登录页唯一品牌图标来源，禁止各页自绘 | 已建（W2） |
| secret-box.util | api/src/common/utils/secret-box.util.ts | 短口令可逆密钥箱（AES-256-GCM：encryptSecret / decryptSecret / deriveKey，iv12+tag16 布局，异常一律返回 null）；当前用于分享提取码回显，密钥由调用方从配置派生（§23.2） | 已建（W5） |
| file-ticket | api/src/modules/cloud/transfer/file-ticket.ts | 私有文件直链票据（HMAC-SHA256 无状态签名：createFileTicket / verifyFileTicket / FILE_TICKET_TTL_MS=2h；恒定时间比较；§23.4） | 已建（W7） |
| downloadByUrl | web/src/utils/download.ts | 直链下载（URL 自带票据/公开 token 时交给浏览器原生下载：零内存驻留 + 断点续传；与 saveBlob 的分工见 §23.4） | 已建（W7） |
| FilePicker | web/src/components/FilePicker | 云盘文件选择器（单层下钻 + 扩展名白名单过滤，只产出 `{id,name,ext,size}`，不读内容；文章导入与 AI 对话附件共用） | 已建（T88，P10 T98 复用） |
| DiffView | web/src/components/DiffView | 只读双栏 diff 弹窗（@codemirror/merge 动态 import、随弹窗挂载/销毁；用于"改了再确认"场景，如一键排版预览） | 已建（T89） |
| attachment-resolver.ts | api/src/modules/ai/chat | **AI 对话附件解析链**（P10 T96）：白名单/上限常量 + `resolveAttachments`（经 CloudFacade 读字节，二进制嗅探 + 编码探测）+ `planAttachmentModes`（inject/listed 分流与注入组装）+ `renderAttachmentManifest`（会话可读清单）+ `parseStoredAttachments`（JSON 列安全读取）；纯函数零 Nest 依赖 | 已建（T96） |
| CloudFacade 附件门面（P10） | api/src/modules/cloud/facade | `pathOfUserFile(userId, fileId)`（fileId → 相对云盘根路径，有界上溯 ≤10）+ `filterAliveFileIds(userId, ids)`（批量有效性判定，不读盘）；供 ai 域附件元信息与失效降级使用 | 已建（T96） |
| attachment.ts | web/src/views/ai/utils/attachment.ts | 前端附件常量与预校验（白名单 / 2MB / ≤5 个 / 留档目录名 / `isAllowedAttachment`）；与后端 `attachment-resolver.ts` 同源副本（体验级预校验，真正校验链在后端） | 已建（T98） |
| AppFacade | api/src/modules/app/facade | app 域完整门面（createAppDraft / addTable / addFields / setRelation / genAdminPage / adjustPage / confirmDataApp / getAppMenuSegments）；ai 域工具与 auth 域菜单动态段唯一入口 | 已建（T100~T105） |
| AppRefService | api/src/modules/app/facade/app-ref.service.ts | app 域反向引用最小门面（`getAttachmentRefs` / `hasAttachmentRefs` / `hasAnyAttachmentRef`，只查 app_attachment_ref + app_def）；供 cloud 域删除预检（30021）注入，零跨域 import 防环 | 已建（T100/T103） |
| DataService | api/src/modules/app/data/data.service.ts | **沙箱数据唯一入口**（字段校验 / r_cN 索引列 / n:n 中间表差量写 / 附件引用维护 / 查询白名单 + 内存兜底护栏 / create/update/remove 可传事务客户端） | 已建（T103） |
| csv.ts | api/src/modules/app/import/csv.ts | 自研 CSV 解析/序列化（引号/换行/转义/BOM/GBK 探测；零新依赖，R92） | 已建（T103） |
| app-clean.core.ts | api/src/modules/app/admin | 应用生命周期清理纯函数核心（softDeleteApp / cleanExpiredDraftsCore / purgeDeletedAppsCore）；AdminService（cron）与手动脚本 `clean:app` 共用 | 已建（T101） |
| AdminRenderer | web/src/components/app-renderer | 功能页渲染引擎（filterBar/table/form/detail 四型区块 + 数据源与动作接线 + ref 候选/展开）；配套 `FieldInput.vue` 按字段类型出控件 | 已建（T106） |
| app 前端同源常量 | web/src/views/app/utils/schema.ts | 字段类型七类中文名 / 区块字段 DSL 解析（parseFieldSpec）/ 单元格展示（displayCell）/ 页面模板（pageSchemaTemplate）；与后端 `schema.constants.ts`、`page.builder.ts` 同源副本 | 已建（T106） |
| AppFacade（P13 扩展） | api/src/modules/app/facade/app-facade.service.ts | 市场协同四件套 + 复制物化：`exportStructure`（结构导出）/ `readDemoRows`（演示数据读取，attachment 置 null）/ `setPublic`（未过 R103 回喂缺项而非抛错）/ `setExposure`（table·field·page 三档解析）/ `materializeListing`（拓扑建表 → 关系 → 页面 → 演示数据逐行独立事务 + 引用重映射 + 失败整体回滚；§29.3） | 已建（T118/T120） |
| AdminService.createMaterialized / appCodesByIds | api/src/modules/app/admin/admin.service.ts | 复制建应用（active + source_app_id + 配额 50002）与 id→code 批量回填（市场「我的提交」用）；均为 P13 新增只读/写方法 | 已建（T118/T121） |
| DataService.snapshotRows / createRowStandalone | api/src/modules/app/data/data.service.ts | 快照导出读取（多值 ref 回填 + attachment 置 null + 超限标记 truncated）与单行独立事务写入（复制演示数据用） | 已建（T118） |
| MarketFacade | api/src/modules/market/facade | market 域门面（`submitMarketApp`）；ai 域工具唯一入口，market 域零跨域 import（§29.1） | 已建（T120） |
| snapshot-marshal.core.ts | api/src/modules/market/snapshot | 市场快照/演示数据**手写结构校验与序列化**（入库·出库双向；非法 50015，不静默修补）；纯函数零 Nest 依赖 | 已建（T118） |
| market 前端资产 | web/src/api/market、web/src/views/market | 市场 API 客户端 + 应用市场页（卡片流/详情抽屉/复制）+ 市场审核页（待审/在架双标签、拒绝必填理由） | 已建（T121） |
| AccessFacade.writeAudit | api/src/modules/access/facade | access 域门面：匿名层取数审计投递（site 域开放层的唯一跨域消费点；铁律 3/R141） | 已建（T136） |
| quota.service / quota.interceptor | api/src/modules/access/quota | 按 principal 的对外配额（请求数分·日双窗 + 返回行数日窗）：429 + `Retry-After` + `X-RateLimit-*` 响应头；行数为响应后记账 | 已建（T136） |
| audit.service / audit.interceptor | api/src/modules/access/audit | 接入审计：内存缓冲（5s 或满 100 条）批量落 `acc_audit`、成功与负例统一埋点、90 天分批清理与属主隔离检索 | 已建（T136） |
| ext-contract.service | api/src/modules/access/ext | 对外契约冻结层：envelope / 游标编解码（含 `Date→ISO` 规范化）/ keyset 分页 / scope 投影；内部响应形状不漂移到 v1（D124） | 已建（T135） |
| ext-path.util | api/src/modules/access/ext | 请求路径 → 端点名（守卫 401 留痕与审计拦截器**共用一处实现**，R141） | 已建（T136） |
| access 前端资产 | web/src/api/access、web/src/views/access | 接入凭证 API 客户端 + 凭证管理页（列表 / 新建 / **密钥一次性展示与复制** / 轮换 / 吊销 / scope 编辑 / 审计抽屉） | 已建（T137） |
| reloadMenus | web/src/router/dynamic.ts | **重取菜单树 + 重建动态路由**（新建/入册应用、增删功能页后调用；`registerDynamicRoutes` 幂等且会移除「已消失」的旧路由）；返回菜单是否变化 | 已建（P15 修复） |

### Redis Key 增补约定（写入 RedisKey 常量）

| Key                                   | 类型/TTL                                                 | 用途                                                                                                         |
| ------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `online:{userId}`                     | hash，30min 滑动                                         | 在线用户（username/nickname/ip/loginAt/lastActiveAt），JwtAuthGuard 校验通过时刷新，登出删除                 |
| `ai:chatting:{userId}`                | string，TTL 300s（兜底防进程崩溃残留），流结束时主动删除 | 单用户并发流限制（存在即拒绝新流，20007）                                                                    |
| `ai:confirm:{toolCallId}`             | string（JSON），TTL 600s                                 | write 工具确认单：{ userId, conversationId, toolName, params }，确认/取消/过期即失效                         |
| `app:schema:{appId}`                  | string（JSON），TTL 600s                                 | 应用 schema 全量打包缓存（def+tables+fields+rels+pages）；结构/页面/应用变更即 DEL（R99）                    |
| `app:import:{taskId}`                 | string（JSON），TTL 3600s                                | CSV 导入进度 { status,total,done,errors }（含 userId 归属校验）                                              |
| `site:resolve:{slug}`                 | string（JSON），TTL 300s                                 | slug → 站点信息；site 域写操作（改 slug/启停）主动 DEL                                                       |
| `site:path:{siteId}:{path}`           | string，TTL 60s                                          | 路径 → fileId；"404" 为负缓存；cloud 侧变更靠 TTL 被动失效（R12）                                            |
| `site:data:{siteId}:{...}`            | string（JSON），TTL 60s                                  | 开放数据热缓存；site 域内容变更 scanDel 前缀失效                                                             |
| `site:view:{articleId}:{ip}`          | string，SET NX EX 300                                    | 查看数去重窗口（R8）                                                                                         |
| `site:comment:rate:{articleId}:{ip}`  | string，TTL 60s                                          | 同文章同 IP 评论间隔（R9，命中即 40111）                                                                     |
| `site:rate:{bucket}:{ip}`             | counter，60s 窗口                                        | 开放层独立限流计数（bucket = static/api/comment）                                                            |
| `pub:rate:{bucket}:{ip}`              | counter，60s 窗口                                        | 云盘公开端点独立限流计数（P4c R32：bucket = static→raw/download 120次/分、data→info/list 60次/分），见 §16.2 |
| `share:pass:{token}:{sid}`            | string，TTL = min(2h, 分享剩余有效期)                    | 分享提取码通过后的短期访问凭证（P4d R42）；改密码/移除密码时按前缀 scanDel 失效                              |
| `share:passfail:{ip}:{token}`         | counter，10 分钟窗口                                     | 分享提取码错误计数（P4d R42：连续 5 次锁 10 分钟，照登录 10102 口径）                                        |
| `acc:quota:req:{id}:m:{yyyyMMddHHmm}` | counter，TTL 120s                                        | 对外凭证请求数·分钟窗（P15 R134；INCR + 首写设 TTL，过期即重置）                                             |
| `acc:quota:req:{id}:d:{yyyyMMdd}`     | counter，TTL 48h                                         | 对外凭证请求数·日窗（P15 R134）                                                                              |
| `acc:quota:rows:{id}:d:{yyyyMMdd}`    | counter，TTL 48h                                         | 对外凭证**返回行数**·日窗（P15 R134，响应后 INCRBY 记账；schema 端点计 0 行）                                |

> P4e 无新增 Key：删站在既有三族基础上扩展删除时机（`DEL site:resolve:{slug}` + `scanDel site:path|data:{siteId}:*`，R55）；`site:path` / `site:data` 按 siteId 隔离，多站天然不串。

---

## 10. SSE 接口特例约定（P2a 新增）

1. 统一响应格式的例外清单（除此之外一律 `{code,message,data}`）：
   - **SSE**：`POST /api/ai/chat` 与 `POST /api/ai/tool/confirm`（本节）
   - **cloud 域流式**：分享下载 / 预览 / 头像读取（§4.7）
   - **site 域开放层**：`/api/open/*` 静态与数据接口（§14.4，@Public + @SkipTransform）
   - **cloud 域公开端点**：`/api/pub/*` 的 raw/download 流式输出（§16.2，@Public + @SkipTransform）
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

1. 引擎层扩展：ProviderService.streamChat 当前仅传 messages，本期扩展 `tools` 参数透传与上游 `tool_calls` 事件解析（EngineStreamEvent 新增事件类型）。模型 `support_tool=1` 且存在可用工具时携带 `tools`（**按当前用户权限过滤后的子集**，无权限工具不下发；**过滤后为空则不携带 tools 字段**，空数组会触发部分厂商 400）；工具 schema 本身占用上下文，与历史消息共用 max_context 预算（**P5 起改为实测扣减，见 §20.3**）。**P6 起下发链为两道串联：权限过滤 → 组路由（`tool.groups.ts`，无命中全量兜底，见 §21.1）**。注意：**tool_calls 在流式 delta 中分片下发**（function.arguments 逐段追加），引擎层需累积分片、聚合至 finish_reason=tool_calls 后再解析执行，禁止读到就解析
2. 上游返回 tool_calls → 逐个处理：
   - 执行前再次校验 perms（防缓存间隙），无权限 → 20015 结果回喂模型告知。权限判定逻辑不得复制：从 PermissionGuard 抽出共用的 PermissionService（gateway 层），守卫与工具层都调它
   - read：执行 handler → 结果作为 `role: "tool"` 消息追加 → 再次调用上游（**轮次上限取 `ai.maxToolRounds`，P5 起配置化、默认 3、上限 10**，超限截断并提示）
   - write：写 ai_tool_call（status=pending）+ Redis 确认单 → SSE 下发 `tool_confirm` 事件 → 本轮流结束（done 照常下发并结算本轮；该 assistant 消息 content 允许为空，仅承载卡片）
3. 确认链路：`POST /api/ai/tool/confirm` → 前置校验（套餐/积分预检 20001/20002、并发流锁与 /ai/chat 共用 ai:chatting 冲突 20007、确认单归属与有效期 20016、工具权限二次校验 20015）→ approved=true 执行 handler（status=executed/failed）→ 结果回喂上游 → **本接口同样以 SSE 流式返回**模型的后续自然语言总结（含 15s 心跳），**总结落库为新的 assistant 消息并独立结算**——避免与首轮共用 message_id 撞 ai_usage_log 的 unique 幂等键。**P21 T175 增补**：确认单额外携带同批 read 结果（`priorToolCalls`，单条 2 万 / 合计 5 万字符上限）与 write 之后被暂停的调用名（`skippedToolCalls`）；确认链路重建上下文时，原 assistant 消息带**整批** tool_calls（同批 read + 本次 write）+ 同序 tool 消息，暂停调用以系统提示回喂告知模型——修复「read 在前、write 在后」的混合调用中 read 结果被丢弃、被暂停调用模型不知情的问题
4. 一次用户消息引发的所有上游调用，tokens 累加进同一条 assistant 消息，统一结算一次；**role=tool 的工具消息不持久化**（只在本轮调用链内存中传递），上下文重建仍只用 ai_message 的 user/assistant 消息，工具结果由 assistant 的最终自然语言回答承载。
   **P5 真机修复（§20.6 第 9 条）**：确认链路重建上下文时，**禁止出现「文本 assistant」直接紧跟「带 tool_calls 的 assistant」**——确认总结落库为独立 assistant 消息，与上一轮答复形成连续 assistant，DeepSeek 思考模式会以 400 拒绝；故 `buildConfirmContext` 会把紧邻的历史 assistant 文本并入原消息，合并为单条 assistant（content + tool_calls）
5. 工具参数校验：handler 入口按 parameters schema 校验（模型可能生成非法参数），失败结果回喂让模型自我修正（计入轮次）

### 12.3 域门面约定（域边界纪律的落地方式）

- ai 域工具需要 system 域能力时，**只允许注入 system 域模块 export 出来的 Service**（如 UserService、OnlineService、RoleService）
- ai 域工具操作个人网站时，**只注入 site 域门面 SiteFacade**（P4b 站点三件套 §15.2 + P5 CMS/生命周期七件套 §20.1；ToolModule imports SiteModule）
- ai 域工具操作云盘时，**只注入 cloud 域门面 CloudFacade**（P5 云盘五件套 §20.1；ToolModule imports CloudModule）
- ai 域工具操作站点评论/封面时同样**只经 SiteFacade**（P6 评论三件套与 `resolveCoverPath`，§21.2/§21.3）；跨域复用常量（如评论字数上限）经门面 re-export，禁止直插站点域内部文件
- system 域各模块需在 module 的 `exports` 中显式声明可被外部使用的 Service；未导出 = 私有
- handler 禁止直接操作其他域的表、禁止绕过 Service 写旁路逻辑

### 12.4 system prompt 结构（chat.service 拼装，顺序固定；**P6 T77 改两段式，见 §21.1**）

```
1. 助手设定（固定文案：你是 iplat 平台内置 AI 助手，可使用提供的工具帮助用户操作系统……）
2. 通用版手册：docs/PLATFORM-GUIDE.md 全文（启动时读入内存缓存，文件变更重启生效；≤1000 字，压缩后的平台简介/角色权限/通用规则/功能入口/工具原则）
3. 能力清单（P6 新增，动态）：capability.manifest.ts 按当前用户权限逐项注入，一行一项（≤1200 字；无权限项不出现）
4. 当前用户上下文：昵称、角色名列表、当前日期（不注入权限标识明细，权限由工具过滤兜底）
```

> 合注总长硬约束 ≤2000 字符（分段阈值与机械核查见 §21.1）。工具使用原则自 P6 起写在通用版手册内（不再单列常量）。

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
├── manage/                   # 站点 CRUD（§10.2，`/api/site/manage/*`；P4e 起承接原 /api/site/mine）
├── template/                 # P4b 模板库（GET /api/site/templates、POST /api/site/manage/:id/apply-template，§15.7）
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

**site_site —— 站点（P4e 起每用户多站，配额见 §18.1）**：`id` / `user_id`（逻辑关联 sys_user；唯一索引已于 P4e 解除，改普通索引 `idx_site_user`）/ `slug`（unique varchar32，R11）/ `title` varchar50 / `description` varchar200 null / `root_folder_id`（逻辑关联 cloud_file）/ `media_folder_id` / `status` tinyint（1 启用 0 停用，R10）/ `comment_audit` tinyint / `create_time` `update_time`。

**site_column —— 栏目树**：`id` / `site_id` / `parent_id`（0=根，≤3 级 R6）/ `name` varchar32 / `sort` / `created_at` `updated_at`；索引 `(site_id,parent_id)`；同级同名不去重。

**site_tag**：`id` / `site_id` / `name` / `created_at`；`unique(site_id,name)`，索引 `(site_id)`。

**site_article —— 文章**：`id` / `site_id` / `column_id` / `title` varchar100 / `summary` varchar200（留空自动取正文纯文本前 100 字）/ `cover_path` varchar255 null（必须 media/ 前缀）/ `content_md` longtext / `word_count`（R14）/ `view_count`（R8）/ `status`（0 草稿 1 发布）/ `published_at` null（首次发布写，下架再上架不刷新）/ `created_at` `updated_at`（无 deleted_at，R7 物理删除）；索引 `(site_id,status,published_at)`、`(site_id,column_id)`。

**site_article_tag**：`id` / `article_id` / `tag_id`；`unique(article_id,tag_id)` + 双索引。

**site_comment —— 评论**：`id` / `site_id` / `article_id` / `nickname` varchar32 / `content` varchar500 / `audit_status`（0 待审 1 通过 2 驳回）/ `ip` varchar50 / **`reply_content` varchar500 null（P6 T78 作者回复，一级回复：每条至多一条，空 = NULL）** / **`reply_at` datetime null（与 reply_content 同生同灭）** / `created_at`；索引 `(article_id,audit_status)`、`(site_id,audit_status)`。

**cloud_file 变更**：`is_public tinyint default 0` **三态**：0=继承父目录（新建默认）/ 1=显式公开（站点根恒为 1）/ 2=显式阻断。公开性上溯判定见 14.4。域内 Prisma relation 仅 article→column / articleTags / comments 三条，跨域一律逻辑外键。

### 14.3 站点创建流程（manage.service；P4e 多站化后的现行口径见 §18.2）

> P4e 变更：第 1 步的「校验当前用户无站点（40101）」改为**配额校验**（40118），目录名由「我的站点」改为 **slug**（D57）；40101 收窄为「未开通站点」引导语义。其余流程不变。

1. 校验 slug（R11 正则 + 保留字黑名单 + 全局唯一 40102/40103）；配额校验（P4e）
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

| code  | 含义                                                                                                    | 处理                                     |
| ----- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| 40101 | 站点不存在或未开通                                                                                      | 后台引导创建；开放层不出现（统一 40400） |
| 40102 | slug 已被占用                                                                                           | 提示更换                                 |
| 40103 | slug 格式非法或命中保留字                                                                               | 提示规则                                 |
| 40104 | 站点已停用                                                                                              | 后台提示（开放层统一 40400）             |
| 40105 | 站点根目录不可用 / 封面不在 media/                                                                      | 提示去云盘检查目录                       |
| 40106 | 栏目不存在                                                                                              | 刷新栏目列表                             |
| 40107 | 栏目下存在子栏目或文章 / 超 3 级，不可操作                                                              | 提示先清空                               |
| 40108 | 标签已存在                                                                                              | 提示更换名称                             |
| 40109 | 文章不存在                                                                                              | 刷新文章列表                             |
| 40110 | 评论不存在                                                                                              | 刷新评论列表                             |
| 40111 | 评论提交过于频繁                                                                                        | 提示稍后再试                             |
| 40112 | 用户已开通个人网站，禁止删除（R13 预检；P9 注明分工：本条 = **有站点**）                                | 提示先删除站点                           |
| 40113 | 站点文件路径非法（越出站点根 / 含 `..` / 绝对路径 / 空段，P4b R17）                                     | AI 工具回喂，模型修正路径                |
| 40114 | 文件类型不允许（非文本白名单扩展名，P4b R17）                                                           | AI 工具回喂 / 编辑器按钮不显示           |
| 40115 | 内容超限（AI 写 >256KB / 单次 >10 个 / 读 >64KB，P4b R17）                                              | AI 工具回喂，模型拆分或精简              |
| 40116 | 模板不存在（P4b T44 apply-template）                                                                    | 刷新模板列表                             |
| 40118 | 站点数量已达上限（P4e R47，message 带 limit/used）                                                      | 提示联系管理员调配额                     |
| 40119 | 站点不存在或非属主（P4e）                                                                               | 刷新站点列表 / 切当前站                  |
| 40120 | 用户名下仍有站点内容（文章/栏目/标签），禁止删除（P7 R75 预检；P9 注明分工：本条 = **无站点但有内容**） | 提示先清理内容（文章/栏目/标签）         |

> 40112 / 40120 分工（P9 T91-H1 结案）：两码**语义不重叠、均活跃**——此前文档把 40120 写成「仍有站点」才显得与 40112 重复。实际预检链（`system/user/user.service.ts#remove`）：云盘 `30011` → **有站点 → 40112** → **无站点但有内容 → 40120**（内容池化后没有站点也可能留着文章/栏目/标签，必须显式清理）。登记与代码一致，故不废弃任一方。

> 40117（该文件夹未开放列表浏览）为 **P4c 开放层码**（挂在 cloud 段常量尾部，语义见 §16.2），不属 site 域段，故本表不连续。
> 40118/40119 编号顺延说明见 §18.7（PRD-P4E 名义编号为 40117/40118）。

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
├── template.controller.ts # GET /api/site/templates、POST /api/site/manage/:id/apply-template
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

**AI/模板写入 vs 编辑器保存（两种覆盖语义对照，防误合并）**：

| 维度     | AI/模板写入（SiteFacade.writeFiles）                                       | 编辑器保存（PUT content）                                   |
| -------- | -------------------------------------------------------------------------- | ----------------------------------------------------------- |
| file 行  | 同路径软删旧版 + 新建行（fileId/URL **变**）                               | 更新行（fileId/URL **不变**）                               |
| 旧版处理 | 进回收站，可还原（R18/D22）                                                | 旧物理文件直接删除，不可回滚（D22；需回滚靠编辑器再次保存） |
| 缓存处理 | 写完精确失效 site:path（含负缓存）                                         | 无需失效（fileId 不变，ETag 随 size/mtime 自然变化）        |
| 设计理由 | 站点路径即 URL，覆盖=删旧建新符合目录语义；模板温和覆盖（R20）复用同一语义 | 编辑器高频保存，行更新避免引用与缓存抖动（PRD F4 定论）     |

### 15.5 编辑器保存接口（cloud 域）

`PUT /api/cloud/file/:id/content`，`@RequirePermission('cloud:file:upload')` + `@OperationLog('云盘','在线编辑保存')`：

1. assertOwned（30001）→ isDir=1 拒绝（40001）
2. ext ∈ 文本白名单（与 §15.11 同集）→ 否则 30012；`Buffer.byteLength(content)` ≤1MB → 否则 30013
3. writeFromBuffer 写新物理 → `FileService.replaceFileContent`（公共方法，§9 资产表）→ 删旧物理
4. 更新行语义：fileId/URL 不变，**仅 storage_name/size/update_time 三列**（mime/ext/is_public 不动；开放层 MIME 输出按 ext 解析，与 DB mime 无关）
5. DTO `{ content }` @IsString + @MaxLength(1_048_576) 字符级粗拦，字节级 service 精算；**main.ts json body limit 须 ≥2MB**（默认 100KB 会在进 DTO 前 PayloadTooLarge）

### 15.5a 前端编辑器集成（CodeMirror 6）

- 依赖白名单（D20 批准，除此之外零新增）：`codemirror` 元包 + `@codemirror/state` / `@codemirror/view` + `lang-html/css/javascript/json/markdown/xml`；**禁主题包、禁 lint/autocomplete 增强包**
- language 包按 ext 动态 import（html/css/js/json/md/xml 高亮，其余纯文本），云盘首屏 bundle 不携带 language 代码；FileEditorDialog 组件本体静态引入、编辑器实例在弹窗打开时才创建（较增补 §15.9 的 defineAsyncComponent 预期更保守，实现偏差随 T43 登记）
- 「编辑」入口显示条件：非目录 + 文本白名单 ext + size ≤1MB + v-permission `cloud:file:upload`；加载复用 preview 接口
- file.list 三态标签（R23）：isPublic 1→「公开」/ 2→「已阻断」/ 0→无标签；「设为公开/取消公开」按钮按 `isPublic === 1` 判断

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
- `POST /api/site/manage/:id/apply-template`（site:site:manage，@OperationLog）：站点 `:id` 非属主 40119（先于模板校验）→ templateId 由 DTO 正则 `^[A-Za-z0-9_-]{1,64}$` 挡穿越（40001）→ 目录不存在 40116 → 遍历模板文件（排除 template.json）→ 经 `SiteFacade.writeFiles` 温和覆盖（R20/D23：同名软删 + 新建，media/ 与模板外文件不动，失效由 writeFiles 内建）→ 返回逐文件清单（P4e 起路径参数站点化，原 `/api/site/mine/apply-template` 废弃）
- 建站（manage.create）模板源读 `site-templates/default/`；discardSiteDraft 回滚不变；已建站用户不受迁移影响
- 模板纪律（R22）：README.txt 为字段级契约，三套主体逐字一致；开放 API 变更必须同步三套 README

### 15.8 README 契约与 PLATFORM-GUIDE 分工（D26/R22）

- 模板内置 README.txt 是开放 API 的 **AI 契约唯一权威**（七端点字段级，以 ./api/ 相对路径视角）；三套模板主体逐字一致（T44 抽查口径）
- **R22 维护纪律**：开放 API 任何变更必须同任务同步三套 README；PLATFORM-GUIDE 只放摘要，注入后总长 ≤2000 字（改动后必须跑字数核查）

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

---

## 16. 云盘增强（P4c）：公开机制 + 批量上传 + 在线解压（自 ARCHITECTURE-P4C-增补.md 并入；增补文档保留为历史细节参考）

> 决策 D29~~D39 / 规则 R24~~R33 / 任务 T46~~T50，见 PRD-P4C-PUBLIC.md。既有约定（三态 is_public / 开放层纪律 / 域边界）不动，本节只写增量。

### 16.1 数据库与公开链接语义

- `cloud_file` 加两列：`public_token` varchar(32) **unique**（仅显式公开行有值，取消公开置空）+ `allow_listing` tinyint default 1（仅文件夹有意义，D32）
- token（R24/D30）：URL-safe 随机 ≥21 位（实际 24 字符 base64url），挂 fileId（改名不变）、唯一索引碰撞重试 ≤5 次；**取消公开 = token 置空 + is_public 归 0（继承），重新公开生成新 token（R27）**；软删（进回收站）同步置空 token（还原后旧链接仍 40400，isPublic 不动以保护站点根锚点）
- 既有 `POST set-public`（P4a 三态语义）保留不动，站点机制依赖；新 `POST /cloud/file/:id/public` 承载公开链接（幂等返回既有 token），审核门禁照 R9 口径挂接（开关空转）

### 16.2 公开访问判定链（/api/pub/）

- 独立前缀 `/api/pub/`（D31），与 `/api/open/` 并列共享开放层纪律：@Public、禁挂操作日志、资源类失败统一 40400（HTTP 200 + 统一体，防探测）；main.ts 开放层 CORP 改写与 CORS 反射同步覆盖 `/api/pub`
- 七件套：f/{token} 三件套（info/raw/download）+ d/{token} 四件套（list/info/raw/download?path=）；raw/download 流式（@SkipTransform），Range/206/416、ETag/304、Cache-Control no-cache、filename* 原名
- 判定链（资产表"公开访问判定链"）：token 查行（deletedAt null 且 is_public=1）→ **R25 祖先上溯：任一祖先 is_public=2 或祖先行缺失/已删 → 40400**（语义与 P4a resolvePublicPath 的"首个非继承节点定生死"不同，独立成链）→ path 逐段下行（段 is_public=2 阻断不继承 → 40400，有界 ≤10）→ list 端点额外 allow_listing=0 → 40117（D32：关闭列表后知道完整路径的子文件仍可达）
- 限流（R32）独立桶：raw/download 120 次/分/IP、info/list 60 次/分/IP（超限 42900，为 40400 防探测唯一例外）；**值硬编码 120/60（瘦版定值，与 site 配置组差异系有意为之；需调整时升配置组 `CLOUD_PUB_STATIC_LIMIT` / `CLOUD_PUB_DATA_LIMIT`，本期不做）**；D38：DB 直查不加 Redis 缓存
- MIME（R26，cloud 域自持 pub-mime.ts，不跨域 import site/open/mime.ts）：文本类强制 `text/plain; charset=utf-8`（inline）；html/htm/svg 强制 attachment；图片/音视频（R7 扩展 webm/ogg/wav/m4a）/PDF inline 真实 MIME；白名单外 octet-stream + attachment。**现状三份白名单分置**：transfer 预览（P3，管理侧预览 `transfer.service.ts` 内联白名单）/ site `open/mime.ts`（P4a，站点开放层）/ `pub-mime.ts`（P4c，公开端点）——域边界优先于复用，各自口径以代码为准（收敛需动 transfer 违反铁律 4，不做）
- 落地页文本展示口径（2026-09-10 修订，PRD F2 增强项）：md/markdown 在落地页**客户端 markdown 渲染**（复用公共组件 MarkdownView，html:false 禁 raw HTML，>10 万字符截断；md 内相对链接无站点基准不解析）；其余文本类维持纯文本 pre 展示；raw 端点输出（text/plain）不变，渲染属客户端增强。下载按钮与 noindex 不变

### 16.3 批量上传队列（前端，D34 后端零改动）

- `useUploadQueue`：并发 3 worker 池（R28）、单文件失败记录原因不阻塞、parentId 入队锁定、总进度按字节加权、队列进行中注册 beforeunload
- drop zone 仅文件列表区（拖入高亮）；拖入内容含文件夹 → 整批拒绝并提示"压缩后上传或使用在线解压"（D35，与 F4 话术闭环）；同名逐条 R4 自动"(1)"，面板展示最终落盘名

### 16.4 在线解压（UnzipService）

- 仅 .zip（≤ CLOUD_MAX_FILE_SIZE，30014）；`POST /cloud/file/:id/unzip` 同步执行（前端 timeout 0）；目标 = 同目录/包名文件夹（R31/R4），深度与单目录上限沿用 R6（30006）
- 流程（D36/R30 tmp 中转事务）：zip 源 copyToTmp → yauzl 顺序流式逐条（禁入内存）校验+落 tmp → 全部成功批量 moveToStorage + 单事务落库（used 记账）→ 任何失败清理全部半成品零残留
- 安全四件套（R29）见上；错误码 30014/30015/30016（§4.7 表）

### 16.5 错误码与 Redis Key

- 30014/30015/30016 见 §4.7 表；40117（该文件夹未开放列表浏览，开放层段）挂在错误码常量 cloud 段尾，语义见 §16.2
- Redis：`pub:rate:{bucket}:{ip}`（见 §9 后 Redis Key 表）

### 16.6 资产与文档

- 资产：公开访问判定链 / CloudFacadeModule / UploadQueue+useUploadQueue / FileView+FolderView / UnzipService / StorageService tmp 扩展 / 依赖白名单（见 §9 P4c 行）
- 三套模板 README.txt 增补 raw 直链说明（R22 逐字一致）；根 README.md 路线图勾至 P4c

### 16.7 演进预留

| 项                  | 触发条件        | 预留设计                                    |
| ------------------- | --------------- | ------------------------------------------- |
| 公开端点 Redis 缓存 | 访问量起来      | D38 预留，token→行缓存 + 取消公开主动失效   |
| 异步解压任务队列    | 大 zip 慢盘超时 | 同步接口契约不变，内部转任务 + 前端轮询进度 |
| 文件夹拖拽递归上传  | 用户诉求强烈    | webkitGetAsEntry 递归 + 队列 mkdir -p       |
| ~~文件夹打包下载~~  | **P4d 已实现**  | 见 §17.2（yazl 流式）                       |
| 公开链接访问统计    | 运营诉求        | visit_count 语义独立列，与分享隔离          |

---

## 17. 云盘操作增强 + 分享升级 + 公开语义分流（P4d，自 ARCHITECTURE-P4D-增补.md 并入；增补文档保留为历史细节参考）

> 决策 D42~~D50 / 规则 R36~~R46 / 任务 T52~~T58，见 PRD-P4D-CLOUD.md。既有约定（三态 is_public / 开放层纪律 / 域边界 / `/api/pub` 判定链）不动，本节只写增量。
> 依赖（D45 特批，唯一新增）：`yazl@^3.3.1`（apps/api，流式打包）。yazl 无自带类型且禁止加 @types，走本地窄声明 `src/types/yazl.d.ts`（照 yauzl 先例）。

### 17.1 数据库变更（cloud 域）

`cloud_share` 加列：

| 列              | 类型             | 说明                                                                             |
| --------------- | ---------------- | -------------------------------------------------------------------------------- |
| `password_hash` | VARCHAR(64) NULL | 提取码哈希（D47/R42：bcrypt salt 10，**不明文存储**）；NULL = 无密码（现状兼容） |

- `cloud_share.file_id` 语义扩展：**可为文件夹行**（is_dir=1）——文件夹分享 = file_id 指向目录行（D48），无需改列
- migration 手写 SQL + `prisma migrate deploy`（沿用 T46 环境口径；`20260912000000_add_cloud_share_password`）

### 17.2 移动与批量（api，modules/cloud/）

**move 接口**：`POST /cloud/file/:id/move`，body `{ targetParentId, confirmPublic? }`，`cloud:file:upload` + @OperationLog('云盘','移动')：

```
源行读取（含回收站，30001 不存在/非属主）→ 源在回收站 → 30019（R38）
→ 目标校验：0=根目录放行；其余必须当前用户未删除文件夹（不存在 30001 / 回收站 30019）
→ 源为站点根 → 30019（R37；经 SiteRootService 判定，见 §17.7）
→ 防环：targetParentId === 源 或位于源子树内 → 30019（有界上溯 ≤10）
→ R39 targetPublic：目标上溯遇第一个非继承节点定生死（1 → true / 2 → false，与 P4a 三态同口径）
→ 同父目录 → 幂等返回（不改名不写库）
→ R6：目标子项 <500、目标深度 + 源子树高度 ≤10（30006）
→ R4 同名自动"(1)"（resolveNameConflict 传 excludeId 排除源自身）
→ 未带 confirmPublic 且 targetPublic → **不执行移动**，仅返回标记（前端弹 R39 警告后重发）
→ 更新 parentId + name（单行写）；used 不变；公开性按新父目录上溯重新判定；token 挂 fileId 不受影响（D30）
响应 { id, name, finalName, targetPublic }
```

- 批量移动 = 前端队列逐条调 move（D42），无批量接口；批量遇公开目标**整批一次确认**（前端合并处理）
- 返回值 `targetPublic` 的语义：true 且未确认 = 未执行；true 且带 confirmPublic = 已执行

**file.list 扩展（R46）**：行内新增两个字段（后端上溯有界 ≤10，与公开判定链同口径）：

| 字段         | 说明                                                           |
| ------------ | -------------------------------------------------------------- |
| `inSite`     | 是否位于站点子树内（含站点根本身）——D49 前端按钮组分流的数据源 |
| `isSiteRoot` | 是否站点根目录（R45：站点根恒公开锚点，不提供「设为私有」）    |

`shared` 标记口径扩展（D48）：文件夹亦可分享，故目录与文件一并统计有效分享（status=1 且未过期）。

**打包下载**：`POST /cloud/file/pack-download`，body `{ ids: string[] }`（1~100 项），`cloud:file:list`，@SkipTransform 流式：

- `PackService`（modules/cloud/transfer/pack.service.ts，PackModule 独立注册供 transfer/share 双调用）：yazl 逐条 `addFile` → zip 流 → 响应，**零临时落盘、禁整包进内存**（D45/R41）；条目名 UTF-8 flag 由 yazl 统一置（源码 `FILE_NAME_IS_UTF8` 恒开，Windows 解压不乱码）
- 目录条目递归展开（有界 ≤10 层；条目总数复用 `CLOUD_UNZIP_MAX_ENTRIES`（5000）截断并记运行日志）
- 管理侧视角：打包自有文件**不查三态**；回收站内 id / 不存在 / 超 `CLOUD_MAX_FILE_SIZE` 的条目跳过并计入响应头 `X-Pack-Skipped`（R41）；`seenPaths` 去重防嵌套重复选中
- 响应头：`Content-Type: application/zip`、`Content-Disposition: attachment; filename="<ASCII 兜底>"; filename*=UTF-8''<包名>`、`Cache-Control: no-store`
  - 管理侧包名 = `iplat-pack-yyyyMMdd-HHmm.zip`（ASCII）；**分享侧包名 = 源文件夹名 + `.zip`**，故 quoted-string 必须 ASCII 兜底——中文名直接进响应头会让 Node 抛 `ERR_INVALID_CHAR`（2026-09-12 用户报障修复，详见 §17.8 第 9 条）
- 无有效条目 → 30001（不下载空包，避免无反馈）；客户端中断（res close）销毁 zip 输出流
- StorageService 新增 `resolvePath(storageName)`（yazl 需真实路径惰性读盘；穿越校验与内部读写同源）

### 17.3 分享升级（api，modules/cloud/share/）

**提取码链路（D47/R42）**：

- 创建/编辑分享：`POST /cloud/share` body 加 `password?: string`（4~8 位；空 = 无密码）；存 `password_hash`（bcrypt，复用既有依赖）
- 访客校验：`POST /cloud/share/:token/verify`（@Public，body `{ password }`）→ 通过签发**短期访问凭证**（Redis `share:pass:{token}:{sid}`，TTL = min(2h, 分享剩余有效期)）→ 后续访客请求经 `X-Share-Sid` 携带；无密码分享直通签发
- 修改/移除提取码：`POST /cloud/share/:id/password`（`cloud:share:create`，body `{ password: string | null }`；null/空 = 移除）→ 变更后 `scanDel share:pass:{token}:*` 旧凭证全部失效
- 防爆破：`share:passfail:{ip}:{token}` INCR + 10 分钟窗口，连续 5 次锁 10 分钟（照登录 10102 口径），错误码 30018（`message` 带剩余次数/剩余秒数）
- 凭证传递补充：媒体类原生子资源（`<video>/<img>/<iframe>/<a download>`）无法自定义请求头，故访客端点**同时接受 `?sid=` 查询参数**（等价通道；实现补充，见 §17.8）

**访客端点扩展**（均过密码门：`needPassword` 且无有效 sid → 30017；失效统一 30008；限流 30 次/分/IP 沿用）：

| 端点                                 | 说明                                                                                      |
| ------------------------------------ | ----------------------------------------------------------------------------------------- |
| `GET /cloud/share/:token`            | info 扩展：`needPassword`/`itemType`/`mime`/`ext`/`updatedAt`；`path` 可选 = 文件夹内子项 |
| `POST /cloud/share/:token/verify`    | 提取码校验（无密码直通），签发 sid                                                        |
| `GET /cloud/share/:token/raw`        | 文件流 inline + Range；MIME 口径 R44 同 R26（html/htm/svg 强制 attachment）               |
| `GET /cloud/share/:token/list?path=` | 文件夹分享单层列表（动态子树 R43：新增即见/删除即消失；is_public=2 项过滤不可见）         |
| `GET /cloud/share/:token/download`   | 文件 attachment（成功 visit_count+1；raw 不计次）                                         |
| `GET /cloud/share/:token/pack`       | 文件夹整包下载（复用 §17.2 yazl 链路，访客视角 `publicOnly` 过滤阻断项与子树）            |

- 文件夹分享（D48）：动态子树语义（未落任何快照，每次访问实时读库）；下钻任一段不存在或 `is_public=2` → 30008
- 管理侧 `GET /cloud/share/list` 行内新增 `itemType: file|folder`、`hasPassword: boolean`（**不返回密码本体**，列表面板掩码展示）
- 分享列表不再限定文件：`create` 的 30009「文件夹暂不支持创建分享链接」本期起不再触发（常量保留备用）

### 17.4 前端（web）

- **数据源适配层（D46）**：`views/cloud/public-view/usePublicSource.ts` —— `{ kind: 'pub'|'share', token, sid?, title? }` → 统一 `fileInfo / folderList / rawUrl / downloadUrl / packUrl`；`FileView.vue` / `FolderView.vue` 改为接收可选 `source` prop（缺省由路由自建 pub 源，公开落地页零改动），分享访客页复用同一渲染组件（语义分、体验不分）
- **分享访客页**（`views/cloud/share-visitor/index.vue`）：密码门禁页（输码/错误提示/剩余次数）→ 通过后按 `itemType` 渲染 FileView 或 FolderView；sid 存 sessionStorage（key `share-sid:{token}`，关标签页失效）；子路由 `/share/:token/file?path=` 承载文件夹内单文件预览
  - **陷阱（T58 浏览器走查发现）**：`/share/:token` 与 `/share/:token/file` 两条路由复用同一组件实例，路由切换时 `onMounted` **不会**重跑 → 必须 `watch(() => route.name)` 重新决策渲染分支（只监听 route.name：文件夹内下钻仅改 query，交给 FolderView 自行加载，避免整页闪回加载态）；同理 FileView 对 `targetPath` 变化需 `watch` 重载
- **剪切板**：`views/cloud/file/useMoveClipboard.ts`（模块级单例，命名避开 vueuse `useClipboard`；**一期会话内存态，刷新清空**）；剪切后行整行半透明（`row-class-name`）、工具栏出现「粘贴到当前目录（n）」
- **拖拽移动（R40）**：行 `draggable` + 自定义 MIME `application/x-iplat-move` 区分内外——`dataTransfer.types` 含 `Files` = 外部上传（T48 队列 + 列表区整框高亮）、含自定义 MIME = 内部移动（**文件夹行 / 面包屑项**高亮，两套样式不混用）；落到文件夹行或面包屑上级执行 move
- **多选批量（T54）**：`selectionMode` 切换复选框列（自持 `selectedIds`，不依赖 el-table selection，避免穿透 ProTable 封装）+ 多选工具栏（全选/批量删除/批量移动/打包下载）；批量删除与打包并发 3（D42），失败项入汇总面板；批量移动 = 批量入剪切板后粘贴
- **公开分流（T57/D49）**：按钮组按 `row.inSite` 渲染——站点子树内「设为私有/取消私有」（站点根无按钮），站点外「设为公开/复制公开链接/取消公开」；旧 `set-public` 前端入口只保留在站点子树内（语义 = 设为私有）
- 打包下载走 axios Blob（同预览/下载口径：自动带 token + 401 静默刷新），并按 `blob.type` 识别 HTTP 200 + JSON 统一体错误（否则错误体会被存成 .zip）

### 17.5 错误码增量

| 码    | 场景                                                         |
| ----- | ------------------------------------------------------------ |
| 30017 | 该分享需要提取码（未验证或凭证过期）→ 前端跳密码门禁页       |
| 30018 | 提取码错误（含连续 5 次锁 10 分钟，message 带剩余次数/秒数） |
| 30019 | 非法移动目标（移入自身子树 / 站点根 / 回收站）               |

### 17.6 域边界：站点根锚点查询（SiteRootService，P4d 新增跨域能力）

cloud 域的 `inSite`（R46）与 move 的站点根保护（R37）需要「当前用户的站点根目录 id」，按铁律 6 不得直读 `site_site`，故新增：

- `modules/site/facade/site-root.service.ts` + `site-root.module.ts`：`SiteRootService.getRootFolderId(userId)`（未开通返回 null）/ `isSiteRoot(userId, id)`；**零跨域依赖（仅全局 PrismaService）**，只返回 id，上溯/子树判定由 cloud 在自己域内完成
- cloud 侧 `FileModule` imports `SiteRootModule`（**不能复用 SiteFacadeModule**：后者因注入 CloudFacade 而依赖 CloudModule，会造成 CloudModule ↔ SiteModule 循环）；`SiteModule` 同步 re-export，保持 site 域对外契约完整
- 判定纪律：跨域只取「事实」，不取「数据」

### 17.7 Redis Key 增量（见 §9 表尾）

`share:pass:{token}:{sid}`（TTL = min(2h, 分享剩余有效期)）、`share:passfail:{ip}:{token}`（INCR + 10 分钟窗口）。

### 17.8 实现偏差登记（与增补文档的差异，以代码为准）

1. **访客端点支持 `path` 可选参数**（info/raw/download）：增补文档只写 list 带 path，但 PRD F3「文件夹分享 = 列表 + 下钻 + **单文件预览**」要求子文件可寻址，否则预览只能整包下载。落地为与 pub d 四件套同形的可选 path（缺 path = 分享项自身，raw/download 要求最终命中文件）。
2. **`?sid=` 查询参数通道**：增补文档只写请求头 `X-Share-Sid`；媒体原生子资源无法自定义请求头，故等价接受 `?sid=`（凭证本身短时效且与 token 绑定，泄漏面与签名 URL 同级）。
3. **file.list 增补 `isSiteRoot`**：R45「站点根无设为私有」需要前端可判定站点根，R46 的 `inSite` 不足以区分（站点根自身也 inSite=true）。
4. **`取消私有` 落库为 is_public=1（显式公开）而非 0（继承）**：`set-public` 契约二元（0→落库 2），故「取消私有」复用 `DELETE /cloud/file/:id/public` 的「归 0」语义（`cancelPublicLink`，is_public→0=继承 + token 置空）——最终落库值正是 0，与 D49 的「0↔2」一致；`设为私有` 走 `set-public(isPublic=false)` → 2。
5. **同父目录移动 = 幂等返回**（不改名、不写库）：文档未定义，按最小惊讶原则实现。
6. **深度上限校验**：pids 部分只列了 30006 目标 500 项上限，落地同时校验「目标深度 + 源子树高度 ≤10」（R6 深度口径，避免移动造出 >10 层树）。
7. **share 管理页「提取码」列掩码**：`••••（已设置）` 文案展示（后端不返回密码本体，无明文可比）。
8. **分享站点根（P4a `set-public`）与 token 公开（P4c）双入口**：P4d 只在**前端**收敛（站点子树内不再出现 token 公开按钮），后端 `POST set-public` 保留（站点机制依赖、AI 工具与开放层链路依赖）；P4c 走查观察 1 的「误用阻断」路径随之消除。
9. **访客整包下载改 fetch + Blob（2026-09-12 报障修复）**：原实现走原生 `<a href>` 导航，服务端异常（中文包名触发 `ERR_INVALID_CHAR` → 500）会被浏览器渲染成白页。现改为 `fetchSharePack`（请求头带凭证 + 加载态 + `res.ok`/`content-type` 双重校验 + 统一响应体错误转提示），下载名仍为 `<源文件夹名>.zip`；`?sid=` 通道保留给媒体类原生子资源。同时 `PackService.stream` 补 ASCII 兜底（见 §17.2「打包下载」），并同批修掉 `site/open/open-static.controller.ts` 的同类写法（站点开放层非白名单类型 + 中文名文件下载会同样 500）——**至此五处 Content-Disposition（transfer / pack / share / pub / open-static）口径完全一致：quoted-string 恒 ASCII 兜底 + `filename*=UTF-8''` 原名**。

### 17.9 演进预留（本期不做，架构不堵路）

| 项                         | 触发条件             | 预留设计                                                                     |
| -------------------------- | -------------------- | ---------------------------------------------------------------------------- |
| 打包下载异步任务           | 数千文件同步耗时     | 同 D36 口径：接口契约不变，内部转任务 + 前端轮询进度                         |
| 剪切板会话持久化           | 用户诉求（刷新不丢） | 现为内存态；改 sessionStorage/localStorage 即可，状态集中在 useMoveClipboard |
| 提取码强度策略             | 体验与安全权衡       | 现 4~8 位 + 防爆破限流兜底；如需强制 6 位改一处 DTO 与前端校验               |
| 公开端点 Redis 缓存        | 访问量起来           | D38 预留不变（分享侧同款）                                                   |
| 分享提取码跳转（短链带码） | 分享体验升级         | sid 机制已铺路，可签发一次性带码链接                                         |
| 多站点（P4e）              | 用户拍板配额化       | D50：站点数上限配额（默认 1，admin 可调）+ AI 工具单数语义改造 + 删站并入    |

---

## 18. 多站点（配额化）+ 删站 + AI 多站语义 + sid 日志脱敏（P4e，自 ARCHITECTURE-P4E-增补.md 并入；增补文档保留为历史细节参考）

> 决策 D51~~D57 / 规则 R47~~R57 / 任务 T59~~T65，见 PRD-P4E-SITE.md。既有约定（域边界 / 开放层判定链 / 三态 is_public / 统一响应）不动，本节只写增量；**§14（P4a 单站形态）中「每用户一个站点」的表述由本节取代**，其余（开放层、模板、评论审核等）不变。
> 零新增第三方依赖。

### 18.1 数据库变更（site 域）

1. **`site_site` 解除 `user_id` UNIQUE**：迁移只删唯一索引、补普通索引 `idx_site_user(user_id)`（多站下按用户查列表）；`slug` UNIQUE 不动。
2. **新表 `site_quota`（照 cloud_usage 先例）**：

| 列                        | 类型      | 说明                                      |
| ------------------------- | --------- | ----------------------------------------- |
| user_id                   | bigint PK | 懒创建（首次建站/查配额时 upsert）        |
| quota                     | int       | 站点数上限，默认取配置 SITE_DEFAULT_LIMIT |
| create_time / update_time | datetime  | 惯例                                      |

3. 配置：`site.defaultLimit`，env `SITE_DEFAULT_LIMIT`，默认 `1`（与 P4d 单站行为一致）。注意**站点数配额是 count 语义不是字节**，下限校验 R48 用 `count(site_site where user_id)`。
4. 迁移文件 `20260912100000_add_site_quota_and_multi_site`（手写 SQL + `prisma migrate deploy`，同 T46 环境口径）。

### 18.2 后端结构变更（modules/site/）

```
site/
├── manage/                  # 站点 CRUD：mine 系列 → 集合端点改造（T60），T65 后收敛到 /api/site/manage/*
│   ├── manage.controller.ts # GET /api/site/manage/list、POST /api/site/manage、GET/PUT/DELETE /api/site/manage/:id
│   ├── manage.service.ts    # list / create（+配额校验 R47）/ detail / update / delete（§18.3 级联）
│   └── admin.controller.ts  # GET/PUT /api/site/admin/quota（site:admin:quota，照 cloud admin 先例）
├── quota/
│   └── quota.service.ts     # getQuota(userId) 懒创建 / checkCanCreate(userId) / adminUpdate（下限=站点数）
├── facade/
│   ├── site-facade.service.ts  # + getSites / resolveSite(userId, slug?)（R56）/ createSite(userId, dto)（R57 委托 manage）/ getQuota / 既有多站化（getSiteInfo / listFiles / readFile / writeFiles 全部带 siteId）
│   └── site-root.service.ts    # getRootFolderId → getRootFolderIds(userId): bigint[]；isSiteRoot 改集合判定（R51）
└── article/column/tag/comment/ # 控制器与 service 全部 siteId 作用域化（T61）
```

- **配额单点**：`quota.service.checkCanCreate` 只在 `manage.create` 链首调用——手动建站与 AI create_site 同一入口，配额口径天然一致（D55）。
- **属主校验统一**：`manage` 侧 `getOwnedSite(userId, siteId)`；内容端点按实体 `site_id` 反查站点再校验属主，避免信任前端传的 siteId 与实体不匹配（list/create 类以 siteId 为准，update/delete 类以实体反查为准），统一 **40119**。
- **SiteRootService 多站化**（R51，取代 §17.6 单根签名）：`getRootFolderIds` 一次查出用户全部站点根 id（站点数受配额限制，集合很小，无分页必要）；cloud 域 `file.list` 的 `inSite` = 行的祖先链命中**任一**根、`isSiteRoot` = 行本身是**任一**根；move 的 R37 保护同口径扩展，**新增 R52 删除保护（30020）**：cloud 删除/回收站入口对站点根直接拦截，提示先删站点。
- **路由命名空间（T65 后调整）**：站点级资源全部收在 `/api/site/manage/*`（`GET|POST /api/site/manage`、`GET|PUT|DELETE /api/site/manage/:id`、`POST /api/site/manage/:id/apply-template`），使 `/api/site/*` 顶层**只剩静态段**（平台级模板库 `templates` / 内容子资源 `column|tag|article|comment` / 管理员能力 `admin/quota`），三态对称且**后续新增顶层静态路由永久安全**。
  - 为什么不用 `GET /api/site/:id`：Express 按注册顺序匹配，顶层参数段会吞掉 `/api/site/article`、`/api/site/comment`、`/api/site/templates`（实测 400，且这些控制器分属不同模块、注册顺序不可控）。详见 API §10.2 与 PROGRESS 遗留 14。
  - 实现注意：应用模板（`SiteTemplateApplyController`）与模板列表（`SiteTemplateController`）按命名空间拆成同一模块下的两个控制器，避免把 SiteTemplateService 注入 manage 模块形成 `SiteManageModule → SiteTemplateModule → SiteFacadeModule → SiteManageModule` 循环。

### 18.3 删站级联（manage.service.delete，R50/R53/R55）

```
属主校验（40119）
→ 事务内物理删：site_comment → site_article_tag → site_article → site_tag → site_column → site_site（R7 传统，无回收站）
→ CloudFacade.removeSiteRoot(rootFolderId)：站点根连同子树软删进回收站（deletedAt 置位，used 不动，R53 内部通道绕过 R52 的 30020）
→ 缓存清理：DEL site:resolve:{slug} + scanDel site:path:{siteId}:* + scanDel site:data:{siteId}:*（R55，无新 Key）
→ slug 立即可再注册（R49）
→ 响应 { deletedArticles, recycledRoot: true }
```

> ⚠ **本节已被 P7（§22.4）修订**：内容池化后文章/栏目/标签归用户，删站**不再物理删除内容本体**，只删 `site_comment`（评论随站走）与两条展示关联（文章 → 从本站下架、栏目 → 本站不再展示）。响应字段改为 `{ unpublishedArticles, deletedComments, recycledRoot }`。以 §22.4 为准。

- `removeSiteRoot` 是 CloudFacade 新增门面方法（管理侧语义，只抛 cloud 段码），与 `discardSiteDraft` 的区别：discard 用于建站失败的未公开草稿回滚（物理删 + used 回退），removeSiteRoot 用于删站（软删 + used 不动）。
- 还原后语义 R54：回收站还原的目录成为普通文件夹，is_public 保持 1；site 行已不存在，R45 按钮组按 inSite 自动回普通组。不做「还原即恢复站点」的设计（PRD 非目标）。
- 前端 R50 确认文案必须列明三段影响（文章/栏目/标签/评论物理删不可恢复；站点文件移入回收站可还原；slug 立即释放）。P7 后改按 §22.4 口径描述（内容本体保留）。

---

## 22. P7：站点内容池化（内容归用户 + 多站发表 + 路径美化）

> 决策：D73（内容/站点关系：文章/栏目/标签归用户，站点只是展示窗口）/ D74（删站级联）/ D75（迁移纪律）/ D76（开放层口径）/ D77（路径美化）/ D78（默认模板 history 路由）；规则 R75（迁移单事务）/ R76（开放层口径）/ R77（AI 工具站点分档）/ R78（回退与负缓存）。
> 迁移文件：`apps/api/prisma/migrations/20260916100000_p7_content_pool/migration.sql`（手写 SQL + `prisma migrate deploy` 同 T46 口径）。

### 22.1 变更动机（D73）

P4e/P5/P6 的口径是「文章/栏目/标签属于某个站点」，导致：多站点用户想把同一篇文章给两个站点看必须复制；删站会连带物理删除内容本体（R7）。P7 改为：

- **内容归用户**：文章 / 栏目 / 标签是用户内容池里的实体（`user_id`），不隶属于任何站点；
- **站点只是展示窗口**：内容在哪些站点出现由关联表决定（文章 = 发表 `site_article_publish`，栏目 = 展示 `site_column_display`，标签**跟随文章**自动出现在对应站点）；
- **评论仍随站走**：`site_comment.site_id` 保留（评论是站点访客产生的，删站即删评论，符合 R7 既有语义）。

### 22.2 数据模型变更

| 表                     | 变更                                                                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `site_article`         | 删 `site_id`，加 `user_id`；新索引 `idx_article_user_status(user_id,status,published_at)`、`idx_article_user_column(user_id,column_id)` |
| `site_column`          | 删 `site_id`，加 `user_id`；新索引 `idx_column_user(user_id,parent_id)`                                                                 |
| `site_tag`             | 删 `site_id`，加 `user_id`；唯一键由 `(site_id,name)` 改为 `uk_tag_user_name(user_id,name)`                                             |
| `site_article_publish` | **新增**：`article_id + site_id + is_top + published_at`，唯一键 `(article_id,site_id)`，索引 `(site_id,is_top,published_at)`           |
| `site_column_display`  | **新增**：`column_id + site_id + sort`，唯一键 `(column_id,site_id)`，索引 `(site_id,sort)`                                             |
| `site_comment`         | 保留 `site_id`；索引改 `idx_comment_site_article_audit(site_id,article_id,audit_status)`                                                |
| `site_site`            | 加 `spa_fallback VARCHAR(64) NULL`（SPA 回退入口，D77；**NULL = 不启用回退，行为与 P7 前一致**）                                        |

迁移执行顺序（单事务，R75）：加列 → 建关联表 → 按原 `site_id` 反查站点属主回填 `user_id` → 按原归属写入发表/展示关联 → 建新索引 → 删旧索引与旧列。执行前必须 `mysqldump` 全库备份（已在 migration.sql 头部写明）。

### 22.3 后端端点口径（详见 API §14）

1. **内容列表全部用户级化**：`GET /api/site/article`、`GET /api/site/column/list`、`GET /api/site/tag/list` **不再接受 `siteId`**（一律以登录用户的 `userId` 为准）；
   - 文章列表保留可选 `siteId` **筛选**语义（不传 = 内容池全部，传 = 只出已发表到该站的）；
   - 列表实体新增 `sites` 字段（文章 = 已发表站点 + 每站 `isTop`，栏目 = 展示站点）。
2. **发表 / 显隐关联端点**（替换式，空数组 = 全站下架/不展示，本体保留）：
   - `PUT /api/site/article/:id/sites` `{ sites: [{ siteId, isTop }] }`
   - `PUT /api/site/column/:id/sites` `{ sites: [{ siteId, sort }] }`
   - 站点不属于当前用户 → 40119。
3. **写入口**：`POST /api/site/article` / `PUT /api/site/article/:id` 支持 `siteIds`（提供即替换发表集合，新建不传 = 仅入内容池）；`POST /api/site/column` 支持 `siteIds`（不传 = 该用户全部站点可见）。
4. **建站灌内容**：`POST /api/site/manage` 支持 `publishArticleIds: 'all' | number[]`（缺省 = `'all'`，把内容池里已发布文章发表到新站），空数组 = 先建空站。
5. **站点列表 `articleCount`** 改为统计「已发表到本站的文章数」。

### 22.4 删站级联修订（取代 §18.3）/ 删用户预检

```
属主校验（40119）
→ 事务内物理删：site_comment（评论随站走，R7 传统）
→ 事务内删本站展示关联：site_article_publish where site_id / site_column_display where site_id
  （文章/栏目/标签本体保留在用户内容池，可再次发表到其他站点）
→ CloudFacade.removeSiteRoot(rootFolderId)：站点根连同子树软删进回收站（used 不动）
→ 缓存清理：DEL site:resolve:{slug} + scanDel site:path:{siteId}:* + scanDel site:data:{siteId}:*
→ slug 立即可再注册（R49）
→ 响应 { unpublishedArticles, deletedComments, recycledRoot: true }
```

- **删用户预检新增 40120**：`system` 域删用户前先查「是否仍有站点内容（文章/栏目/标签）」；**站点本身由既有 40112 前置拦截**，故 40120 专管「站点已清理但内容池仍有内容」这一新情形（内容池化后无站点也可能有内容）。预检链：`30011 云盘 → 40112 有站点 → 40120 有内容`（P9 T91-H1 澄清，详见 §5 错误码表注）。
- AI 工具 `delete_site` 的确认卡与返回字段同步改为「下架 N 篇 + 删评论 M 条」。

### 22.5 路径美化回退链（D77/R78，open-static.controller）

对 `/api/open/{slug}/**` 静态请求，**仅当最后一段无扩展名**（不匹配 `\.[A-Za-z0-9]{1,8}$`）时启用回退：

```
真实文件 ──命中──→ 直接出（Content-Type 按扩展名）
   │ 未命中
   ↓
补 `.html` 再试 ──命中──→ 出 HTML
   │ 未命中
   ↓
目录语义 `path/index.html` ──命中──→ 出 HTML
   │ 未命中
   ↓
站点 `spa_fallback`（NULL = 跳过） ──命中──→ 出 index.html（200，SPA 自己路由）
   │ 未命中
   ↓
40400（业务 404；HTTP 200 + code 40400，统一响应体口径）
```

纪律：

- **带扩展名的请求永不回退**（如 `/not-exist.png` → 直接 40400），避免静态资源缺失被 index.html 吞掉；
- **回退命中不写负缓存**（R78）：`site:path` 负缓存只用于「确定不存在」的静态文件；SPA 路径会因新发表文章而由未命中变命中（同一 URL 内容可变），写负缓存会让访客看不到新发表的内容；
- **开关按站点**：`spa_fallback` 由「建站 / 应用模板」时从 `template.json#spaFallback` 读入，存量站点为 NULL = 行为完全不变；P9 T94 起可在站点设置页按站开关（见 §25.4）；
- **目录语义优先于回退链**（P9 T91-C1 澄清）：真实目录仍走 R4 语义——`/{dir}`（无斜杠、目录下有 `index.html`）→ **301** 补斜杠到 `/{dir}/`；`/{dir}/`（带斜杠）→ 直接出 `index.html`；目录存在但无 `index.html` → 40400（不做 autoindex、也不补斜杠，避免重定向环）。回退链里的「目录语义」一级只兜**非真实目录**的情形（如 `/article/9` 这类虚拟路径），故无 `<base>` 的自定义 MPA 模板不会因回退拿到错误资源基址。

### 22.6 开放层口径（D76/R76）

`/api/open/{slug}/api/**` 一律**按站**出内容（站点解析沿用 `site:resolve:{slug}` 缓存）：

- 文章：`site_article_publish` 内连接 + `status=1`，排序 **`is_top desc, published_at desc`**（置顶仅在该站内生效）；
- 栏目：只出 `site_column_display` 中该站的栏目，`articleCount` 只计**已发表到本站**的文章；
- 标签：跟随文章——只出现在本站已有文章引用到的标签（空即是 0 条，属正常）；
- 站点信息/归档/评论沿用既有口径（`site_id` 仍是评论的物理边界）；
- **评论读与写同口径**（P9 T91-C2 澄清）：访客提交评论（`POST /api/open/{slug}/api/articles/:id/comments`）先过 `assertPublishedArticle`（本站发表关联 + `status=1`），**未发表到本站 / 草稿 / 文章不存在一律 40400**，与详情读路径完全一致（不区分原因，防探测）。

### 22.7 AI 工具适配（R77）

7 个 CMS 工具的**语义调整**（工具总数 28 不变，`pnpm check:ai` 16/16）：

| 工具                                      | 变化                                                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `create_site_article`                     | 加 `siteIds?: number[]`；**status=0（草稿）可完全不选站**（只进内容池），status=1（发布）必须能确定发表站点（slug 或 siteIds） |
| `update_site_article`                     | 加 `siteIds?: number[]`（提供即整体替换，空数组 = 全站下架）；slug 由必选降为可选（给了才校验「已发表到该站」）                |
| `publish_site_article`                    | slug 可选；**上架且零发表站**时在确认卡与返回值加警示行（提示：尚未发表到任何站点，上架后任何站点都看不到它）                  |
| `list_site_articles`                      | 列表改用户级 + 可选站点筛选；返回带 `sites`                                                                                    |
| `read_site_article`                       | 归属校验由「属于该站」改为「已发表到该站」                                                                                     |
| `ensure_site_column` / `ensure_site_tags` | 去站点参数（栏目/标签用户级）                                                                                                  |
| `delete_site`                             | 确认卡与返回改口径（下架而非删除内容本体）                                                                                     |

能力清单（`chat/capability.manifest.ts`）文案同步为内容池口径，与工具签名同源（R69）。

### 22.8 前端

- 文章 / 栏目 / 标签三页**去掉站点切换器**（列表内容不再随站点切换），默认出全部内容池内容；文章页加「发表站点」筛选下拉（全部站点 / 指定站）。
- 文章编辑弹窗：多站勾选 + 每站独立「置顶」勾选；封面上传仍要落具体站点 `media/`，多站时提供「上传到：X」选择（D13 不变）。
- 栏目弹窗：展示站点多选（不选 = 全部站点可见），保存走 `PUT /api/site/column/:id/sites`。
- 建站弹窗：初始内容单选（发表全部已发布文章 / 先空站）。
- 删站确认文案与成功提示改按 §22.4 口径。

### 22.9 默认模板 history 路由（D78）

`apps/api/assets/site-templates/default/`：

- `app.js` 从 `location.pathname` 反推站点公开前缀 `/api/open/{slug}/` 作为 `BASE`，所有 API 与站内链接基于 BASE；`index.html` 用同一逻辑写入 `<base>`，保证**回退场景下相对资源路径仍正确**（否则 `/article/12` 会把 `./style.css` 解析到 `/article/style.css`）。
- 路由由 hash（`#/article/{id}`）改为 history：`/article/{id}` → 详情，其余（含 `/?columnId=x`）→ 列表；`data-site-link` 标记的站内链接走 `pushState` 拦截，避免整页刷新；监听 `popstate` 而非 `hashchange`。

### 18.4 AI 工具改造（T62，ai 域 tools/ 下原位加改，handler 仍只注入 SiteFacade）

| 工具                                                      | risk                | parameters 变更                 | 行为                                                                                                                                                                                                                                              |
| --------------------------------------------------------- | ------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_site_files` / `read_site_file` / `write_site_files` | read/read/write     | 加 `slug?: string`              | `resolveSiteForTool`（统一入口，list-site-files.tool.ts）：slug 提供 → 查无回喂 `{ ok:false, errorCode:40119, sites }`；省略 → 0 站 40101 引导 / 1 站直通 / 多站回喂 `{ needSitePick:true, sites:[{slug,title}] }`                                |
| `create_site`（新增，工具总数 11）                        | **write**（确认卡） | `{ slug, title, description? }` | summarize 摘要「创建站点 {slug}（{title}）」；执行走 manage 创建链；配额满回喂 `{ ok:false, errorCode:40118, message, limit, used }`、slug 冲突 40102 / 保留字 40103 回喂 `{ ok:false, errorCode, message }`，均不抛栈（R57），模型可换 slug 重试 |

- description 纪律同步更新：四件套统一写明「多站点用户建议先 list 或询问用户目标站点 slug」；`write_site_files` 的 summarize 每项携带 `{ site: { slug, title } }`（验收 8），前端 `ToolConfirmCard` 渲染「目标站点」行。
- `create_site` 的 `limit/used` 取自 `SiteFacade.getQuota`（委托 manage 配额服务），保证与 REST 侧同源。

### 18.5 前端（T63）

- **站点列表页** `views/site/site/index.vue`（seed 菜单「个人网站」首位子项，`site:site:manage`）：列 slug / 标题 / 状态 / 文章数 / 创建时间 / 站点地址（外链 + 复制）；行操作 = 管理（`setCurrent` + 跳站点设置）、编辑、删除（R50 确认）；顶部「新建站点」（配额满则禁用并提示 limit/used）+ 配额展示。
- **当前站 store** `stores/site.ts`（公共资产）：`listSites` 为唯一数据源（含 `{ limit, used }`）；`currentSiteId` 持久化 localStorage；`resolveCurrent()` 回退链：缓存命中且仍在 list → 否则唯一站点 → 否则第一站 → 0 站空态；站点被他端删除后下次 `load()` 自动回退（验收 6）。
- **既有 5 页零路由变更**：站点设置/栏目/文章/标签/评论保持原路由，作用于「当前站点」；页顶 `SiteSwitcher`（`v-if="multi"`，单站用户全程无感）；请求统一从 store 取 siteId 注入（list 走 query、create 走 body），并 `watch(currentSiteId)` 重载本页数据（文章页同时重拉栏目/标签，封面与插图上传改用当前站的 `mediaFolderId`）；0 站时不做请求、显示「先去站点列表创建」空态。
- **用户管理**：追加「站点配额」按钮与弹窗（`site:admin:quota`，照云盘配额按钮先例；下限 = 已有站点数）。
- seed 增量：菜单「站点列表」（sort 1，原 5 项顺延）+ 权限标识 `site:admin:quota`（挂用户管理下）。common 角色按「个人网站子树 BFS」授权，天然含站点列表、不含 `site:admin:quota`。

### 18.6 sid 日志脱敏（T64，D56）

- 新增 `common/utils/url-mask.util.ts`：`maskSensitiveQuery(url, keys = ['sid','password'])`——解析 query 并对目标键值替换为 `***`，未命中或解析失败原样返回（宁漏勿错，不阻断主流程）。
- 落点（全仓 `originalUrl | req.url` 排查后的唯一实际落点）：① GlobalExceptionFilter 记录未捕获异常的 `req.originalUrl`（本轮顺带补记 method，便于定位）；② OperationLogInterceptor 落库的 `url`，且 `params` 的敏感键集合加入 `sid`。其余日志（chat/upload 等）不拼接 URL，无需处理。
- 部署口径：`deploy/nginx.conf` 使用不含 `$args` 的 `log_format iplat_main`（备选：`map $arg_sid $sid_masked` 打码后拼装），README 已补提示。**winston 未接入本仓库**（运行日志走 Nest Logger），后续若接入须沿用 `maskSensitiveQuery`（PROGRESS 遗留 16）。

### 18.7 错误码增量（并入 §5）

| 码    | 语义                                      | 说明                                                                        |
| ----- | ----------------------------------------- | --------------------------------------------------------------------------- |
| 40118 | 站点数量已达上限（message 带 limit/used） | PRD-P4E 名义编号 40117，因 40117 已被 P4c `CloudListingDisabled` 占用而顺延 |
| 40119 | 站点不存在或非属主                        | 同上顺延；不暴露他人站点存在性                                              |
| 30020 | 站点根目录禁止直接删除（须先删除站点）    | R52                                                                         |

40101 语义收窄为仅「未开通站点」（PRD §4）：多站后「已有站点」场景消失。

### 18.8 缓存与 Redis Key

无新增 Key。删站新增清理动作 R55（`site:resolve:{slug}` / `scanDel site:path|data:{siteId}:*` 三条既有 Key 族的删除时机扩展）。`site:path` / `site:data` 按 siteId 隔离，多站天然不串。

### 18.9 兼容与迁移

- 存量单站用户：limit 默认 1、唯一站点自动成为当前站、AI 三件套省略 slug 直通——**全链路行为与 P4d 零差异**（验收 1/6/7 即回归保护）。
- `/api/site/mine*` 端点删除（D52 无兼容期）；前端同期切换。
- 存量站点根目录名「我的站点」不改（D57 仅约束新站：目录名 = slug）；slug 与目录名从此解耦，改 slug 不动目录名（D57 后新站天然如此）。

### 18.10 演进预留（本期不做，架构不堵路）

| 项                          | 触发条件             | 预留设计                                                                                                                                                                                   |
| --------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 等级/套餐驱动配额           | 用户要按套餐送站点数 | `site_quota` 已具备 per-user 承载力，接套餐引擎改 `quota` 即可                                                                                                                             |
| AI 删站 / 改站工具          | 用户诉求             | 走同一 `manage` 链，confirm 卡摘要带 slug/title 即可                                                                                                                                       |
| 站点间内容复制 / 自定义域名 | 用户诉求             | 前者需跨 siteId 写内容（内容表已带 site_id，无结构阻碍）；后者需新增域名映射表                                                                                                             |
| 模板库读取是否也收进 manage | 命名空间洁癖         | 现 `GET /api/site/templates` 属**平台级**资源（与具体站点无关，读 assets），按规则留顶层；若统一收口可改 `GET /api/site/manage/templates`（需把该静态段声明在 manage 控制器的 `:id` 之前） |

---

## 19. 云盘收尾清账（P4F）：回收站自动清理 + 配额对账 + 历史小瑕疵（自 ARCHITECTURE-P4F-增补.md 并入；增补文档保留为历史细节参考）

> 零新依赖（`@nestjs/schedule` 自 P2a 已启用）、零新错误码。决策 D58~~D61 / 规则 R58~~R62 / 任务 T66~T70，见 PRD-P4F-CLOUD.md。

### 19.1 配置增量（upload 配置组，T67）

| 配置                         | env                            | 默认 | 说明                               |
| ---------------------------- | ------------------------------ | ---- | ---------------------------------- |
| `cloud.recycleRetentionDays` | `CLOUD_RECYCLE_RETENTION_DAYS` | 30   | 回收站保留天数（D58）              |
| `cloud.recycleCleanEnabled`  | `CLOUD_RECYCLE_CLEAN_ENABLED`  | true | 自动清理总开关（false 时任务空跑） |

> 布尔读取口径：仅显式 `false`/`0` 关闭（缺省即开），与 `CLOUD_AUDIT_ENABLED === 'true'`（缺省关）相反——**默认值由配置语义决定，不套用同一写法**。

### 19.2 回收站自动清理（T67）

```
modules/cloud/recycle/
├── recycle.controller.ts / recycle.service.ts   # 既有
├── recycle-clean.task.ts                        # 本期新增：@Cron('0 30 3 * * *') 每日 03:30
└── dto/
```

- **分层**：`RecycleCleanTask` 只做「读开关/天数 → 调 `RecycleService.cleanExpired(days)` → 记汇总日志」；编排链落在 Service（与 P2a `PlanTask → CreditService.resetExpiredCycles` 同款，cron 文件不与 Prisma 直接耦合）
- **执行链**：查 `deleted_at < now − N 天` 的行（按 id 升序分批，每批 ≤500）→ 以「超期行中的最顶层项」为执行单元（`hasDeletedAncestor` 上溯判定，与回收站 R2 顶层归集**共用同一私有判定**）→ 复用既有 `purgeSubtree` 彻底删除链（子树物理删 + 删分享 + used 回退）
- **子树去重**：父行与子行可能同批命中，父行清理即级联子行；若整批均为「已删子树成员」（其顶层项尚未超期），本轮无进展即退出，等其顶层项超期时随父行一并清除
- **头像旧行（`parent_id = -1` 且已软删）**：R58 要求同样清理。其 used 在换头像时已被 `CloudFacade.saveAvatar` 回退（R60 公式据此扣除 `revertedAvatars`），故清理时**只删物理文件与行、不回退 used**——为此 `purgeSubtree` 增加 `options.refundUsed`（默认 `true`；仅头像旧行传 `false`）。删除逻辑仍 100% 复用，未另写第二条删除链
- **幂等/容错**：单行失败只记 error 日志并继续；下轮自然续扫；不加分布式锁（个人平台单实例，R59 口径）；物理文件缺失静默（沿用彻底删除链既有口径）
- **日志**：每轮 `扫描行数 / 清除项数 / 文件数与字节 / 失败项数` 一条 INFO；开关关闭时只记一条跳过日志

### 19.3 配额对账（T68）

```
modules/cloud/admin/
├── admin.controller.ts   # GET/PUT usage-reconcile（cloud:admin:quota）
├── admin.service.ts      # reconcileUsage(userId?) / reconcileFix(dto) / buildReconcile([])
└── dto/quota.dto.ts      # ReconcileUsageDto
```

- **诊断**：按 R60 公式三段聚合（`groupBy(userId)` + `_sum.size` + `_count` 三条 SQL，不拉行）；`userId` 缺省 = `cloud_usage` 行 ∪ 文件行 的属主集合逐条返回。接口契约见 API.md §11.2
- **修正**：先重算再 `cloud_usage.used = expected`（行不存在懒创建）；响应带 `{ oldUsed, newUsed, diff }`；`@OperationLog('云盘','配额对账修正')`；只写 used 一个字段
- **前端**：用户管理「调整云盘配额」弹窗打开时并行拉诊断（失败不阻塞配额调整）→ 展示「公式值 / 当前值 / 差额」；`diff ≠ 0` 出「按公式值修正」+ 二次确认，`diff = 0` 显示「一致」不出按钮
- **22,751 字节历史差额归因结论（本轮实测，回填 PROGRESS）**：admin（user 1）`stored = 64,428,657`、`expected = 64,451,408`、`diff = +22,751`；三段明细 `active = 71 行/64,451,408 字节`、`recycled = 0`、`revertedAvatars = 0`。差额 **100% 落在「未删除行」段**（used 比现存未删除行字节之和少 22,751），且与 `recycled`/`revertedAvatars` 无关，可排除「回收站软删未扣」与「已回退头像行口径」两类解释；指向 P3/T49 时期的一次性 used 回退/漂移（P4c 走查记载 T49 做过「两用户 used 漂移校正」，同源）。属**一次性历史漂移、非持续泄漏**；是否写回由管理员在弹窗内显式点「按公式值修正」决定（本期不自动修）
- **引擎侧观察（非本期引入）**：`GET /api/cloud/admin/usage-reconcile` 与 `GET /api/cloud/admin/quota` 均要求 `cloud:admin:quota`；修正入口对 admin 自身开放（R62 同款放开的自然延伸）

### 19.4 历史小瑕疵打包（T69）

1. **`saveBlob`（`web/src/utils/download.ts`）**：Blob 下载全仓唯一口径（`createObjectURL` → `a.click()` → **延时 10s `revokeObjectURL`**）。原 `cloud/file/index.vue#download(row)` 为「点击后立即 revoke」写法（P4d 已确认在部分浏览器会取消下载），本轮删除该内联实现与 `FolderView.vue` 的私有 `saveBlob`，三处（单文件下载 / 管理侧打包下载 / 分享页整包下载）统一复用
2. **Element Plus 全局中文**（`web/src/App.vue`）：最外层 `ElConfigProvider + zh-cn`。根因——组件经 unplugin 按需自动引入，项目从未 `app.use(ElementPlus)`，函数式弹窗（ElMessageBox/ElMessage）读全局配置，故只能由 ConfigProvider 注入；修后所有确认框按钮为「取消/确定」
3. **`router/guard.ts`**：移除两条 debug `console.warn`（含整张路由表 JSON dump），正常导航不再刷 console
4. **`ElMessageBox.confirm` 取消语义**：取消以 Promise reject 结束，新代码必须 `try/catch` 吞掉，否则 Vue 报「Unhandled error during execution of component event handler」（本轮新增的对账修正按钮已按此写；既有页面（用户删除等）同名写法未动，登记 PROGRESS 遗留）

### 19.5 P4e 走查补丁 W1~W4（T66，纯文档）

| 编号 | 目标（按 P4e 走查报告 §6.3 更新后的最终态）                                                           | 结果                                                                                                |
| ---- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| W1   | API.md §6.2 删 mine 三行 + mediaFolderId 来源改站点详情 + `mine/apply-template` 行删除 + 段首迁址注   | 已套（§6.2 段首注迁 §10.2；§7.2 保留静态 templates 行并加迁址注）                                   |
| W2   | ARCHITECTURE 四处 mine 残留改 `/api/site/manage/*`（§14.1 目录注释、§15.1 controller 注、§15.7 流程） | 已套（另把 §15.7 的 40101 语义同步为 40119，与 T61 实现一致）                                       |
| W3   | 三处错误码总表收齐 30020 / 40118 / 40119（ARCHITECTURE §4.7、§14.11 + §4.8 范围表述、API.md 总表）    | 已套（§14.11 补 40118/40119 并注明 40117 属 P4c 开放层码故不连续；API.md site 段改为 40113~~40119） |
| W4   | §1 技术表 winston 行失实修正                                                                          | 已套（改 Nest Logger + winston 未接入说明）                                                         |
| R62  | 用户管理「配额」（云盘）按钮去掉 admin 行守卫（保留 v-permission）                                    | 已套（与 P4e「站点配额」同款修法；浏览器实测 admin 行出现该按钮）                                   |

### 19.6 演进预留（本期不做，架构不堵路）

| 项                       | 触发条件   | 预留设计                                                                                            |
| ------------------------ | ---------- | --------------------------------------------------------------------------------------------------- |
| 回收站保留天数分用户配置 | 用户诉求   | 现为全局配置（D58）；如需 per-user，可照 `cloud_usage` 先例加列/加表，`cleanExpired(days)` 已参数化 |
| 对账自动修正             | 运维诉求   | 现为显式管理动作（R61）；如需自动化，把 `reconcileFix` 的写入段挂到 cron 即可，但会失去人工确认     |
| 清理并发锁               | 多实例部署 | 现按单实例不加锁（R59）；多实例时需加分布式锁或改用 DB 抢占式扫描                                   |

---

## 23. P7 走查补丁（W1~~W7：站点与云盘 7 项实测缺陷 / 体验修复）

> 来源：用户实测反馈（2026-09-18）。任务记录见 PROGRESS「P7 走查补丁」小节；接口契约变更同步 API §9.5。
> 原则：不改契约的只动前端；必须动契约的（提取码回显）以「加列 + 加返回字段」的兼容方式落地，旧数据不迁移、不报错。

### 23.1 W1 站点列表 404（菜单数据未同步）

- 现象：站点设置页 / 站点切换器点「站点管理」跳 `/site/site` → 404。
- 根因：业务页路由由 `userinfo.menus` 动态注册（`web/src/router/dynamic.ts`）。线上库缺 P4E 新增的「站点列表」菜单记录（该环境未执行 seed），组件虽在产物中却从未注册路由，导航落到 catch-all 404。
- 两层修复：
  1. 部署侧：`deploy.sh` 新增 `[6/8] 菜单/权限种子同步（幂等）`，在 `migrate deploy` 之后执行 `npx tsx prisma/seed.ts`。seed 按 `parentId + name` 判重、只补缺失项；失败仅醒目告警不阻断本次部署（代码更新仍生效）。
  2. 前端防御：`SiteSwitcher` 与站点设置页跳转前用 `router.hasRoute('site-site')` 预检，未注册时提示「菜单未同步」而非静默 404。

### 23.2 W5 提取码回显（可逆存储）

- 问题：提取码过去只存 bcrypt 哈希（D47/R42），不可逆 → 分享者无法查看自己设置的值。
- 方案：`cloud_share` 加列 `password_enc VARCHAR(255) NULL`（迁移 `20260918000000_cloud_share_password_enc`），与 `password_hash` **同存同改**：
  - 写：`create` / `updatePassword` 同时写哈希（访客校验链路不变）与密文；
  - 读：`GET /cloud/share/list` 的 `password`（仅本人列表）；`POST /cloud/share/:id/password` 回显本次设置值；
  - 密钥：`common/utils/secret-box.util.ts`（AES-256-GCM，iv12 | tag16 | ciphertext 的 base64），密钥由 `jwt.accessSecret` 经 SHA-256 派生，**不新增环境变量**；
  - 降级：密文缺失（历史数据）/密钥轮换/数据损坏 → 返回 `null`，前端显示「已设置（不可回显）」，不抛错、不阻断列表。

### 23.3 W4 预览加固（mp4 转圈 / 类型误判）

私有预览 `GET /cloud/file/preview/:id`（R7 白名单，inline + Range）：

- **Content-Type 兜底**：库里 `mime` 为空或为 `application/octet-stream` 时按扩展名推导（复用 `resolvePubMime`：mp4→`video/mp4`、png→`image/png`）；否则 `<video>/<img>` 会因类型不符拒绝解码。
- **管道错误兜底**：`pipeStorage` 在读流 `error` 时 `res.destroy()`，避免响应既不输出数据也不结束（客户端永久挂起 = 一直转圈）。

前端 `views/cloud/file/index.vue`：

- 类型判定加扩展名兜底（`PREVIEW_VIDEO_EXTS` / `PREVIEW_IMAGE_EXTS`），与后端兜底同口径；
- 载入进度可见（`previewFileBlob(id, onProgress)` → `v-loading` 文案显示百分比与已传大小），大文件不再「无反馈转圈」；
- `<video>/<img>` 绑 `@error` → 明确提示「浏览器不支持该编码（如 H.265）」并给出「下载查看」按钮。

### 23.4 预览/下载直链票据（W7，已落地）

问题：私有预览/下载走 axios 全量 Blob —— 必须整包下完才能播放、无法拖动进度、整包驻留 JS 堆（大文件在移动端易崩）、每次预览都重新拉全量。

方案（两步、无状态）：

1. `GET /api/cloud/file/ticket/:id`（登录态 + `cloud:file:list`）→ 校验文件归属后签发**单文件**票据，返回 `{ previewUrl, downloadUrl, expiresIn }`（绝对路径，含 `/api` 前缀，供浏览器直连）；
2. `GET /api/cloud/file/stream/:id?ticket=&uid=&exp=&mode=inline|attachment`（`@Public` + `@SkipTransform`）→ 校验签名与过期后，**复用既有 `preview` / `download` 输出链**（白名单、Content-Type 兜底、Range/206、管道错误兜底全部同源，不写第二份实现）。

- 票据：`HMAC-SHA256(secret, "fileId.userId.exp")` → base64url；`uid`/`exp` 随 URL 携带（签名覆盖二者，篡改必然失败）；secret 复用 `jwt.accessSecret`，**无状态、不落库、零新依赖/环境变量**（`transfer/file-ticket.ts`）；
- TTL **2 小时**：必须覆盖整段播放/下载会话，否则中途的 Range 请求会校验失败；
- 安全边界：票据不是 access token，只对单个文件有效；校验失败统一按 30001 返回（不泄露存在性）；`timingSafeEqual` 恒定时间比较；nginx 访问日志不含查询串（P4E T64 脱敏口径），票据不落 access_log；
- 限流：该 `@Public` 端点单独放宽到 600 次/分/IP（拖动进度条会触发多次 Range 请求，避免挤占全局 300/分额度）；
- 前端：预览 `<img>/<video>/<iframe>` 直接用 `previewUrl`；下载用 `downloadByUrl(downloadUrl)`（浏览器原生下载，文件名走后端 `Content-Disposition`）；`@error` 时自动重取一次票据（应对 2h 过期），仍失败才提示并给下载出口；
- 保留 Blob 通道：在线编辑器读文本原文仍走 `previewFileBlob`（文本 ≤2MB 最直接）；批量打包下载仍是 POST + `saveBlob`（需请求体）。

### 23.5 W2 平台图标（公共资产）

- `web/public/favicon.svg`：矢量徽标（蓝→青渐变圆角方块 + 白色 i + 平台弧线）；`index.html` 引为 `icon` / `apple-touch-icon` 并设 `theme-color`；
- `web/src/components/AppLogo/index.vue`：同几何内联 SVG 组件（`size` prop），侧边栏（折叠恒显图标）与登录页复用；**禁止各页自绘 SVG 或回退 Element 内置图标**。

### 23.6 W3 / W6 前端行为

- W3：首次「分享管理」提交成功即关闭弹框（原先切到 detail 态）；需复制链接/延长/停止时再从列表行「分享管理」进入（后端 `findActiveShare` 保证幂等取现存链接）。
- W6：公开链接页状态筛选默认「有效」（`filterStatus = 1`），下拉仍提供 全部 / 已过期 / 已停止。

## 24. P8：文章创作增强（文件导入 + 一键排版）

> 决策：导入仅支持 Markdown / TXT（零新依赖）；排版默认「结构 + 标点 + 中英间距」三档全开；
> 应用方式为 diff 预览后确认；本期不给 AI 加工具（AI 对话当前无附件上传能力：chat DTO / 上游组装 / `ai_message` 表均无附件字段，已核实）。
> **零新依赖、零数据库变更、零错误码新增**；新增 2 个接口 + 2 个前端公共组件。

### 24.1 接口（site 域，均只解析/排版，不落库）

| 方法 | 路径                     | 权限                | 说明                                                                                                                                              |
| ---- | ------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST | /api/site/article/import | site:article:create | body `{ fileId }`；经 CloudFacade 读字节 → 本域解析 → 返回 `{ title, contentMd, summary, wordCount, matchedTags, unmatchedTags, warnings, meta }` |
| POST | /api/site/article/format | site:article:update | body `{ contentMd, options? }` → `{ contentMd, changed, stats: { rules, lines, charsBefore, charsAfter } }`                                       |

两者都不写库、不挂 `@OperationLog`（读/变换语义、无副作用）；真正的落库仍走既有 create/update，权限与校验链完全不变。

### 24.2 导入解析口径（`article-import.parser.ts`）

- 白名单 `md / markdown / txt`；≤2MB；含 NUL 字节视为二进制拒绝（30012 / 30013 / 40001）；
- 编码：UTF-8（剥离 BOM）优先；出现替换字符时用 GBK 试解并取替换更少的一方（`iconv-lite`，既有依赖）；
- 标题优先级：front-matter `title` → 正文首个 `# H1` → 文件名；被当作标题的 H1 从正文移除（避免页面标题重复）；超 100 字截断；
- front-matter 子集：`title` / `summary|description|excerpt` / `tags`（支持 `[a,b]`、`a, b`、`- a` 三种写法）；解析不了的行只告警忽略；
- TXT：首行 ≤60 字且不以句末标点结尾 → 视为标题并移除；否则标题落到文件名；
- 标签：只回**名称**，Service 侧匹配平台已有标签（`matchedTags` / `unmatchedTags`），**不自动创建**；
- 返回 `warnings`（编码回退、未识别标题、front-matter 异常行、正文为空等），前端逐条提示。

### 24.3 排版规则引擎（`markdown-format.ts`）

- **保护区机制**：代码围栏、行内代码、图片/链接地址、自动链接、行内 HTML、`$...$` 先抽成占位符（`\u0000n\u0001`），所有规则只作用于纯文本，处理完原样还原 —— 避免把 URL 里的 `_` 当强调符、把代码当"中英混排"；
- 三档可分别开关（默认全开）：① 结构规整（行尾空白、标题/引用空格、列表符号统一 `-`、**按块重建块间空行**、文末单换行）② 标点（`__x__`→`**x**`、`_x_`→`*x*`、中文语境 `...`→`……`）③ 中英间距（汉字 ↔ 字母/数字补一个空格）；
- **为什么按"块"重建空行**：markdown 中"列表后紧跟非缩进行"会被解析为列表项延续（lazy continuation），逐行插空行容易漏判；分块重建可从结构上杜绝，同时保证段内、列表项之间、引用行之间不插空行；
- **幂等**：重复排版结果一致；空文档原样返回；
- 明确不做：标题层级强行调整、表格分隔行对齐、半角→全角标点转换、英文 `...` 替换、行宽折行（避免有损或风格争议）。

### 24.4 前端交互

- **FilePicker**（新公共组件）：单层下钻云盘、按扩展名白名单过滤，只产出 `{ id, name, ext, size }`，不读内容、不落库；
- **DiffView**（新公共组件）：只读双栏 diff（`@codemirror/merge` 动态 import，文章页首屏不加载编辑器依赖），`@opened` 挂载 / `@closed` 销毁，随弹窗生命周期；
- 导入入口：工具栏「导入文件」下拉 = 从云盘选择 / 上传本地文件；**本地上传先落到云盘根留档**再解析（不丢源文件）；填表时逐项确认覆盖（标题不同才问、正文非空才问、摘要只在空时补）；
- 排版入口：工具栏「一键排版」→ 服务端返回结果 → 无改动直接提示；有改动则打开 DiffView → 点「应用排版」才写回 `form.contentMd`（textarea 原生撤销可回退）。

### 24.5 域边界

`SiteArticleModule` imports `CloudFacadeModule`，读文件只经门面。CloudFacade 新增：

```
readTextFileById(userId, fileId, { exts, maxBytes, purpose })
  → 以 fileId 定位（前端选择器给的是 id，不必先拼路径）
  → 白名单与体量上限由调用方传入（cloud 域不硬编码别的域的导入口径）
  → 返回原始字节（编码探测属"文章语义"，留在 site 域）
```

### 24.6 明确不做（本期）

- HTML / Word 导入（需转换器或新依赖，未特批）；
- ~~AI 侧两个工具（`import_site_article` / `format_site_article`）~~ → **已于 P9 T92 接线**（见 §25.3）；
- **AI 对话附件上传**：属独立需求（需上传入口 + `ai_message` 附件列 + 上游多模态 content 组装 + 类型白名单与配额）。

## 25. P9：收尾小包（走查清账 + AI 导入/排版接线 + 排版快照 + 站点 SPA 开关）

> 来源：`docs/P8P9/PRD-P9-收尾小包.md`（Kimi，2026-09-18）+ `docs/P7/P7-走查报告.md` §4~§6。编号：D79~~D81 / R79~~R81 / T91~~T94。
> **零新依赖、零 DB 变更、零新错误码、零新 HTTP 端点**（`PUT /api/site/manage/:id` 只是加请求字段）；AI 工具 28 → **30**。

### 25.1 决策（D79~~D81）

| 编号 | 决策                 | 落地要点                                                                                                               |
| ---- | -------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| D79  | AI 导入/排版工具接线 | 新增 `import_site_article` / `format_site_article`（均 **read 级**、不进确认卡），包装 P8 纯函数模块，工具内零业务复写 |
| D80  | 排版前快照 = 纯前端  | 不进后端与 DB；内存 + `localStorage` 双层，只留最近一份（R80）                                                         |
| D81  | SPA 回退按站可配     | 站点设置页开关写 `site_site.spa_fallback`（`'index.html'` / `NULL`），NULL = 关闭 = 与 P7 前一致                       |

### 25.2 T91 走查遗留清账（C1/C2/C3 + H1/H2）

**C1 目录 301 与回退链优先级 —— 口径澄清，零代码改动。** 实现早已是「真实目录优先」，`open-static.controller.ts` 顺序为：
① 根请求无斜杠 → 301 补斜杠；② `resolvePath` 直命中；③ `tryDirectoryRedirect`（目录有 `index.html`：带斜杠直出 / 无斜杠 301；目录存在但无 `index.html` → 40400）；
④ **仅当 ③ 判定「不是真实目录」**才进 `tryPrettyFallback`（补 `.html` → `spa_fallback`）。R4 的 301 语义完整保留，回退链的目录级只兜虚拟路径（如 `/article/9`），
故无 `<base>` 的自定义 MPA 模板不会拿到错误资源基址 → 已补口径（§22.5 纪律条 + API §14.6）。

**C2 评论写入口径 —— 确认，零代码改动。** `SiteOpenService.submitComment` 首行即 `assertPublishedArticle(siteId, articleId)`
（`status=1` + `site_article_publish` 内连接），未发表到本站 / 草稿 / 文章不存在一律 **40400**，与读路径完全一致 → 已补 API §14.5 与 §22.6。

**C3 迁移回滚演练 —— 登记豁免。** P7 迁移有 `mysqldump` 备份记录，且已在生产数据上成功执行并稳定运行，
事后无法补做「人为制造校验失败 → 整体回滚」演练 → 按走查报告 §4 建议登记豁免（见 PROGRESS 挂账）。

**H1 40112 / 40120 —— 按代码校正文档，不废弃任一码。** 核对代码后确认两码**语义不重叠且均活跃**：
`site.hasSite` → **40112（有站点）**、`site.hasContent` → **40120（无站点但有内容）**；手册此前把 40120 写成「仍有站点」才产生「同义并存」的错觉。
处理：错误码表补登 40120 并写明分工与预检链（§5 表注）、§22.4 与 API §14.4 同步更正。

**H2 命名漂移。** `docs/P7/PRD-P7-CONTENT-POOL.md` 文件头加「别名说明」；全仓 3 处旧引用
（PROGRESS P7 行、API §14 前言与系列表）统一改回 CONTENT-POOL；PROGRESS T85 行的乱码串一并清除。

### 25.3 T92 AI 导入/排版接线（D79/R79）

两工具均**只解析/排版、不落库、不出确认卡**（read 级），复用 P8 已落地的纯函数模块（零业务复写）：

| 工具                  | perms                 | 入参                                          | 返回                                                                          | 复用链                                                                                 |
| --------------------- | --------------------- | --------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `import_site_article` | `site:article:create` | `{ path?, fileId? }`（二选一，**path 优先**） | `title / contentMd / summary / matchedTags / unmatchedTags / warnings / meta` | `SiteFacade.importArticle` → `importFromPath` / `importFromFile`（与 REST 同一解析链） |
| `format_site_article` | `site:article:update` | `{ contentMd, options? }`                     | `{ contentMd, changed, stats }`                                               | `SiteFacade.formatArticle` → `articleService.formatContent`                            |

> **实测修订（2026-09-19 AI 冒烟）**：初版只收 `fileId`，但 `list_cloud_files` 按 P5 设计只回 `name/path`、**不回 id**——
> 模型列完目录也喂不进参数（实测连调 3 次目录后卡住）。故补 **path 寻址**：`CloudFacade.readTextFileByPath`
> （逐段下行解析后**复用 `readTextFileById`** 的白名单/上限/读盘链，无第二份实现）+ `SiteFacade.importArticle` 双寻址 +
> `article.service` 抽出 `importFromBytes` 单一解析链；`fileId` 保留不变（REST `POST /site/article/import` 契约零改动）。

- 归组 `siteCms`；`KEYWORD_TO_GROUPS` 文章词根补 `导入|排版|format`；
- 能力清单：两工具分别挂到既有能力行 `site.article.create` / `site.article.update`（perms 与工具完全一致，R69）；**工具总数 30**；
- **口径纪律（R79）**：`format_site_article` **不返回 diff 视图**——description 明确要求模型自行核对或复述 `stats.rules`，不得声称有可视化对比；
  两工具均提示「是否采用由用户确认后再走 `create_site_article` / `update_site_article` 落库」；
- 核查：`pnpm check:ai` **16/16**（工具 30 / 能力清单 804/1200 / 通用版 970/1000 / 合注 1825/2000）；真实链路 `pnpm smoke:ai` 实测 F/I 两项均 `executed`（见 §25.6）。

### 25.4 T94 站点 SPA 回退开关（D81/R81）

- **接口**：`PUT /api/site/manage/:id` 请求体加 `spaFallback?: 'index.html' | null`（DTO `@IsIn` 收口，其他值 40001）；
  站点视图（`GET /api/site/manage/list` 与 `/:id`）新增 `spaFallback` 字段供开关回显；
- **缓存**：复用既有 `resolveService.invalidateSite(slug)`（`site:resolve:{slug}` 缓存内含 `spaFallback`），变更后**无需重启即生效**；
- **不变量**：`NULL` = 关闭 = 与 P7 前行为完全一致；开启后无扩展名路径回退到 `index.html`，**带扩展名仍严格 40400**（R78 不变）；
- **前端**：站点设置页新增「SPA 回退」开关；开启前读站点根 `app.js` 判断模板版本——新版（D78）含 `history.pushState`，
  旧 hash 路由版则先弹确认并提示「需重新应用模板并刷新地址」，**不自动重应用**（重应用会覆盖自定义修改，必须用户显式触发 apply-template）。

### 25.5 T93 排版前快照（D80/R80）

纯前端、不进后端与 DB：

- 键 `iplat:fmt-snapshot:{articleId|'new'}`，值 `{ contentMd, ts }`，**只留最近一份**（不做版本历史）；
- 写入：点「应用排版」时写入（覆盖旧份）；清除：文章保存成功、编辑器关闭（`@closed`）、离开文章页（`onBeforeUnmount`）；
- 读取：内存优先 → `localStorage`；刷新页面后重新打开编辑器时按钮仍在（双层兜底价值）；`localStorage` 不可用（隐私模式 / 配额满）静默降级为仅内存；
- UI：应用排版后工具栏出现「撤销排版」，点击把快照正文放回 textarea 并消费快照，textarea 原生撤销栈不受影响。

### 25.6 验收与不变量

- 接口三场景逻辑链逐条核对（§25.2 C1）：`/about`（真实目录无斜杠）→ 301；`/article/9`（虚拟路径）→ 回退 200；`/missing.js`（带扩展名）→ 40400；
- 存量站点（`spa_fallback IS NULL`）行为零变化；
- `pnpm --filter @iplat/api check:ai` 16/16；`tsc` / `vue-tsc` / ESLint 零错；
- **可重跑冒烟（T95）**：`pnpm --filter @iplat/api smoke:ai` —— 真实对话 + `ai_tool_call` 落库断言（本轮实测 F #134 / I #135 均 `executed`）；「改了工具链就必须跑」的触发条件与判据见 PROGRESS「AI 冒烟清单」。

## 26. P10：AI 对话附件上传（文本类）

> 来源：`docs/P10/PRD-P10-AI-ATTACHMENT.md` + `ARCHITECTURE-P10-增补.md` + `API-P10-增补.md`（Kimi，2026-09-19）。编号：D82~~D86 / R82~~R87 / T96~~T99。
> **零新依赖、零新 HTTP 端点、零新错误码**；AI 工具 **30 不变**（`read_cloud_file` 签名变更）；**DB +1 列**（`ai_message.attachments`）。
> 行业事实：大模型 API 没有通用附件概念（DeepSeek 只收图片、文档须应用侧解析成文本注入），「解析 + 注入」是标准架构而非绕道。

### 26.1 数据模型（T96 / D82）

```sql
ALTER TABLE ai_message ADD COLUMN attachments JSON NULL
  COMMENT '附件元信息 [{fileId,name,ext,size,chars,mode,path}]，mode=inject|listed；仅存元信息不存内容';
```

迁移 `20260920100000_add_ai_message_attachments`（手写 SQL + `prisma migrate deploy`，纯加列无回填、零风险）：

- **只存元信息、不冗余内容**：历史轮次重组装时按 `fileId` 重读云盘（§26.3）；
- 源文件被删/无权/超限 → 该附件在组装时降级为占位「（附件已失效）」或标注 invalid，**不报错、不阻断对话**（验收 6）；
- Prisma 侧 `AiMessage.attachments Json?`；读取一律经 `parseStoredAttachments`（JSON 列不可信，单项非法即丢弃）。

### 26.2 附件解析链（T96 / D86 / R82）

新增 `modules/ai/chat/attachment-resolver.ts`（纯函数 + 门面注入，零 Nest 依赖）：

```
resolveAttachments(cloudFacade, userId, [{fileId}])
  → CloudFacade.readTextFileById（属主/未删/非目录/白名单 30012/≤2MB 30013，一次到位）
  → 二进制嗅探（窗口内 NUL 字节 → 30012）
  → 编码探测（UTF-8 剥 BOM 优先，替换字符多则 GBK 回取）
  → CloudFacade.pathOfUserFile（元信息里的 path，供清单与 read_cloud_file 寻址）
  → { meta, text }[]
```

- **域边界**：ai 域不直接查 `cloud_file`、不直接读盘，全经 CloudFacade（铁律 6）；本次为其新增两个门面方法——
  `pathOfUserFile(userId, fileId)`（有界上溯 ≤10 层拼相对云盘根路径）与 `filterAliveFileIds(userId, ids)`（批量有效性判定，不读盘）；
- **编码探测**属「文本语义」，与 P8 §24.5 同口径但**在 ai 域侧实现**（跨域 import site 域内部解析器违反铁律 6，故为受控重复）；
- 附件上传（本地路）复用云盘既有 upload 链路落 `/ai-attachments/`（D84）：前端先调上传接口（自动建目录、配额记账、同名 "(1)"），再把返回 `fileId` 放进 chat body——**后端零新端点**；
- 类型白名单 32 项（D86）：txt/md/markdown/json/js/ts/jsx/tsx/vue/css/scss/xml/yml/yaml/log/csv/html/htm/py/java/go/rs/c/cc/cpp/h/hpp/sql/sh/bat/ini/conf/toml。

### 26.3 双模式分流与注入组装（T96 / D83 / R83 / R84）

`planAttachmentModes(resolved)` 按用户选择顺序逐条判定，组装顺序 = system → 历史 → 当前 user：

1. **inject**：单文件 ≤30,000 字符 **且** 本条累计 ≤60,000 字符 → 全文注入该条 user 消息**前部**，格式 `【附件 {name}】` + fenced code block；
2. **截断注入**：单文件 >30,000 字符但累计帽内仍有空间（余量 ≥1,000 字符，见 §26.9-3）→ 注入前 N 字符 + 尾部标注「（已截断，完整文件已列入可读清单，路径 {path}）」，**同时进清单**（记 `mode='listed'`：前端标签与「需自读」语义一致）；
3. **listed**：不注入正文，仅登记；模型按需 `read_cloud_file` 自读。

**会话可读清单（R84）**：本会话所有 user 消息附件的**并集**（去重按最近优先、失效标注、上限 20），随每轮 system 动态追加：

```
用户本会话附带文件（可用 read_cloud_file 按路径分段读取，单次 ≤2 万字符；未读前不得猜测文件内容）：
- {path}（{name}，{chars} 字符）
```

清单属动态上下文，**不计入手册 2000 字帽**（`check:ai` 只核手册/能力清单两段）；确认回填链路同样注入（§26.7）。

### 26.4 预算扣减（T96 / D85）

P5 预算动态化扩一项（`computeHistoryBudget`）：

```
history 预算 = max_context − 输出预留(25%) − system（含可读清单） − tools schema − 当前消息 − attachments
```

- `attachments` = 本条消息 inject 实算字符（`【附件】头 + 正文`）；清单文案已并入 system 段（不重复扣减）；
- 下限保护 2000 不变；`DEBUG_AI=1` 日志新增 `attachmentsBudget=` 字段；
- attachments **无下限保护**——超限场景由 D83 分流在注入前消化，不走预算硬切。

### 26.5 read_cloud_file 分页（T97 / R85）

| 项          | 变更                                                                                            |
| ----------- | ----------------------------------------------------------------------------------------------- |
| parameters  | 加 `offsetChars?`（默认 0）、`maxChars?`（默认 20000，上限 50000）                              |
| 返回        | 加 `totalChars` / `truncated` / `nextOffset?`，并回显实际 `offsetChars`（便于模型自我核对）     |
| description | 补「大文件请分段读取：先读开头判断结构，truncated=true 时用 nextOffset 续读，不得假定已读全文」 |

- **旧调用兼容但行为变化**：不传分页参数等价于 `offsetChars=0, maxChars=20000`（原先默认返回全文 ≤64KB），description 与手册（PLATFORM-GUIDE「工具使用原则」）均已写明，避免模型误以为读到全文；
- 切片在**工具层**（读链返回全文文本，切片零成本）；**AI 云盘读上限由 64KB 放宽到 2MB**（`AI_CLOUD_READ_MAX_BYTES`）——`read_cloud_file` 是清单自读的唯一通道，上限若仍是 64KB，>64KB 的附件列进清单后模型永远读不到（K 用例实测暴露，§26.9-9）；上下文安全改由工具分页承担；
- KEYWORD_TO_GROUPS 不变（cloud 组既有）；能力清单 `cloud.read` 行文案同步改「默认只回开头 2 万字符，大文件按 nextOffset 分段续读」；
- **工具定义变更 → 必跑 `pnpm smoke:ai`**（T95 触发条件表），本期已跑（§26.9）。

### 26.6 前端（T98 / R86 / R87）

- 输入区：回形针下拉（从云盘选择 → 复用 P8 `FilePicker`；上传本地文件 → 复用 `uploadFile`）+ 待发 chips（图标 + 名称 + 大小 + ×移除）；
- **本地文件仅暂存内存**，**发送时**才上传留档到 `/ai-attachments/`（目录不存在自动创建；未发送不占云盘）；上传失败则整条不发出、chips 保留可重试；
- 气泡：用户气泡底部附件行（图标 + 名称 + listed 标「AI 按需读取」）；历史消息同源渲染；失效附件置灰 + 「源文件已删除」；附件**纯展示不做跳转联动**；
- 前端常量与后端同源副本：`web/src/views/ai/utils/attachment.ts`（白名单 / 2MB / 5 个 / 目录名），只做体验级预校验，真正校验链在后端。

### 26.7 SSE 与确认链兼容

- chat SSE **事件类型不变**、流式输出与工具确认回路零影响；附件仅影响**组装**；
- `meta` 事件**兼容扩展** `attachments` 字段（本次附件元信息，含 inject/listed 分流结果），前端据此渲染权威模式标签（§26.9-1）；
- 确认后重发（confirm 链）重组装历史时附件重读——内容可能已被用户编辑，语义即「以最新文件内容继续」（可接受）；失效降级同 §26.1。

### 26.8 演进方向（登记不实施）

| 项                  | 触发条件                     | 预留设计                                                                                           |
| ------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------- |
| 二期图片/多模态附件 | 厂商模型表加 vision 能力标记 | 组装层对 vision 模型产 content 数组（text + image_url/base64），非 vision 模型拒收并提示；前端预览 |
| RAG / 摘要接力      | 清单自读实测效果差           | 侧录 prompt 措辞先调（PRD 验收 2 的唯一不确定性）                                                  |
| 附件用量分析        | 需要时                       | `ai_message.attachments` 已有元信息，统计零成本                                                    |

### 26.9 实现偏差与验证登记（T99）

| #   | 项                                             | 说明                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | meta 事件扩展 attachments                      | 增补文档写「SSE 事件流格式不变」；实现保持事件类型与既有字段不变，仅**兼容扩展** meta 的 `attachments`（否则前端无法知道后端分流结果，模式标签只能靠猜）                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 2   | 历史 inject 附件才重读                         | §26.3「历史轮次重组装时按 fileId 重读」按 `mode` 收口：`mode='inject'` 才重读正文，`listed` 不重读（清单已给路径，模型按需自读）——避免每轮对全部历史附件无谓读盘                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 3   | 截断注入最小余量 1000 字符                     | 增补文档只说「余量仍有空间」，实现补 `INJECT_TRUNCATE_MIN_CHARS=1000`（注入 1~999 字符的尾巴无意义，直接 listed）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 4   | attachmentsBudget 口径                         | 增补文档写「inject 全文 + 清单文案」；实现把清单并入 system 段计入 `systemChars`，`attachmentsBudget` 只记 inject 实算字符——**总额等价，避免重复扣减**                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 5   | 编码探测受控重复                               | 与 P8 §24.5 同口径，但 ai 域侧自带实现（跨域 import site 域内部解析器违反铁律 6）；后续如提公共工具再统一                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 6   | 冒烟脚本 SSE 解析修正                          | `scripts/smoke-ai-tools.ts` 原先按 `event:` 行解析（后端实际只发 `data: {json}`），done 判定一直靠流关闭兜底；本期修正为解析 data 内的 `type`（新增用例依赖 meta/content）                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 7   | 冒烟附件夹具复用                               | 夹具落 `/ai-attachments/smoke-attach-*.txt`（固定名 + 固定核对码），**已存在则复用**——云盘软删不释放 used（R2 语义），反复重建会持续蚕食配额；三个夹具合计约 **2.15MB**（inject 1.7KB / listed 103KB / big 2.0MB，末者为校验链 30013 用例）                                                                                                                                                                                                                                                                                                                                                                |
| 8   | 手册字数再平衡                                 | 加「读大文件用 read_cloud_file 分段读，未读前不臆测」的同时等量精简既有条目：通用版 **980/1000**、能力清单 **832/1200**、合注 **1863/2000**                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 9   | AI 云盘读上限 64KB → 2MB                       | 增补文档写「CloudFacade 读取链不动（文本已 ≤2MB 入内存）」，但实现里 `AI_CLOUD_READ_MAX_BYTES` 实为 **64KB** → 大附件列清单后模型**读不到**（K 用例 3 次尝试均回喂 30013，实测暴露）；故放宽到 2MB 与附件口径（D83）一致，上下文安全由工具分页承担。**注意 `read_site_file` 仍维持 64KB（40115），本期未动站点读口径**                                                                                                                                                                                                                                                                                     |
| 10  | 截断点 = min(单文件帽, 剩余帽)                 | 增补文档只写「总量帽内仍有空间即允许截断注入」；若直接按剩余帽截断，3.5 万字符文件（剩余 6 万）会被**全量注入却标注已截断**（验收 3 实测暴露）。故截断点取两帽较小者，单文件帽同时是「全文注入」的判据                                                                                                                                                                                                                                                                                                                                                                                                     |
| 11  | 冒烟 I 用例候选过滤                            | 新增的 2MB 大文件夹具会顶掉既有 I 用例的文件候选（导入链上限 2MB → 30013）；故候选查询排除附件夹具目录并限体积 ≤2MB，保证 F/I/J/K 四用例互不干扰                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 12  | **收尾轮 + 工具往返预算护栏（交付后修复 W1）** | 交付后实测发现两个叠加缺陷：① `maxToolRounds=3` 用尽即 `break`，**模型从未见到最后一批工具结果**也没机会作答 → 用户看到「AI 读取文件后莫名其妙停了」（admin 会话 #111：6 次 `read_cloud_file`、正文仅 16 字）；② 工具往返字符**不参与任何预算**，`tokens_input` 已达 **118,865 / 128,000**，再读一两轮必被上游以超上下文 400 拒绝。修复：抽出 `runToolRounds`（chat / confirm 两链共用）——轮次用尽 **或** 工具往返 > `max_context × 40%` 时追加**收尾轮**（不携带 tools 再调一次，指令要求基于已读内容给结论、说明还缺什么）。复测同场景：2 段读取后收尾，输出 **3,207 字**完整总结，`tokens_input` 46,458 |

**验收对照（PRD §4）**：小附件注入（1）/ 大文件自读（2）/ 截断标注（3）/ 校验链 30001·30012·30013·40001（4）/ 预算扣减（5）/ 失效降级（6）/ 前端四态（7）/ 回归（8）——
**全部实测通过（2026-09-20）**：1·2·8 由 `pnpm smoke:ai` **4/4** 覆盖（真实模型 + `ai_message.attachments` 与 `ai_tool_call` 落库断言，K 用例证明模型主动分段读到文件末尾）；
3·4·6 由一次性验收脚本 **11/11** 覆盖（分流纯函数四组断言 + 四条错误码 + 删除源文件后 `invalid=true`）；5 由 `DEBUG_AI` 预算日志与组装链核对；
7 由 agent-browser 真机复验（chips 增删 / inject 无标签 / listed 标「AI 按需读取」/ 历史渲染 / 失效置灰 / 本地上传留档 + 配额记账）；
累计消耗积分 **1110**、测试数据已清理（详见 PROGRESS「P10 任务拆解」实测记录）。

## 20. AI 能力扩展（P5）：云盘/CMS/生命周期工具 + 预算动态化（自 docs/P5/ARCHITECTURE-P5-增补.md 并入；增补文档保留为历史细节参考）

> 编号与 `docs/P5/PRD-P5-AI.md` 对齐（D62~~D66 / R63~~R68 / T71~T76）。**零新 HTTP 端点、零新错误码、零新依赖**：
> 工具经既有 SSE 通道（`/api/ai/chat` + `/api/ai/tool/confirm`）交互，回喂复用各域既有码；预算走配置项。
> 工具总数 **11 → 25**。

### 20.1 门面扩展（T71，全部既有服务委托，工具零业务逻辑）

**SiteFacade 新增 CMS 层 + 生命周期**（同域直注 article/column/tag 三服务，照 T44 模板先例；SiteFacadeModule 增 imports SiteArticleModule / SiteColumnModule / SiteTagModule，三模块随之 `exports` 自身 Service）：

```
listArticles(userId, siteId, { columnId?, status?, keyword?, pageNo?, pageSize≤20 })  → { list, total, pageNo, pageSize }
readArticle(userId, id)                → 全文（含 contentMd；超 64KB 截断 truncated=true）
createArticle(userId, siteId, input)   → 行（默认草稿；tagNames 走 ensure）
updateArticle(userId, id, input)       → 行（部分更新）
publishArticle(userId, id, status)     → 行（published_at 口径沿用）
ensureColumn(userId, siteId, {name, parentId?}) → { id, created }（幂等：同名同父命中即复用）
ensureTags(userId, siteId, names[])    → [{ id, name, created }]（批量幂等）
listColumns / listTags(userId, siteId)  → 确认卡摘要与 columnId 引导清单
updateSite(userId, siteId, input)      → 委托 manage.update
getSiteDeleteImpact(userId, siteId)    → { slug, articles, columns, tags, comments }（R66 计数预检，只读）
deleteSite(userId, siteId)             → 委托 manage.remove（{ deletedArticles, recycledRoot }）
```

> **与增补文档的偏差（以代码为准）**：增补 §20.1 草图画的是「facade 收 `slug?` 并内部 resolveSite」。
> 落地改为**工具层经 `resolveSiteForTool` 解析 slug → facade 一律收 siteId**：R56 四分支的结果是
> 「回喂对象」（0 站引导 / 多站 needSitePick / 查无 40119+列表），属工具层语义，不应漏进域门面（§20.2 亦称
> 三件套与 CMS/生命周期工具全走 resolveSiteForTool）。这样门面保持纯域操作、可被其他模块直接复用。

**CloudFacade 新增云盘根基点原语**（基点 = 用户云盘根 `parent_id=0`，虚拟根无实体行；校验纪律与站点原语相同）：

```
listUserFiles(userId, { path?, recursive? })  → { path, items[{name,path,isDir,size,ext,updatedAt,inSite}], truncated?, quota{used,limit} }
readUserFile(userId, path)                    → 文本白名单 + ≤2MB（P10 T97 由 64KB 放宽，配合 read_cloud_file 分页）
writeUserFile(userId, path, content)          → 复用 writeFileRaw 全链（mkdir -p / R6 / 温和覆盖 / used 记账 / 配额 30003）
moveUserFiles(userId, moves[{from,to}])       → 逐条 { from, to, finalPath, ok, error?, targetPublic? }
deleteUserFiles(userId, paths[])              → 逐条 { path, ok, error? }
isUserDirPublic(userId, path)                 → 供 move 确认卡预判「目标在公开目录」（R39 三态上溯同口径）
```

- 机械原语最小改造：`listSubtreeRaw` / `readFileRaw` / `writeFileRaw` 抽出共用的 `walkSubtree` /
  `findEntryByBase` / `readFileByBase`，并支持 `rootFolderId=0`（用户云盘虚拟根）；站点侧行为逐字不变
- `EDITABLE_TEXT_EXTS`（原 file.service 私有常量）加 `export`，云盘原语读写白名单复用同一集，单一来源
- CloudFacadeModule 增 `imports: [SiteRootModule]`（inSite 标注需要站点根集合；SiteRootModule 零跨域 import，不成环）
- **R64 路径口径**：空段 / `.` / `..` / 绝对路径 / 反斜杠 / 单段 >64 / 深度 >10 一律拒绝（30001；深度超限 30006）；
  文本白名单外 30012；读 >2MB（P10 T97 由 64KB 放宽）、写 >256KB 30013；`move` 的 `to` 为**目标目录路径**（保留原文件名移入、自动 mkdir -p，
  空串 = 云盘根）；批量上限 20（`AI_CLOUD_MAX_BATCH`）
- **move 的 R39 偏差**：管理端 move 有「移入公开目录二次确认」交互，AI 工具无此交互位——确认卡即用户确认动作，
  故 `moveUserFiles` 直接带 `confirmPublic: true` 执行并在结果中标注 `targetPublic=true`，不阻断
- **write 白名单口径**：AI 写只允许文本白名单扩展名（R64「单文件 ≤256KB 文本」；非目标明确「AI 上传二进制文件」不做）

### 20.2 AI 工具注册（T72~T74：tools/ 下加文件 + bootstrap 注册 + ToolModule imports CloudModule）

- 工具总数 25：P2b 七个 + P4b 站点文件三件套 + P4e create_site + **P5 十四个**（云盘 5 / CMS 7 / 生命周期 2）
- handler 只注入域门面：站点系列 → SiteFacade；云盘五件套 → CloudFacade（零跨域 import 内部实现）
- **description 边界纪律（R63）**：`write_site_files`（站点目录内，影响线上站点）与 `write_cloud_file`
  （云盘任意路径，不影响站点）**互写对方名字做排除式描述**；`list_cloud_files` 注明「站点目录也在云盘内（inSite）、
  操作站点内容优先用 site 系列」；`read_site_file` / `read_cloud_file` 同样互指。25 个工具并存下防误选靠 description
- **perms 复用既有管理端点标识**（零新增权限、seed 零改动）：云盘 = `cloud:file:list` / `cloud:file:upload` /
  `cloud:file:delete`；CMS = `site:article:list|create|update|publish`、`site:column:create`、`site:tag:create`；
  生命周期 = `site:site:manage`
- **工具清单与风险级别**

| 工具                 | risk  | perms                | 要点                                                                                                                               |
| -------------------- | ----- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| list_cloud_files     | read  | cloud:file:list      | `{ path?, recursive? }`；返回条目（含相对路径与 inSite）+ 配额用量                                                                 |
| read_cloud_file      | read  | cloud:file:list      | `{ path, offsetChars?, maxChars? }`（P10 分页：默认前 2 万字符、上限 5 万，返回 totalChars/truncated/nextOffset）；文本白名单 ≤2MB |
| write_cloud_file     | write | cloud:file:upload    | `{ path, content }`；同路径温和覆盖（旧文件进回收站）；摘要复用「文件清单」表格（path/action/size）                                |
| move_cloud_files     | write | cloud:file:upload    | `{ moves[{from,to}] }`；批量 ≤20；站点根 30019 / 回收站 30019 全继承                                                               |
| delete_cloud_files   | write | cloud:file:delete    | `{ paths[] }`；**仅软删进回收站**；站点根 30020 拦截                                                                               |
| list_site_articles   | read  | site:article:list    | 分页摘要（无正文），pageSize ≤20                                                                                                   |
| read_site_article    | read  | site:article:list    | 全文（含 contentMd；超 64KB 截断）；交叉校验 slug 与文章实际站点一致                                                               |
| create_site_article  | write | site:article:create  | 默认草稿；status=1 摘要带「发布即公开可见」警示行；columnId 缺省时本站唯一栏目直达、否则回喂栏目清单                               |
| update_site_article  | write | site:article:update  | 部分更新；tagNames 提供即整体替换                                                                                                  |
| publish_site_article | write | site:article:publish | 上下架；上架摘要带公开警示                                                                                                         |
| ensure_site_column   | write | site:column:create   | 同名同父命中即复用（created=false）                                                                                                |
| ensure_site_tags     | write | site:tag:create      | 批量幂等 → [{id,name,created}]                                                                                                     |
| update_site          | write | site:site:manage     | `{ slug, title?, description?, newSlug?, status?, commentAudit? }`；改 slug / 停用的影响在摘要中明示                               |
| delete_site          | write | site:site:manage     | 摘要 = R66 三段影响 + 文章/栏目/标签/评论数；执行走既有删站级联                                                                    |

- **summarize 摘要形态**：新工具一律返回**字符串摘要（中文标签多行）**——
  `move_cloud_files` = 逐条 `from → to`（目标在公开目录的条目附「内容将对外可见」）；`delete_cloud_files` =
  路径清单 + 「移入回收站，可还原」；`create/update/publish_site_article` = 标题/栏目/标签/状态/字数（R14 经门面
  转出）+ 发布警示行；`ensure_*` = 复用/新建预判；`update_site` / `delete_site` = R66 三段；
  例外：`write_cloud_file` 复用既有「文件清单」表格形态（单文件，path/action/size），与 `write_site_files` 视觉一致
- **前端零改动**：`ToolConfirmCard` 现对「数组摘要」走固定 table（path/action/size）渲染、对字符串摘要走文本渲染；
  故新工具取字符串摘要即可正确显示，未新增专用模板（§20.4）

### 20.3 预算动态化（T75，§12.2 修订点；R67/R68/D65）

```
toolsBudget   = Σ(过滤后工具 schema 字符数)          // 每轮动态算，各人因权限不同而不同
systemBudget  = system prompt 实测字符数（PLATFORM-GUIDE 全文 + 用户上下文）
historyBudget = max_context − 输出预留(25%) − systemBudget − toolsBudget − 当前消息字符数
                ↓ 下限保护：historyBudget < MIN_HISTORY_CHARS(2000) 时保 2000 并 logger.warn
```

- 口径恒为「1 token ≈ 1 字符」（不引分词库，铁律 7 + 既有口径延续）；输出预留仍为 25%
- **system prompt 恒完整、tools schema 恒完整**，装不下时继续从最早历史消息丢弃（`pickHistory` 从最新往回装，
  装不下即停 ⇒ 等价于丢最早）；chat 路径与确认回填路径共用同一 `computeHistoryBudget` / `pickHistory`
- 每轮对话开头记一条 `logger.debug`（model maxContext / tools 数 / toolsBudget / systemBudget / historyBudget 实算值），
  预算不足时改记 warn，便于调优
- `ai.maxToolRounds`（env `AI_MAX_TOOL_ROUNDS`，默认 3、上限 10）替代原硬编码 `MAX_TOOL_ROUNDS`；每次现读，热改即生效
- **usage 兜底估算（R68）**：结算基数 = messages 全文 + tools schema + tool 往返消息（assistant 回喂内容 + tool 结果），
  同 1 token ≈ 1 字符；有上游 usage 时仍以上游为准；结算幂等键不变

### 20.4 前端

- `ToolConfirmCard` 保持通用渲染（数组 → 文件清单表格；字符串 → 文本），**未加任何专用模板**；
  摘要结构化由工具 summarize 保证（§20.2），新增工具不再改卡片
- 其余零变化（无新页面/路由/组件）

### 20.5 README.txt 与手册（PLATFORM-GUIDE）

- README.txt（站点模板契约）本期不动
- PLATFORM-GUIDE 压缩改写：合并系统管理罗列、为「云盘/文章/站点生命周期 AI 能力 + 文章默认草稿 + 删除边界」腾空间；
  **字符数硬门槛 ≤2000（UTF-8 字符口径，`[...text].length`）**，本期实测 **1976**

### 20.6 实现偏差与验证登记

| #   | 项                                                           | 说明                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | facade 收 siteId 而非 slug                                   | 见 §20.1 偏差说明（slug 解析留在工具层 resolveSiteForTool）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2   | 云盘 list 条目带 `path`                                      | 增补文档只列 name/isDir/size/ext/updatedAt/inSite；补 `path` 便于模型直接引用相对路径做 read/move/delete（避免自行拼接出错）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 3   | `listUserFiles` 自实现 BFS                                   | 增补文档写「复用 listSubtreeRaw」；因其返回类型（SubtreeEntry）不含 id/inSite，无法承载 inSite 逐层继承，故在门面内自实现同规则遍历（maxDepth 10 / limit 500 / truncated），规则与 listSubtreeRaw 逐条一致                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 4   | 文章 `contentMd` 64KB 截断                                   | 正文上限 20 万字符，直喂必爆上下文；按站点文件读口径截断并置 `truncated=true`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 5   | columnId 缺省策略                                            | 本站唯一栏目自动使用；多栏目回喂 40001 + 「名称(id=xx)」清单；无栏目提示先 ensure_site_column（不自动造栏目、不默认取第一个，避免写错栏目）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 6   | coverPath 未进工具参数                                       | 工具清单（PRD §4）未列 coverPath，AI 亦无法上传图片，故 create/update 文章工具不支持封面字段（R65 的 media/ 前缀校验在域内既有实现不变）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 7   | 确认卡摘要形态                                               | 见 §20.2/§20.4（字符串摘要 + write_cloud_file 复用表格）；增补 §20.4 描述的「通用 key-value」与现卡片实现（固定三列表格 + 文本）不一致，以代码为准                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 8   | 批量上限 20                                                  | 增补文档未给 move/delete 批量上限；取 20（AI_CLOUD_MAX_BATCH）与「单次 ≤10 文件」同量级，防模型一次性下发超大数组                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 9   | **真机验证发现并修复：连续 assistant 消息触发 DeepSeek 400** | 现象：真机链路（deepseek-v4-flash）中「第二次写工具确认卡之后的总结流」稳定 400（`The reasoning_content in the thinking mode must be passed back to the API`），错误文案误导性极强（与 reasoning 回传无关）。<br>受控实验定位（`ProviderService.streamChat` 直调，4 组对照）：C5 `user→assistant(tool_calls)→tool` 通过；C6 中间插入 user 通过；**C7 `assistant(文本)→assistant(tool_calls)→tool` 失败**；C8 把前置文本并入带 tool_calls 的那条 assistant 通过。<br>根因：确认总结以**独立 assistant 消息**落库（§12.2 第 3 条），下一次确认重建上下文时历史末条为该总结，直接紧跟原始 `assistant(tool_calls)` → 两条连续 assistant。<br>修复：`buildConfirmContext` 在拼装后若 `picked` 末条为 assistant，则弹出并把其 content 并入原消息（合并为一条 content + tool_calls）。修复后同一 4 回合真机链路 **0 上游错误**（修复前每轮各 1 次）。<br>注：曾尝试「DeepSeek 端点恒回传 reasoning_content（空串兜底）」的防御性改法，实验证明与根因无关，已回退以保持实现最小 |

### 20.7 演进预留（本期不做，架构不堵路）

| 项                 | 触发条件               | 预留设计                                                                           |
| ------------------ | ---------------------- | ---------------------------------------------------------------------------------- |
| 评论代审/代管工具  | 社区治理语义另立       | 门面侧只需再加 `listComments` / `auditComment` 委托，工具文件模式已固定            |
| AI 删除文章        | 需先给文章加回收站语义 | 现为物理删除（R7）不可恢复，故不给工具；加软删后可照 `delete_cloud_files` 模式补齐 |
| 工具按场景分包下发 | 工具数再翻倍           | 预算实测 debug 日志是触发依据；可在 getAvailableTools 前按意图粗分类后再过滤       |
| 云盘二进制写入     | 用户诉求               | 需先解决上传通道与审核语义（当前 AI 产出只有文本）                                 |

---

## 21. 按需注入 + 评论代审代回 + 封面通道 + 体验三件套（P6，自 docs/P6/ARCHITECTURE-P6-增补.md 并入；增补文档保留为历史细节参考）

> 编号与 `docs/P6/PRD-P6-AI-UX.md` 对齐（D67~~D72 / R69~~R74 / T77~T82）。
> **新依赖 1 个**：`@codemirror/merge`（D71 铁律 7 特批，前端按需异步加载）；**新 HTTP 端点 1 个**：作者回复评论（§21.2）；
> **错误码零新增**（复用 40001/40105/40110/40119 与既有权限码）；工具总数 **25 → 28**。

### 21.1 按需注入：手册两段式 + 工具确定性路由（T77，D67/D68/R69/R70）

**手册两段式**——`SystemPromptService.build(user)` 拼装顺序（§12.4 修订点）：

```
system prompt = 助手设定（静态，prompt.sections.ASSISTANT_IDENTITY）
              + 通用版手册（静态，docs/PLATFORM-GUIDE.md 全文，启动时读入缓存）
              + 能力清单（动态，按当前用户权限逐项注入，一行一项）
              + 用户上下文（昵称/角色/当前日期，现状不变）
```

- **能力清单数据源 = 代码常量表** `modules/ai/chat/capability.manifest.ts`（`CAPABILITY_MANIFEST`：`key / perms / text / tools`）。
  与工具注册表**三方同源**：每个已注册工具恰好被一个能力行覆盖，且能力行 `perms` 与该工具 `perms` 完全一致；`perms: null` = 登录即可（恒注入）。
  注入条件 = `PermissionService.hasPermission`；无权限项**不出现**（AI 不向用户承诺做不到的事，R69）
- **分段字数阈值（机械核查，UTF-8 字符口径 `[...text].length`）**：通用版（助手设定 + 手册）≤1000 / 能力清单 ≤1200 / 合注总长 ≤2000。
  实测：通用版 **999**、能力清单 **644**（17 行）、admin 实际 prompt **1691**（含用户上下文）
- 核查脚本 = `apps/api/scripts/check-ai-prompt.ts`（`pnpm --filter @iplat/api check:ai`）：三阈值 + 工具归组 +
  能力清单同源 + 路由样例 + 写工具能力行登记，**任一不过即退出码 1**

**工具确定性路由（形态 A）**——下发链两道串联，顺序不可颠倒：

```
权限过滤（现状）→ 组路由（tool.groups.ts）→ 携带 tools 调上游
```

- 分组常量 `TOOL_GROUPS`（6 组 / 28 工具，与注册表同源）：

  | 组            | 工具数 | 工具                                                                                                                 |
  | ------------- | ------ | -------------------------------------------------------------------------------------------------------------------- |
  | common        | 3      | get_my_profile / update_my_profile / get_my_credits（无 perms，恒下发）                                              |
  | system        | 4      | get_online_users / kick_user / search_users / list_roles                                                             |
  | siteFile      | 3      | list_site_files / read_site_file / write_site_files                                                                  |
  | siteCms       | 10     | list/read/create/update/publish_site_article + ensure_site_column / ensure_site_tags + list/audit/reply_site_comment |
  | siteLifecycle | 3      | create_site / update_site / delete_site                                                                              |
  | cloud         | 5      | list/read/write_cloud_file + move_cloud_files + delete_cloud_files                                                   |

  > 命名说明：P5 文档中的 `create` 组自本期起称 **siteCms / siteLifecycle / siteFile**（拆分后名实相符）；API.md §13.6 的常量表以本节为准。

- 命中 = **当前用户消息**（不含历史）经 `KEYWORD_TO_GROUPS` 词根匹配 → 命中组并集 ∪ common；**无命中 = 全量兜底**（宁可多花 token，不让 AI 说不会）；
  未归组工具（孤儿）出于安全一律保留（启动 warn + 核查脚本硬失败）
- **部分命中的豁免规则（P20 R162 建 → P21 T176 修订）**：`system` + `common` 恒下发；`app` + `siteLifecycle` 改为**创建意图触发**（消息命中 `CREATE_INTENT_KEYWORDS` 词根或直接命中本组词根时才随命中组下发）——旧「恒豁免」使任意命中都附带 17 个豁免组工具，裁剪近乎失效（工具 schema 约占输入 1/3，放大 429 风险）。实测：纯 CMS 查询 19/43，app 相关查询 23/43 完整可达
- 确认回填链路（`/ai/tool/confirm`）的 routingText = 该会话**最近一条 user 消息**（与 chat 链路同一路由函数，行为一致）
- **观测日志**：每轮 info `[AI] tools injected: groups=… count=x/28`；`DEBUG_AI=1` 时 debug 补记命中关键字与权限内工具数；
  历史预算 debug 行同步记 `groups=`（与 toolsBudget/historyBudget 同一条，R67 口径扩展）
- **演进阈值**：`toolsBudget > max_context × 20%` → 评估形态 B（meta-tool 搜索路由），见 §21.6

### 21.2 评论作者回复 + AI 评论三件套（T78，D69/R71/R74）

**DB**：`site_comment` 增 `reply_content varchar(500) null` + `reply_at datetime null`（一级回复：每条评论至多一条，改回复 = 更新这两列；清空 = 置 NULL）。
迁移 `20260915100000_add_site_comment_reply`。

**后端**：

- 管理端 `PUT /api/site/comment/:id/reply`（`site:comment:audit`，`@OperationLog('个人网站','回复评论')`）：
  body `{ content }` trim 后 ≤500 字（DTO `@Length(0,500)` + service 兜底），**空串/null = 清除回复**；
  返回 `{ ok: true, id, nickname, content, replyContent, replyAt }`（超集：前端不回读也能更新，见 §21.7 偏差 2）
- `SiteCommentService`：`list` 条目加 `replyContent/replyAt`；新增 `reply`（写回复并失效 `site:data:{siteId}:*`）与 `getCommentBrief`；
  `findOwnedComment(userId, id, expectedSiteId?)` 增可选站点校验（AI 链路跨站评论 = 40119，管理端不传即保持现状）
- 开放层 `/api/open/:slug/api/articles/:id/comments` 条目增 `replyContent/replyAt`（查询恒为 `audit_status=1`，故回复可见性与评论一致，R71）
- **SiteFacade 评论层**（SiteFacadeModule 增 imports SiteCommentModule，CommentModule 增 exports）：
  `listComments(userId, siteId, { auditStatus?, articleId?, pageNo?, pageSize? })`（pageSize ≤20）/ `auditComments(userId, siteId, ids[], auditStatus)`（≤20，逐条独立成败）/
  `replyComment(userId, siteId, id, content?)` / `getCommentBrief(userId, siteId, id)`

**AI 工具 3 个**（siteCms 组，均 `site:comment:audit`）：

| 工具                  | risk  | 入参                                                                                            | 摘要 / 返回要点                                                                |
| --------------------- | ----- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `list_site_comments`  | read  | `{ slug?, status?（pending 默认/approved/rejected/all）, articleId?, page?, pageSize?（≤20） }` | 内容超 60 字截断（`contentTruncated`）；含文章标题/状态/回复                   |
| `audit_site_comments` | write | `{ slug?, ids: number[]（1~20）, action: approve\|reject }`                                     | 确认卡 = 条数 + 通过/驳回 + 公开影响 + 目标站点；执行逐条汇总 succeeded/failed |
| `reply_site_comment`  | write | `{ slug?, id, content（≤500，空串=清除） }`                                                     | 确认卡 = 原评论昵称 + 内容截断 30 字 + 现有回复 + 新回复（R71）                |

**前端**：管理端评论页新增「作者回复」列 + 行内「回复/改回复」（FormDialog，回显原评论与已有回复）；默认模板（site-templates/default）文章详情渲染「作者回复」块（有 `replyContent` 才渲染，textContent 转义）
三套模板 README.txt 的评论契约同步补 `replyContent/replyAt` 字段说明。**存量站点模板是用户代码，不渲染即不显示（不受影响）**。

### 21.3 文章封面通道（T79，D70/R72）

- 工具参数：`create_site_article` / `update_site_article` 增 `coverPath`（update 传空串 = 清除封面）
- **SiteFacade.resolveCoverPath(userId, siteId, coverPath)**：不抛异常，返回判定对象
  `{ ok: true, path } | { ok: false, errorCode: 40105, message, availableImages }`；校验链：`media/` 前缀 →
  `CloudFacade.resolvePublicPath` 解析为该站云盘真实文件（属主 + 未删除 + 可公开访问 + 非目录）→ 扩展名 ∈ `{png,jpg,jpeg,webp,gif}`（`SITE_COVER_IMAGE_EXTS`）；
  失败时附该站 `media/` 下已有图片清单（有界遍历前 10 条，`AI_COVER_HINT_MAX`）引导模型换图
- 模型发现图：既有 `list_cloud_files { path: "media/" }`（零新增通道）；AI 无图片上传能力，只能引用已有图
- 出口径：`SiteArticleItem` 增 `coverPath`（创建/更新/读取均返回，便于模型自我核对）

### 21.4 体验三件套（T80，D71/R73）

1. **模板预览图**：三张静态预览资产 + `template.json#preview` 填文件名 + `GET /api/site/templates` 响应增 `previewUrl`
   （缺省/缺图 = null，前端渲染占位）；模板卡片 `<el-image>` + `#error` 占位（不裂图）。
   **资产落点为 web 侧 `apps/web/public/templates/{id}/preview.png`**（Vite 构建直出 `/templates/{id}/preview.png`）——
   避免为静态图新增 API 端点，也避免二进制资产双份（见 §21.7 偏差 3）
2. **编辑器 diff 视图**：`FileEditorDialog` 增「对比改动」入口（**所有文本文件**，有改动或已在对比态时可用），
   左 = **打开时快照**（旧），右 = **当前编辑内容**（新），两侧 `EditorState.readOnly.of(true)` 只读、`highlightChanges` + 行内 gutter，
   **不做三路合并/不做编辑合并**（R73）；`@codemirror/merge` 按需 `await import()`（构建产物独立 chunk，不阻塞首屏）；保存后关闭对比并刷新快照
3. **格式按钮**：markdown 编辑面快捷插入——`FileEditorDialog`（仅 `.md`）与文章编辑器正文工具栏各一组「粗体 `**`／斜体 `*`／链接 `[](url)`」，
   选区包裹 + 无选区插占位文本，**零依赖**

### 21.5 搭车两项（T81，D72）

- **回收站排除头像旧行**：`RecycleService.findTopLevelDeleted` 查询加 `parentId: { not: AVATAR_PARENT_ID }`（-1 是不可达虚拟父目录下的内部行，用户不可还原/清理）；
  30 天自动清理通道**不变**（仍清理头像旧行，且沿用 `refundUsed: false` 口径，§19.2）
- **确认弹窗全仓统一**：新增公共资产 `confirmDialog(message, title?, options?)`（`web/src/utils/confirm.ts`）——
  `ElMessageBox.confirm` 取消/关闭/ESC 以 reject 结束，封装内 try/catch 后返回布尔；**全仓 30 处调用点全部改走本封装**（`ElMessageBox.confirm` 仅存在于封装内部），
  调用方统一写 `if (!(await confirmDialog(...))) return`，不再各自 try/catch（销 P4f 遗留 19）

### 21.6 演进预留（本期不做，架构不堵路）

| 项                           | 触发条件                                      | 预留设计                                                                                   |
| ---------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 形态 B（meta-tool 搜索路由） | `toolsBudget > max_context × 20%`（实算日志） | 路由层已收敛在 `tool.groups.ts` + `getAvailableTools` 两点，替换为 meta-tool 不改工具实现  |
| 评论楼中楼（多级 parent_id） | 社区语义明确后                                | 现为一级回复（`reply_content` 单列）；升级需改表 + 开放层契约 + 模板                       |
| AI 图片生成/上传通道         | 上游具备图片产出能力                          | 现只能引用云盘已有图（R72）；通道落地后 `coverPath` 参数无需变更                           |
| AI 覆盖确认卡「对比」按钮    | 需要时                                        | 确认卡 params 已含新内容，缺旧内容来源；站点文件无按路径读接口（R73 允许降级为纯文本对照） |
| MCP server 化                | P7 功能分享市场一并讨论（用户已拍板）         | 工具注册表 + 门面已是稳定接口层，可作为 MCP 工具源                                         |

### 21.7 实现偏差与验证登记（T82）

| #   | 项                               | 说明                                                                                                                                                                                            |
| --- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 分组口径以 §21.1 为准            | API-P6 §13.6 的常量表与真实注册表不符（含 navigate_page/list_users 等不存在的工具）；实现按 ARCHITECTURE §21.1 六组，API.md §13.6 已按实现改写                                                  |
| 2   | 回复端点返回超集                 | API-P6 §13.1 写「返回 `{ok:true}`」；实现返回 `{ok, id, nickname, content, replyContent, replyAt}`（兼容超集，前端不依赖）                                                                      |
| 3   | 模板预览图落点                   | ARCHITECTURE-P6 增补写 `assets/site-templates/*/preview.png`；实现落在 web 侧 `public/templates/{id}/preview.png`（构建直出，零新端点、零二进制双份），`template.json#preview` 仍为单一开关     |
| 4   | 错误码实际口径                   | API-P6 表格的 40107「content 超 500」与 40101「无权限」均与实际码表不符：回复超长 → **40001**（DTO + service 双校验）；评论不存在 → **40110**、跨站/非属主 → **40119**；无权限 → 全局权限守卫码 |
| 5   | 「服务端更新冲突」入口无后端依据 | 在线编辑为更新行语义（最后写入者胜，§15.5），无版本号/乐观锁；故 diff 入口按 API-P6 §13.7「会话内版本切换」落地为「打开时快照 ↔ 当前内容」只读对比（R73 允许）                                  |
| 6   | 格式按钮落点两处                 | R73/D71 未指定编辑器归属：`FileEditorDialog`（仅 .md）与文章正文工具栏各一组，均为 markdown 面                                                                                                  |
| 7   | 评论工具 status 用字符串枚举     | API-P6 §13.4.1 的 `status` 字符串枚举更适合模型（ARCHITECTURE §21.2 原写 `auditStatus` 数字）；实现取字符串枚举，内部映射 0/1/2/all                                                             |
| 8   | 封面校验含「可公开访问」         | R72 只要求「真实存在且属当前用户」；实现复用 `resolvePublicPath`（含公开性上溯），避免给模型一张页面加载不到的封面图                                                                            |

**真机浏览器复验（agent-browser + 真实 Chromium，对 dev server + API）**：站点设置页三套模板预览图全部加载（1024×768）；评论管理页出现「作者回复」列，回复弹窗回显原评论 → 保存后列显示回复、按钮变「改回复」→ 开放 API 返回 `replyContent/replyAt` → 清空保存后回复被清除（原状恢复）；在线编辑器（t.txt）改动后「对比改动」呈现只读双栏差异（新增行绿色高亮、无改动侧无标记，向对比面板输入无效 = 只读生效），「返回编辑」可切回；脏检查关闭弹窗 → 取消（继续编辑）后 `agent-browser errors/console` **均为空**（确认框取消零告警）；文章编辑正文工具栏「粗体/斜体/链接」按选区正确包裹 `**` / `[](https://)`（占位文本兜底）且取消未落库（文章正文与 `t.txt` 均零变化）。

**真机端到端（验收 11，真实模型 deepseek-v4-flash + 真 SSE）27/27 通过**：「审评论 → 回评论 → 写文章带封面 → 发布」五回合零上游错误——回合 1 模型自主对名下 3 个站点各调 `list_site_comments` 并报出待审 1 条；回合 2 审核确认卡（条数 + 公开影响 + 站点）→ `audit_status=1`；回合 3 回复确认卡含原评论昵称/内容截断/回复内容 → 落库并在开放 API 返回；回合 4 模型自动选栏目、确认卡含封面行与字数 → 草稿落库 `coverPath` 正确；回合 5 发布 → `status=1` 且开放层返回 `coverUrl`。测试数据全清、`used` 回基线，真实消耗积分 91 分（如实登记）。

**验证（真实 MySQL/Redis + Nest 应用上下文，测试数据跑完清理、`used` 精确回基线 64,428,657）**：28 项全绿——
手册两段式按权限裁剪（admin 17 行 / 无权限用户 1 行、1691 ≤ 2000）、28 工具归组无孤儿、路由命中与全量兜底、
评论 list/audit/reply（含 trim、覆盖不新增行、空串清除、开放层携带回复）、超长 40001 / 批量 >20 40001 / 跨站与非属主 40119、
封面四条失败链 + 真实图片通过 + create 落库 + update 空串清除、回收站顶层不含头像旧行；
`pnpm check:ai` 16/16；`tsc --noEmit` / `eslint`（双端）/ `vue-tsc` 零错；`vite build` 产物含 `@codemirror/merge` 独立异步 chunk（首屏不加载）。

---

## 27. P11：应用平台 · 数据应用 A 全链（P11 增补并入）

> 来源：`docs/P11/ARCHITECTURE-P11-增补.md`（Kimi）。编号 D92~~D96 / R88~~R99 / T100~T107。
> 一句话：把「数据管理」产品化——用户经 **AI 对话或空白表单**创建**数据应用**（自定义逻辑表 + 字段 + 关系），
> 平台**自动生成管理后台（功能页）**，数据全部落沙箱化元模型存储（D87）。

### 27.1 域结构（apps/api/src/modules/app/）

| 子目录    | 职责                                                    | 关键类                                                                                   |
| --------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `admin/`  | 应用 CRUD、草稿生命周期、配额、清理 cron                | AdminService、AdminController（`/app`）、AppCleanTask、`app-clean.core.ts`（纯函数核心） |
| `schema/` | 表/字段/关系管理、结构变更规则、中间表生成、schema 缓存 | SchemaService、SchemaController（`/app/:code/...`）                                      |
| `data/`   | **沙箱数据服务**（唯一数据入口）                        | DataService、DataController（`/app/data`）                                               |
| `page/`   | 功能页 schema 存取 + 校验 + 动作事务                    | PageService、PageController、PageActionController（`/app/data/action`）                  |
| `import/` | CSV 导入导出 + 附件上传                                 | ImportService、ImportController、`csv.ts`（自研解析）                                    |
| `facade/` | 跨域门面                                                | `AppFacade`（完整，供 ai 域）/ `AppRefService`（最小，供 cloud 域预检）                  |

聚合模块 `app-domain.module.ts` 导出 **AppFacadeModule**（ai 域注入）与 **AppRefModule**（cloud 域注入）。

> 命名说明：类名为 `AppDomainModule` 而非 `AppModule`——避免与根模块 `src/app.module.ts` 的同名类冲突。

### 27.2 数据模型（7 张 app_* 表，relationMode="prisma" 逻辑外键）

`app_def`（主档：code 用户内唯一 / pub_code 全局唯一 12 位 / status draft|active / source_app_id / version / deleted_at）、
`app_table`（逻辑表：is_system=1 为 n:n 中间表，不计配额不可见）、
`app_field`（字段定义：type 七类 / required / default_val / enum_options / ref_table_id / ref_multiple / is_deleted 软删）、
`app_rel`（仅 n:n 显式登记：from_table/from_field/to_table/through_table）、
`app_record`（数据行：row_id char(36) 对外主键 / data JSON / **r_c1~r_c5** 热字段冗余生成列 / deleted_at）、
`app_page`（功能页：kind=admin / code / route / schema JSON / schema_version / gen_by）、
`app_attachment_ref`（附件引用索引：file_id + deleted_at 为 D96 预检查询点）。

索引要点：`app_def(owner_id,status,deleted_at)` + `uk(owner_id,code)` + `uk(pub_code)`；
`app_record(table_id,deleted_at)`、`(table_id,r_c1..r_c5)`、`(app_id,updated_at)`；
`app_attachment_ref(file_id,deleted_at)`。

**实现注记（相对增补文档的落地差异，已回写）**：

1. **软删释放唯一槽**：`app_table.name` / `app_field.name` 有 DB 唯一索引，软删时把 name 改写为 `__deleted_{id}`
   以释放槽位（否则「删表/删字段后重建同名」会撞唯一索引）；label 保留便于回溯。
   已知边界：重建同名字段不会继承旧值，但旧行 data 中同键的历史值会被新字段读到（v1 登记为已知限制）。
2. **中间表字段固定命名** `from_id` / `to_id`（`schema.constants.ts` 的 REL_FROM_FIELD/REL_TO_FIELD），
   使 n:n 读写可用 r_c1/r_c2 索引列定位，避免 JSON path 查询。
3. `app_page` 增 `uk(app_id,code)`（菜单/路由按 code 寻址，增补只写了 route 唯一）。

### 27.3 Facade 拓扑（铁律 3/6，防环照 P4d 先例）

```
ai 域（工具 handler）      ──▶ AppFacade（createAppDraft/addTable/addFields/setRelation/genAdminPage/adjustPage/confirmDataApp/getAppMenuSegments）
cloud 域（删除/彻底删除/清理预检）──▶ AppRefService.getAttachmentRefs / hasAttachmentRefs（最小模块，仅 PrismaService）
auth 域（userinfo 动态菜单）  ──▶ AppFacade.getAppMenuSegments
app 域（附件上传）          ──▶ CloudFacade.uploadForApp
```

- app → cloud 经 **CloudFacadeModule**；cloud → app 经 **AppRefModule**（零跨域 import，仅全局 PrismaService），
  两向各走各的门面，无 import 环（照 `SiteRootModule` 先例）。
- `getAttachmentRefs` 只查 `app_attachment_ref`（deleted_at 过滤）+ `app_def`（限定属主），**不读 app_record.data**。
- 还原语义：回收站**还原**允许（引用仍在）；**软删/彻底删除/清空/超期清理**命中引用即 30021 阻断。

### 27.4 沙箱数据服务（DataService，唯一数据入口）

- **写路径**：解析逻辑表 → 逐字段校验（类型/必填/枚举/ref 存在性/attachment 权属，附件权属经 `CloudFacade.filterAliveFileIds`）
  → 组装 data JSON + 维护 r_cN → prisma 事务落库；attachment 同步维护 `app_attachment_ref`（差量重写）；
  n:n 多值经中间表差量重写（删旧行 → 插新行，随动作事务）。**任何控制器/工具不得绕开 DataService 写 app_record**（红线）。
- **查询 DSL（R95 白名单）**：`{ appCode, op: list|get|count, table, filter[{f,op,v}], sort[{f,dir}], page, size, expand[{f,fields}] }`
  - filter op：`eq/ne/gt/gte/lt/lte/contains/in`；size ≤100（默认 20）；expand ≤1 层（应用层回表，禁 SQL JOIN）；
  - **两条路径**：可全下推（filter 仅 eq/ne/in/contains 且字段命中 r_cN、sort 字段非 number）→ DB where/orderBy；
    否则内存路径（(table_id,deleted_at) 拉取，**硬上限 1 万行**，超出 50009）；单查询耗时 > `app.queryTimeoutMs` → 50009。
  - **实现注记**：DSL 需带 **`appCode`**（表名仅在应用内唯一，增补文档 DSL 示例未含此字段，落地为必填）。
- **行渲染**：多值 ref 从中间表回填为 `data[field] = rowId[]`（前端表单编辑需要）；expand 结果放 `expanded[field]`。
- **CSV 导入导出（R92）**：自研解析（`csv.ts`，UTF-8/GBK 探测，零新依赖）；
  导入 = 上传(≤5MB) → 自动映射 + 前 5 行预览 → 确认 → **异步逐行**导入（每行独立事务，错误行报告不中断）→ 进度轮询（Redis `app:import:{taskId}`，TTL 1h）；
  导出 = cursor 分批流式 CSV（≤5 万行，超出截断并在尾注释说明）；附件字段导出 fileId，多值 ref 以 `;` 连接。
- **附件（D96）**：`POST /app/:code/attachment` → `CloudFacade.uploadForApp` 服务端强制落
  `/app-attachments/{appCode}/`（appCode 白名单校验防穿越），占云盘配额。
  **实现注记**：超 10MB 返回 **30004**（CloudFileTooLarge；增补写 30003 属笔误，30003 是配额不足）。

### 27.5 功能页模式 JSON（app_page.schema，schema_version=1）

```json
{
  "kind": "admin",
  "layout": [
    { "type": "filterBar", "bind": "mainList", "fields": ["title:contains"] },
    {
      "type": "table",
      "bind": "mainList",
      "columns": ["title", "tag_ids:expand:tag"],
      "rowActions": ["edit", "delete"]
    },
    {
      "type": "form",
      "bind": "create_book",
      "title": "新建书",
      "fields": ["title", "status:enum", "cover:attachment", "tag_ids:ref:tag:multiple"]
    }
  ],
  "dataSources": {
    "mainList": {
      "op": "list",
      "table": "book",
      "sort": [{ "f": "title", "dir": "desc" }],
      "size": 20
    },
    "tag_ids_options": { "op": "list", "table": "tag", "fields": ["rowId", "name"], "size": 100 }
  },
  "actions": {
    "create_book": { "tx": false, "steps": [{ "op": "create", "table": "book" }] },
    "update_book": { "tx": false, "steps": [{ "op": "update", "table": "book" }] },
    "delete_book": { "tx": false, "steps": [{ "op": "delete", "table": "book" }] }
  }
}
```

- 区块四型：`filterBar/table/form/detail`；字段 string DSL（`字段[:op]` / `字段:expand:目标` / `字段:ref:目标[:multiple]`）。
- **2026-09-30 增补**：form 区块新增 `placement: 'inline' | 'dialog'`（**缺省 `dialog`**）——`dialog` 渲染为**表格卡片头部「新建 XX」按钮 + 弹窗**（字段控件与「编辑」同款 `FieldInput`），`inline` 保留历史"内嵌区块"形态；R94 校验放行并校验该字段（**仅 form 区块可携带**，非法值 → 50004）。已同步：前端引擎 `AdminRenderer`、同源模板（`views/app/utils/schema.ts` 与 `page/page.builder.ts` 均默认 `dialog`）、可视化页编辑器「展示形态」开关。
- 校验（R94，50004 带路径）：kind 必须 admin；dataSources/tables 存在、filter/sort 字段存在；layout 绑定必须指向已声明数据源（form → 动作）；
  `rowId` 为内置列（非 app_field 定义），显式放行。
  **实现注记**：增补写「zod/class-validator」，但 zod 非现有依赖且铁律 7 禁止新增 → 落地为**手写结构校验**（`page/page.schema.ts`，纯函数零依赖）。
- **动作执行**：`POST /app/data/action { appCode, pageCode, action, params }` → 全部步骤包 `$transaction`，任一步失败整体回滚；
  action 未声明 50010；步骤参数取 `params[表名]` 子对象（多表编排必填），否则用平铺 params；`rowId` 从同层取。
- 页面 code/route 生成：名称 slug 化（中文退化为 `page`），应用内唯一（含软删行，避免撞唯一索引）。

### 27.6 前端（apps/web）

- `views/app/center/index.vue`（我的应用卡片流 + 空白创建 + 草稿确认入册 + 删除）、
  `views/app/schema/index.vue`（结构编辑器：表/字段/关系）、
  `views/app/page-editor/index.vue`（功能页列表 + 模型 JSON 编辑，R97）、
  `views/app/function-page/index.vue`（功能页宿主，按 `/app-center/app/:appCode/p/:pageCode` 参数拉 schema）；
- `components/app-renderer/`：**AdminRenderer**（四型区块渲染）+ `FieldInput.vue`（按字段类型出控件，附件走 `/app/attachment`）；
  数据源统一经 `api/app/data/query`，动作经 `api/app/data/action`；常量与后端同源副本放 `views/app/utils/schema.ts`；
- 通配路由与两个编辑器路由**静态注册**（`router/index.ts`）；菜单节点 component 留空，`dynamic.ts` 跳过空 component 不产生重复路由。

### 27.7 菜单动态段（R96，userinfo 响应扩展）

`GET /api/auth/userinfo` 的「应用中心」节点 children 由**后端实时拼装**（不落 sys_menu）：

```
应用中心(/app-center，seed 目录) ── 我的应用(app-center/center，seed 菜单)
                              └─ {应用名}(/app-center/app/{appCode})     ← 动态段（active 应用）
                                  └─ {功能页名}(/app-center/app/{appCode}/p/{pageCode})
```

自动节点 id 前缀 `dyn-app-*`；应用删除/转草稿后下次拉 userinfo 即时消失（零种子依赖）。

### 27.8 缓存 / 安全 / 配置

- Redis：`app:schema:{appId}`（def+tables+fields+rels+pages 全量打包，TTL 600s，结构/页面/应用变更即 DEL）；
  `app:import:{taskId}`（导入进度）。
- 安全：全参数绑定（Prisma prepared）；schema 双道校验（R94）；AdminRenderer 全文本插值（禁 v-html）；
  全部端点属主校验（assertOwned，统一 50001）；软删可回溯；附件目录服务端拼接防穿越；写操作挂 @OperationLog。
- 配置组（`src/config/app.config.ts`，env 前缀 `APP_*`）：`maxAppsPerUser=10` / `maxDraftsPerUser=3` / `maxTablesPerApp=20` /
  `maxRowsPerTable=50000` / `maxPagesPerApp=50` / `maxAttachmentSize=10MB` / `maxImportSize=5MB` /
  `hotIndexFieldsPerTable=5` / `queryTimeoutMs=2000` / `draftTtlDays=7`。
- 定时任务（`admin/app-clean.task.ts`）：04:00 清理过期草稿（软删）；04:30 物理清理软删超期应用（保留 30 天）。
  核心逻辑在 `app-clean.core.ts`（纯函数 + PrismaClient），Service 与手动脚本 `pnpm --filter @iplat/api clean:app` 共用。

### 27.9 演进注记

展示应用 B / 市场 → P12/P13（`app_page.kind` 已分 admin/display，`app_def.pub_code/source_app_id` 已建）；
app_record 分表（单表 ≥500 万行）；富文本字段（引 DOMPurify 需特批，先 Markdown 文本）；
AI 创建 agent 化 → P14；行级操作审计（data 外追加 diff 列）。

### 27.10 错误码 50xxx 段（应用平台，P11；P11 走查 W1 收齐）

| 码    | 含义                                              | 处理                                 |
| ----- | ------------------------------------------------- | ------------------------------------ |
| 50001 | 应用不存在或无权（统一属主校验，含系统表操作）    | 刷新应用列表 / 回应用中心            |
| 50002 | 超出配额（message 带配额项）                      | 提示配额项与上限                     |
| 50003 | 结构变更未通过数据校验（带 rowId 清单）           | 提示违规行，可导出 CSV 后修正        |
| 50004 | 页面 schema 校验失败（带路径）                    | 编辑器就地高亮错误路径               |
| 50005 | 数据校验失败（字段规则 / 动作步骤）               | 表单就地提示（事务已回滚）           |
| 50006 | 导入文件不合规（非 CSV / 超限 / 空 / 首行无列名） | 提示具体原因，重新选择文件           |
| 50007 | 功能页路由冲突（同应用 route 重复）               | 提示更换 route                       |
| 50008 | 草稿已过期或不存在                                | 提示重新发起（AI 草稿 TTL 7 天）     |
| 50009 | 查询超出护栏（>2s 或内存路径 >1 万行）            | 提示缩小筛选范围                     |
| 50010 | 动作与页面定义不符（action 未在 schema 声明）     | AI 工具回喂；前端提示刷新页面 schema |

- 段位起点 **50001**（50000 为通用内部错误）；端点侧同表见 API §18.3。
- 本段**无 50011**（P11 封顶 50010）；P12 续用 **50012**（发布校验未过，§28）；P13 续用 **50013~50015**（市场域，§29.7）。

### 27.11 公开面 AI 闭环（P12-PATCH2 T116，D106 / R114~R116）

> 来源：走查遗留 31（「站点读不到应用表 / 自定义表无对外接口」引发的 AI 侧缺口）+ `docs/P12/PRD-P12-PATCH2-AI公开面闭环.md`。

- **根因**：P12 已交付公开接口，但 AI 侧三缺——能力清单只述管理侧、app 工具返回不含 `pubCode`、站点契约 README 无公开接口清单 → 模型遇「对外展示」只能改道站点并给出冲突答复。
- **只读闭环（本期）**：新增工具 `list_data_apps`（**read / 零参数 / perms 留空**）→ `{ ok, apps: [{ appCode, name, status, isPublic, pubCode, pubUrl, missing[] }] }`；
  - 取数经 **AppFacade.listDataApps → AdminService.listWithPubState**（铁律 6：AI 域不直读 app 表）；`missing` 复用 `collectPublishMissing`（与 `pub-config` 同源，已发布应用跳过计算）；
  - **不代发布**：`missing` 非空时模型只做引导（去应用中心「公开」按缺项补齐）；**发布/暴露写工具按 D106 归 P13**（避免与市场状态机二次重构）；
  - 分组：`TOOL_GROUPS.app` 增该工具；`KEYWORD_TO_GROUPS` 的 app 组补**复合词**（公开应用 / 公开链接 / 公开凭证 / 公开访问 / 公开数据 / 对外展示 / 外部展示 / 展示页 / 发布应用 / pubcode）——**不抢 siteCms 的泛词**；
  - 能力清单新增 `app.pub` 行（≤50 字，工具总数 **37 → 38**，能力行 18 → 19）；通用版手册**一字未改**；
  - 站点契约 README 三模板（default / card / portfolio）增「六、数据应用公开接口」节：前置条件（发布 ∧ 表·字段暴露 ∧ display 页公开，缺一 40400）、五端点清单、fetch 示例（`size` ≤50 / `expand` ≤1 层 / `filter=字段:eq|contains:值`）、错误口径（40400 / 40001 / 42900）、只读边界，并显式声明**该节是「相对路径纪律」的唯一例外**（公开面挂在平台根 `/api/pub/app/`，须用绝对路径）。
- **验证**：`pnpm check:ai` **17/17**（新增「数据应用/公开发布 → app 组且含 list_data_apps」路由断言）；`pnpm smoke:ai` **6/6**（F/I/J/K/L 零回归 + **M 只读用例**通过，并清理夹具应用）；新建站点实测 README 已含该节（公开取回 4.7KB，含接口清单与例外说明）。
- **接缝**：站点内嵌应用数据的服务端语义（模板标签 / 绑定 UI / 联动提示）仍为挂账（D99 不建 `app_binding`），随 P13+ 设计。

## 28. 数据应用 B 侧（公开与展示）（P12，增补并入）

> 来源：`docs/P12/ARCHITECTURE-P12-增补.md`（并入本节）+ `docs/P12/PRD-P12-PATCH1-可视化页编辑器.md`（T115，前端零后端改动）。
> 编号：D97~~D105 / R100~~R113 / T108~T115。**零新依赖、零新表（+4 列）、零新 AI 工具（37 不变）**。
> 核心模式复制开放层已验证的「@Public + 独立限流 + 40400 防探测」（§14.4 / §16.2 先例）。

### 28.1 域结构增量（apps/api/src/modules/app/）

| 位置               | 增量                                                                                 | 说明                                                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pub/`（新子目录） | PubController（`/api/pub/app/**`）、PubDataService、pub.cache / pub-mime             | 免登录公开面，@Public + @SkipTransform，独立限流 60/min/IP                                                                                          |
| `admin/`           | AdminController 扩展 5 端点（publish / pub-config / 两级 expose / 页 publish）       | 登录 + 属主（assertOwned 50001）+ 写挂 @OperationLog                                                                                                |
| `page/`            | page.schema.ts 扩展 display 校验（R102）与 rowLink 校验                              | 手写校验风格沿用（零依赖）                                                                                                                          |
| `page.service`     | 页类型由 `schema.kind` 单一定源（admin/display），display↔admin 回退时清 `is_public` | 避免 DTO 与 schema 双写不一致                                                                                                                       |
| `data/`            | DataService 新增公开执行入口 `queryForPublic`（复用双路径执行器）                    | 调用方已完成公开/暴露/参数校验，本方法只执行 + 护栏（50009）                                                                                        |
| CloudFacade        | 新增 `getAppAttachmentStream(fileId, range?)` 最小只读方法                           | app→cloud 沿用既有 CloudFacadeModule；返回 stream + name/ext/size/mime/updateTime；**调用方（pub/）已完成引用索引与暴露校验**，方法内不重复业务校验 |

cloud 域零改动；site 域零改动；不新建反向 Facade（AppRefModule 维持 P11 原状）。

### 28.2 数据模型增量（+0 表 +4 列）

迁移 `20260924100000_app_pub_exposure`：

| 表        | 列                      | 默认 | 说明                               |
| --------- | ----------------------- | ---- | ---------------------------------- |
| app_def   | `is_public` tinyint(1)  | 0    | 公开发布开关（D101 属主自助）      |
| app_table | `is_exposed` tinyint(1) | 0    | 表级暴露门禁                       |
| app_field | `is_exposed` tinyint(1) | 1    | 字段级暴露（受表门禁，R100）       |
| app_page  | `is_public` tinyint(1)  | 0    | display 页公开标记（admin 页恒 0） |

- 查询路径：公开面全走 `app_def.uk(pub_code)` 定位，无需新索引；回滚 = 删列，零数据迁移。
- **app_binding 不建**（D99）：绑定语义由三开关 + 页 schema dataSources 表达。

### 28.3 公开数据服务（PubDataService）

- **投影白名单（R101）**：有效暴露集合 = 应用 is_public ∧ 表 is_exposed ∧ 字段 is_exposed ∧ 非内部列；输出键 = `app_field.name` + 内置三件套（rowId/createdAt/updatedAt）。
  - 落地注记：暴露集合**每请求按 DB 现算**（不缓存字段定义）→ 暴露开关/新增字段/结构变更立即生效，无缓存失真面；代价是每请求两条小查询（app_table 命中 + app_field 命中）。
- **查询执行复用（铁律 5）**：入参从 A 侧 DSL JSON 改为 R104 固定参数（GET query 解析 → 同一执行计划）；双路径（r_cN 下推 / 内存 1 万行护栏）、2s 超时（50009）、n:n 回填（from_id/to_id + r_c1/r_c2）、expand ≤1 层语义与 A 侧完全一致；expand 目标表未暴露 → 40001。
  - 落地注记：R104 的排序键允许内置三件套（rowId/createdAt/updatedAt），而 A 侧执行器只认 r_cN 列 → **排序键含内置字段时改在结果集上本地排序**（其余情况仍走索引下推），分页语义不变。
- **缓存（R105）**：`app:pub:{appId}:manifest|schema:*|data:*`；data TTL 60s、manifest/schema 600s；写后失效 = **页动作事务提交后**（PageService）与 **CSV 导入批次完成后**（ImportService）经 `AdminService.invalidatePubCache(appId)` SCAN DEL `app:pub:{appId}:data:*`；发布/取消/暴露开关/页公开即 `invalidatePubAll`。
- **防探测（D100）**：pub_code → app_def（is_public=1 ∧ deleted_at null）任一失败 → 40400；表/行/文件校验失败同码；参数校验 40001、限流 42900 为例外（开放层同款例外结构）。

### 28.4 display 页模式增量（schema_version=1 兼容扩展）

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

- **校验（R102）**：kind=display → 禁 form 区块、禁 actions；table 禁 rowActions；detail 必须绑 op=get 数据源；rowLink.page 必须存在于同应用（ctx.pages）；dataSources op 仅 list/get（禁 count）；字段 DSL 语法白名单 + 基础字段存在 + expand/ref 目标表存在。
- **取值语义**：list 数据源直接渲染；get 数据源的 rowId 从公开路由 query 取（参数名 rowIdParam，默认 `rowId`；缺失 → 空态「参数缺失」，不报错）。
- **保存时不强制暴露**；发布时统一 R103 校验（缺项 50012，message 带前 5 项 + 总数）。

### 28.5 前端（apps/web）

- `components/app-renderer/` 增 **PublicRenderer**：filterBar / table / detail 三区块只读渲染；字段 DSL 解析（`parseFieldSpec`）、展示格式化（`displayCell`）与 AdminRenderer 同源复用；**附件 → `/api/pub/app/{pubCode}/file/{fileId}`**；全文本插值禁 v-html（沿用）。
- **公开路由**：`/pub/app/:pubCode`（索引 → 重定向首个公开页，无公开页 → 空态提示）+ `/pub/app/:pubCode/p/:pageCode`（宿主，按参数拉 manifest + schema）；`router/guard.ts` 的 `isPublicRoute` 白名单加入 `/pub/`（照 `/view/*` 先例：**前端白名单与后端 @Public 任一缺失都不可匿名访问**，验收须双端核对）。
- 公开 API 层 `api/app/pub.ts`：**故意不走 `utils/request`**（照 `api/cloud/public.ts` 先例），用 fetch 直取统一响应体保留 code（区分 40400 与 40001）；管理侧 5 端点函数并入 `api/app/index.ts`。
- 管理 UI（PRD §8）：应用中心「公开」弹窗（发布开关 + 链接复制 + 缺项引导 + 新窗口预览）、结构编辑器表/字段暴露开关（表关闭则字段禁用）、页编辑器类型选择（管理页/展示页）+ 公开开关 + 预览。

### 28.6 安全清单

- 公开端点：@Public + 独立限流 60/min/IP + 40400 防探测 + @SkipTransform（流式/裸响应）。
- 全参数绑定（Prisma prepared）；白名单投影；渲染器禁 v-html。
- 附件流三道闸：① `app_attachment_ref` 引用存在（deleted_at 过滤）② 所属表·字段有效暴露 ③ MIME 口径 R26（文本强制 `text/plain; charset=utf-8`；html/htm/svg 强制 attachment；图片/音视频/PDF inline；白名单外 octet-stream + attachment）；`?download=1` 出 attachment + `filename*=UTF-8''` 原名。附件 MIME 表按域边界**自持一份**（`pub/pub-mime.ts`，照 cloud `pub-mime.ts` / site `mime.ts` 先例）。
- pub_code 只经 path 传递（照 share token 先例，不进 query/Referer）；公开读不写 @OperationLog，管理侧写操作照挂。

### 28.7 配置增量（src/config/app.config.ts，env 前缀 `APP_*`，均可不配）

`app.pubListMaxSize=50` / `app.pubFilterMaxGroups=3` / `app.pubSortMaxFields=2` /
`app.pubDataCacheTtlSeconds=60` / `app.pubManifestCacheTtlSeconds=600` / `app.pubRateLimitPerMinute=60`

### 28.8 与 P13 的接缝

- `is_public` 只是「自助公开」开关；P13 市场发布 = 独立状态机（审核中/已上架/已下架）+ 快照投影（D103），**不复用 is_public 做审核态**。
- `pub_code` / `source_app_id` P11 已就位；市场复制产生的副本 `is_public=0` 起步，复制不携带公开态。

---

## 29. P13：应用市场（快照式发布 / 审核 / 复制）

> 来源：`docs/P13/PRD-P13-MARKETPLACE.md` / `ARCHITECTURE-P13-增补.md` / `API-P13-增补.md`（并入 §29 / API §20）。
> 编号：D107~~D111 / R117~~R123 / T117~T123。**零新依赖；+1 域（market）+1 表；AI 工具 38→41**。
> 一句话：提交即物化结构快照 → admin 人工审核 → 复制者一键物化为自有应用（副本全私有起步）。

### 29.1 域结构（apps/api/src/modules/market/）

| 子目录      | 职责                                                                 | 关键类                                                                                                                                                |
| ----------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `listing/`  | 提交（快照物化）/ 我的提交 / 浏览列表 / 详情 / 复制编排              | `ListingService`、`MarketController`（`/market`，登录属主口径）                                                                                       |
| `review/`   | admin 审核（待审/在架列表、通过、拒绝、下架）                        | `ReviewService`、`ReviewController`（`/market/review`，`market:review` + @OperationLog）                                                              |
| `snapshot/` | 快照结构与演示数据的**纯函数**物化 ⇄ 序列化 + 手写结构校验（零依赖） | `snapshot.ts`（类型 + `buildSnapshot`）、`snapshot-marshal.core.ts`（`parseSnapshot` / `serializeSnapshot` / `assertSnapshotSize` / `parseDemoData`） |
| `facade/`   | MarketFacade（ai 域工具用）                                          | `MarketFacade` / `MarketFacadeModule`                                                                                                                 |

- **market 域零跨域 import**：结构导出 / 演示数据读取 / 复制物化全部经 `AppFacade`（新增写方法）；审核与浏览只读 market 自有表，无跨域 JOIN。
- 装配：`MarketDomainModule`（imports Listing/Review/MarketFacade，exports 门面）注册进 `app.module.ts`；`ListingModule` → `AppFacadeModule` + `UserModule`（发布者昵称快照）；`ToolModule` → `MarketFacadeModule`。
- 分层纪律：`market → app` 单向（经门面），`ai → market` 单向（经门面），无环。

### 29.2 数据模型（`market_listing`，迁移 `20260927100000_add_market_domain`）

| 列                                            | 说明                                                         |
| --------------------------------------------- | ------------------------------------------------------------ |
| `id` / `code`                                 | 条目编号（对外展示用：slug + 4 位随机 base36，全局唯一）     |
| `publisher_id` / `publisher_name`             | 发布者（昵称在**提交时冗余**，防改名影响在架卡片）           |
| `source_app_id`                               | 谱系：来源应用 id（副本的 `app_def.source_app_id` 同样记它） |
| `name` / `description`                        | 提交时冗余（与源应用解耦）                                   |
| `snapshot` JSON                               | 结构快照（R117）                                             |
| `demo_data` JSON NULL / `has_demo`            | 演示数据（R118）+ 冗余标记（列表卡片免解析 JSON）            |
| `status`                                      | `pending` / `approved` / `rejected` / `delisted`             |
| `review_note` / `reviewer_id` / `reviewed_at` | 审核三件套（拒绝必填 note）                                  |
| `listed_at` / `delisted_at`                   | 上架 / 下架时间（浏览按 `listed_at` 倒序）                   |
| `copy_count`                                  | 复制次数（元数据卡片）                                       |
| `created_at` / `updated_at`                   | —                                                            |

索引：`uk(code)`、`idx_market_status_listed (status, listed_at)`（浏览）、`idx_market_pub_app_status (publisher_id, source_app_id, status)`（50013 校验）。
「每应用 1 个活跃条目」为**应用层校验**（MySQL 无部分唯一索引，D108）。

**快照结构（`snapshot`，R117）**：

```json
{
  "version": 1,
  "tables": [
    {
      "name": "book",
      "label": "书",
      "fields": [
        {
          "name": "title",
          "label": "书名",
          "type": "text",
          "required": true,
          "default": null,
          "enumOptions": null,
          "refTable": null,
          "refMultiple": false
        }
      ]
    }
  ],
  "rels": [{ "fromTable": "book", "fromField": "tag_ids", "toTable": "tag" }],
  "pages": [
    {
      "name": "书展示",
      "route": "book-display",
      "kind": "display",
      "genBy": "manual",
      "sort": 0,
      "schema": {}
    }
  ]
}
```

- **不含**暴露三开关（`is_exposed` / `is_public` 不随快照走）、**不含**数据（演示数据另存 `demo_data`）；
- n:n 中间表（`is_system=1`）不入快照，由物化方按 `rels` 重建（R117）；
- 演示数据（`demo_data`）为 `{ 表名: [{ rowId, data }] }`——`rowId` 是**源行标识**，复制时用于引用重映射（见 §29.3）；`attachment` 字段值已置 null（R118）。

### 29.3 复制物化流程（`AppFacade.materializeListing`，红线全走 DataService）

```
POST /market/:code/copy（接收方登录态）
  ├─ market：条目 approved 且未 delisted（否则 50014）+ 快照/演示数据出库过 snapshot-marshal 校验
  ├─ app：AdminService.createMaterialized（active，占接收方配额 50002；code 冲突 "(1)"；记 source_app_id）
  ├─ 结构重建（失败 → 软删刚建应用整体回滚）：
  │    表按**依赖拓扑序**重建（ref 目标表 / n:n 的 toTable 先建；环时按快照序兜底）
  │    → 字段逐名重建（多值 ref 字段跳过，由关系重建）
  │    → n:n 关系经 SchemaService.createRelation 重建（中间表 + REL_FROM/TO_FIELD + 源表 refMultiple）
  │    → 功能页逐页 PageService.create（schema 原样、kind 由 schema 推导、**is_public=0 全私有**）
  └─ 演示数据逐行**独立事务** DataService.create（错误行跳过并计数；引用按旧→新 rowId 重映射）
```

- 物化在 **app 域内完成**（AppFacade 实现，复用 AdminService/SchemaService/PageService/DataService）——数据写入红线不破。
- **引用重映射（实际设计点）**：演示数据的 ref / 多值 ref 值在源应用内是**旧 rowId**，跨应用无效；复制时按已落库行的 `旧 rowId → 新 rowId` 映射改写；目标尚未落库（拓扑序之外）的引用置空，若该字段必填则该行按「错误行」跳过并计数（R119）。
- 快照结构非法（版本不符 / 缺表缺字段 / 多值字段无关系定义）→ **50015 语义拒绝**，不静默修补。
- 复制成功 `copy_count + 1`（独立于物化事务）。

### 29.4 AI 工具链路（ai 域，全经 Facade）

| 工具                | 参数                                   | 成功返回                                         | 关键路径                                                                                                      |
| ------------------- | -------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `publish_data_app`  | `{ appCode, isPublic }`                | `{ ok, isPublic, pubCode?, pubUrl? , missing? }` | `AppFacade.setPublic` → `AdminService.publish`（R103 未过 **不抛错**，回喂 `ok:false + missing[]`）           |
| `expose_data_app`   | `{ appCode, target, name, isExposed }` | `{ ok, target, name, isExposed }`                | `AppFacade.setExposure`（table 按表名；field 支持 `表.字段` 或应用内唯一字段名；page 仅 display，否则 50004） |
| `submit_market_app` | `{ appCode, withDemoData? }`           | `{ ok, listingCode, status: 'pending' }`         | `MarketFacade.submitMarketApp` → `ListingService.submit`（50013/50015）                                       |

- 三工具 **write 级确认卡**（确认文案含后果：「开启后匿名可访问」/「提交即冻结快照、进入人工审核、通过后可被复制」）；perms 留空（属主自服务）；关键词 app 组**复合词**（应用市场/市场审核/提交市场/发布到市场/上架应用/市场条目/公开发布/暴露），不抢 siteCms 的「发布/审核/通过」等泛词。
- **模型闭环流**：`list_data_apps`（读状态与 `missing`）→ `expose_data_app` 逐项补齐 → `publish_data_app` 开公开 → `submit_market_app` 提交市场。
- **缺项可操作化（R122 落地）**：`collectPublishMissing` 的两条「至少需要…」文案带**清单**（本应用表名 / 可用 display 页 `名称(code)`），模型据此可直接选取 expose 目标，无需再问用户。
- 能力清单新增 3 行（`app.expose` / `app.publish` / `app.market`，工具总数 41）；**合注预算按 R123 腾挪**（精简既有能力行与手册枚举，落地值见 PROGRESS）。

### 29.5 前端（apps/web）

- **应用中心菜单（seed，所有登录用户可见）**：`应用市场`（`app-center/market` → `views/market/index.vue`）、`市场审核`（`app-center/market-review` → `views/market/review/index.vue`，`perms: market:review`，**seed 的 common 角色子树授予中显式排除**——菜单级 perms 会计入权限集合）。
- `views/market/index.vue`：卡片流（名称/描述/发布者/表·页/含演示标记/复制次数/上架时间）+ 详情抽屉（元数据 + 表·页摘要）+ 「复制此应用」（成功后提示并跳新应用结构页）+ 分页；加载中/空/失败三态。
- `views/market/review/index.vue`：双标签「待审 / 在架」（`GET /market/review/list?status=pending|approved`），待审行显示快照摘要（表/页清单），操作为 通过 / 拒绝（`ElMessageBox.prompt` 必填理由）/ 下架。
- 我的应用卡片：`发布到市场`（仅 active 应用且无活跃条目显示主按钮，已有 pending/approved 置灰提示）+ 弹窗（`withDemoData` 勾选 + **逐表行数预览**：`GET /app/:code/schema` 取表 + `POST /app/data/query` op=count 取行数；前后端同 100 行阈值常量，超限红字并禁用提交——服务端仍为唯一权威，超限提交 50015）。
- `api/market/index.ts`：市场 API 客户端（列表/详情/复制/提交/我的提交/审核列表/审核动作）。

### 29.6 安全 / 配置 / 接缝

- 安全：快照 JSON **入出库均过 `snapshot-marshal.core` 校验**（防手改库致物化炸）；复制物化全参数绑定；市场接口全登录态（v1 无匿名浏览）；详情/复制对非在架条目统一 **50014**（防探测）；审核动作全挂 `@OperationLog`。
- 配置（`src/config/market.config.ts`，env 前缀 `MARKET_*`，均可不配）：`market.demoMaxRowsPerTable=100` / `market.snapshotMaxBytes=262144`（256KB）。
- 演示数据**不做附件迁移**（R118 置 null）；跨表引用无法映射的行跳过并计数（边界见 §29.8）。
- 与 P14 接缝：市场版本更新/条目编辑 → 挂账（D111）；市场搜索/分类/评分/评论 → 有真实用户量再立；AI 代审核 → **永不做**（审核是人的事）。

### 29.7 错误码（50013~50015）

| 码    | 含义                                                 | 处理                                                     |
| ----- | ---------------------------------------------------- | -------------------------------------------------------- |
| 50013 | 该应用已有待审或在架条目                             | 提示已有条目编号与状态，引导先下架或等待审核             |
| 50014 | 市场条目不存在或未上架                               | 前端刷新市场列表（防探测，不区分「不存在」与「未上架」） |
| 50015 | 提交内容不合规（演示数据超限 / 快照超限 / 结构非法） | 按 message 带的原因处理（表名/来源）                     |

复用：50001（属主）/ 50002（配额）/ 50004（页面校验）/ 50012（发布缺项）。30xxx / 40xxx 零新增。

### 29.8 已知边界（本期登记）

- **附件不随复制迁移**：演示数据中 attachment 字段值置 null（R118）——副本附件列为空，需复制者自行上传。
- **跨表引用映射失败的行会跳过**：拓扑序外的引用（如环状引用、目标行已被跳过）置空；若该字段必填，则该行按错误行跳过并计数（复制返回值 `skippedRows` 如实给出）。
- **待审/在架条目无发布者自助撤回**：仅 admin 可下架；重复提交在活跃期内被 50013 拦截（D108/D111：下架后重新提交 = 新条目）。
- 市场无匿名浏览、无搜索/分类/版本更新（D111）。

---

## 30. P14：展示应用与数据授权（模型修订期）

> 来源：`docs/P14/PRD-P14-展示应用与数据授权.md` / `ARCHITECTURE-P14-增补.md` / `API-P14-增补.md`（并入 §30 / API §21）。
> 本期为**模型修订期**：+1 域（display）、+2 表，退役 P12 公开面五端点与 `PublicRenderer`，市场快照 bundle 化。

### 30.1 新域 display

`apps/api/src/modules/display/`：**独立 Nest 模块**，两表，**零跨域 import**（铁律 6）；对外只经 `DisplayFacade`（铁律 3）。消费方：

- site 域开放层控制器：静态文件服务 + 数据端点的 R125 校验链，调 `DisplayFacade.assertCanRead(appId, siteId)`；
- app 域（授权管理挂在展示应用视角）与 ai 域工具：经 `DisplayFacade` 创建/挂靠/授权/撤权；
- market 域复制物化：`MarketFacade` → `AppFacade.materializeListing` 扩展后，经 `DisplayFacade.materializeBundle` 落展示应用副本与授权重建（红线：仍全量经 DataService 写数据侧）。

跨域依赖（全部经门面，无模块环）：`CloudFacadeModule`（目录机械移动/存在性）、`SiteFacadeModule`（站点解析与属主校验）、`AppFacadeModule`（属主校验、appId 解析、取数面缓存失效）。

### 30.2 表结构（迁移 `20260930100000_add_display_domain`）

```sql
disp_display (
  id            BIGINT UNSIGNED PK AI,
  owner_id      BIGINT UNSIGNED NOT NULL,        -- 属主（同 app_def.owner_id 口径）
  name          VARCHAR(64)  NOT NULL,            -- 展示应用名（属主内唯一；软删改名释放唯一槽）
  site_id       BIGINT UNSIGNED NULL,             -- 挂靠站点，NULL = 暂存区（未挂靠）
  folder_path   VARCHAR(512) NOT NULL,            -- 挂靠 = 站点内相对路径 `disp/{id}`；暂存 = 云盘暂存区路径
  status        TINYINT NOT NULL DEFAULT 1,       -- 1 正常 0 删除（软删）
  deleted_at / created_at / updated_at,
  UNIQUE KEY uk_disp_owner_name (owner_id, name)
);

disp_grant (
  id          BIGINT UNSIGNED PK AI,
  app_id      BIGINT UNSIGNED NOT NULL,      -- app_def.id
  display_id  BIGINT UNSIGNED NOT NULL,      -- disp_display.id
  granted_by  BIGINT UNSIGNED NOT NULL,
  created_at,
  UNIQUE KEY uk_grant_app_display (app_id, display_id),
  KEY idx_grant_display (display_id)
);
```

`app_def.pub_code` 列保留不删（历史数据无害），停止签发与消费（D115）；`app_def.is_public` 语义转为「**可被授权读取的总开关**」。
`app_page.kind` 收缩为仅 `admin`——存量 display 页由迁移登记（清单见迁移目录 `display-pages-removed.md`：14 行，全为 P12/E2E/冒烟夹具且已软删）后删除（R126）。
错误码新增 **50016**（展示应用不存在/已删除）、**50017**（授权关系已存在/不存在）、**50018**（展示应用名冲突）。

### 30.3 文件与托管模型

- **挂靠即移动**（D116/R127）：展示应用目录物理位于所挂靠站点目录（`site_site.root_folder_id` 树）内，路径 `{站点目录}/disp/{displayId}/`；换挂靠 = 物理移动 + `site_id` 更新（库更新失败即反向移动补偿 = 全回滚）。未挂靠 = 目录在属主云盘暂存区（`{display.stagingPath}/{ownerId}/{displayId}/`）。
- **开放层静态服务**：`GET /api/open/:slug/disp/:id/**`——校验该展示应用存在、未软删、且 `site_id` = 该 slug 站点（`DisplayFacade.resolveForOpen`）；从站点目录子树流式返回，`R26` MIME 判定与 index 回退/SPA 回退**复用站点静态同一流程**。暂存区不对外服务，未挂靠即 40400（§30.8 ④）。
  **路由声明顺序**：展示应用路由必须声明在站点静态通配 `:slug/*path` **之前**（控制器内声明顺序 = 注册顺序）；否则 `/disp/:id/` 会被通配吞掉、再经 SPA/美化回退兜成站点首页 200（P14 端到端实测发现并修复）。
- **生成规范**（R124）：AI 生成时提示词强制相对路径 + 同源 `/api/open/<slug>/api/app/<appCode>/...` 取数；`index.html` 为入口。
- **写文件路径**：`DisplayView.writePath`（挂靠 = `{slug}/disp/{id}`，未挂靠 = 暂存区路径，均相对用户云盘根），AI 用云盘写文件工具直接可用。

### 30.4 开放层数据端点（匿名端点的授权化替代）

`GET /api/open/:slug/api/app/:appCode/` 下四端点（取代退役的 `/api/pub/app/:pubCode/*`，参数与 R104 固定口径不变）：

| 端点                            | 说明                                                         |
| ------------------------------- | ------------------------------------------------------------ |
| `/schema`                       | 表结构（暴露三开关过滤后；含枚举选项与 ref 目标表名）        |
| `/tables/:table/records`        | 列表（size≤50、sort≤2、filter≤3、expand≤1 沿用）             |
| `/tables/:table/records/:rowId` | 详情                                                         |
| `/files/:fileId/stream`         | 附件流（R26 MIME；三道闸在 app 域内完成，MIME 结果随流出域） |

**校验链（R125）**：站点存在 → `DisplayFacade.assertCanRead`（站点下任一挂靠展示应用存在 `disp_grant` 命中该 app）→ `app_def.is_public=1` → 表/字段暴露三开关。任一不满足 → **40400**（对外不区分原因；参数错仍 40001；限流 42900 独立配额沿用）。**缓存与失效沿用 P12**：数据 60s + 写后 DEL（授权/暴露/is_public 变更均触发 DEL：display 域经 `AppFacade.invalidatePublicCache`）、schema 600s。双路径执行器（DB 下推/内存 1 万行帽 50009）原样复用。

### 30.5 退役清单（T126/T127）

- `/api/pub/app/:pubCode/**` 五端点（manifest / 页 schema / 数据列表 / 数据详情 / 附件流）**整体删除**（控制器移除，访问即 404 不存在路由）；`pub_code` 停止签发与消费。
- `PublicRenderer`、前端 `/pub/app/:pubCode` 与 `/p/:pageCode` 路由、`api/app/pub.ts` 客户端、display 页编辑/预览入口移除；页编辑器「草稿预览」改由 `ReadonlyRenderer`（登录态直查、零写请求）承接。
- 发布校验（R103 修订）只要求 **≥1 张已暴露表**（display 页两项条件随展示页废弃取消）；`expose_data_app` 收缩为 `table` / `field` 两档。
- PATCH2「README 三模板 · 数据应用公开接口」节与 `list_data_apps` 输出重写为授权取数口径（D118）；`smoke:ai` M 场景按新口径改写、新增 O 场景（bundle 复制全链）。

### 30.6 市场 bundle（T129）

- **快照结构扩展**：`market_listing.snapshot` 增加 `displays[]`（`{name, files:[{path,content}]}`）与 `grants[]`（`{displayName}`——数据应用即快照所属应用，授权边以展示应用名指向 `displays[]`；`SNAPSHOT_VERSION` 保持 1，旧快照缺这两字段时归一为空数组，向后兼容）。提交时由 market 域经 `DisplayFacade.exportBundle` 取**出边闭包**（该 app 授权的全部展示应用；挂靠态从站点目录读文本文件，未挂靠只带名称），`submit_market_app` 与 `POST /api/market/submissions` 响应 `displays[]` 逐条列明。
- **复制物化**：`AppFacade.materializeListing` 先按原流程物化数据应用（返回 `appId`），再 `DisplayFacade.materializeBundle(userId, newAppId, {displays, grants})`：接收方名下逐个建 `disp_display`（重名自动 `xxx(2)` 递增，超 `display.copyNameSuffixMax` 记为 skipped）、写文本文件（一律进未挂靠暂存区）、按 `displayName → 新 id` 映射重建 `disp_grant`（指向新 appId）。`POST /api/market/:code/copy` 响应附 `displays: [{id,name,siteId}]` 与 `skippedDisplays[]`。
- **边界（R128）**：快照冻结；反向边不带；二进制素材不随包（断链自担）；审核含文件内容过目。

### 30.7 AI 工具链（41→43）

| #   | 工具                 | 类型         | 参数                              | 说明                                                                            |
| --- | -------------------- | ------------ | --------------------------------- | ------------------------------------------------------------------------------- |
| 42  | `create_display_app` | 写（确认卡） | `{name, siteSlug?}`               | 创建展示应用；无站点/不填 → 暂存区；返回 `id/writePath/urlPreview` 与下一步指引 |
| 43  | `authorize_data_app` | 写（确认卡） | `{appCode, displayId, isGranted}` | 授权/撤权，镜像 `expose_data_app` 模式（未发布应用回喂 hint）                   |

既有工具修订：`list_data_apps` 输出改授权口径（`apps[].grantedDisplays` + 顶层 `displayApps[]`，不再给 pubCode 直链话术）；`submit_market_app` 确认卡扩展 bundle；`publish_data_app` / `expose_data_app` 语义与文案同步新口径。`check:ai` **19/19**（新增「授权展示应用」路由样例）+ `smoke:ai`（M 改写、新增 O）必过（T95 纪律）。手册腾挪按 R129（通用版 959/1000、能力清单 978/1200、合注 1988/2000）。

### 30.8 已知边界

① bundle 展示文件断链自担；② 管理端审核人工过目打包文件；③ 展示副本无数据时空渲染（与数据侧演示数据选项正交）；④ 暂存区展示应用仅属主后管可见，公开访问一律 40400；⑤ 跨用户复制的授权重建**不包含**接收方反向授予他人（复制后授权图 = 快照出边闭包的镜像）；⑥ 展示应用文件仅文本白名单（HTML/CSS/JS/JSON 等）随包读取与写入，二进制素材（图片/字体等）不随复制迁移。
⑦ **删站不清理挂靠关系**（P15-C 走查对遗留 39 的裁决，2026-10-02 维持现状）：删除站点是**软删**（进回收站），展示应用的 `site_id` 保留悬空值——保留「站点从回收站还原」后的挂靠恢复路径；**读写两侧已按「未挂靠」收敛**（口径一致：开放层静态入口与取数面均不可达）。级联解绑的关闭条件是「站点从回收站**彻底删除**」（届时另立任务）。用户指引口径：**如需恢复展示应用访问，先从回收站还原站点，其挂靠关系即自动恢复**。

---

## 31. P15：对外开放接入层（地基收敛 + 外部系统接入）

> 来源：`docs/P15/PRD-P15-OPEN-ACCESS.md` / `ARCHITECTURE-P15-增补.md` / `API-P15-增补.md`（并入 §31 / API §22）。
> 本期为**接入层新建期**：+1 域（access）、+2 表（`acc_credential` / `acc_audit`）、+11 端点（管理侧 7 + 对外 4）、+3 错误码（50019~~50021）、+1 配置组（`ACCESS_*`）；开放层取数路径收窄为**展示应用级**（D123）并退役站点级旧路径；**零新依赖**（MCP SDK 属下期 D130 预登记，本期不安装）。

### 31.1 新域 access

`apps/api/src/modules/access/`：**独立 Nest 模块**，表前缀 `acc_`，**零跨域 import 业务模块**（铁律 6）；对外只经 `AccessFacade`（铁律 3）。子模块（实施后结构）：

```
modules/access/
  access.module.ts          # 聚合：CredentialModule + ExtModule + AccessFacadeModule
  credential/               # 凭证生命周期（管理侧 /api/access/credentials/**）
    credential.controller.ts / credential.service.ts / credential.util.ts（密钥生成与解析）/ dto/
  ext/                      # 对外取数面（凭证态 /api/ext/v1/app/:appCode/**）
    ext-auth.guard.ts       # Bearer 凭证解析 → request.principal；401 + WWW-Authenticate
    ext-data.controller.ts  # 四端点；@UseInterceptors(AuditInterceptor, QuotaInterceptor)
    ext-contract.service.ts # 契约冻结层：envelope / 游标 / keyset 分页 / scope 投影
    ext-path.util.ts        # 路径 → 端点名（守卫与审计共用）
  quota/                    # quota.service.ts（Redis 双窗）+ quota.interceptor.ts（429 + Retry-After + 响应头）
  audit/                    # audit.service.ts（异步缓冲落表 + 检索 + 清理编排）/ audit.interceptor.ts / audit.controller.ts / access-clean.task.ts
  facade/                   # access-facade.service.ts：writeAudit（site 域开放层唯一消费点）
```

跨域依赖（全部经门面，无模块环）：出向 `AppFacadeModule`（取数五方法 + `exposedSchemaOf` / `appBriefByIds` / `invalidatePublicCache`）；入向 site 域开放层经 `AccessFacade.writeAudit` 埋匿名取数审计（app 域与 display 域**无感知**）。

### 31.2 表结构（迁移 `20260930120000_add_access_domain`）

```sql
acc_credential (
  id            BIGINT UNSIGNED PK AI,
  owner_id      BIGINT UNSIGNED NOT NULL,        -- 属主（同 app_def.owner_id 口径）
  app_id        BIGINT UNSIGNED NOT NULL,        -- 一凭证一应用（D126）→ KEY idx_cred_app
  name          VARCHAR(64)  NOT NULL,           -- 备注名（属主内不要求唯一）
  key_id        VARCHAR(16)  NOT NULL,           -- 'ik_' + 10 位 base62，定位索引
  secret_hash   CHAR(64)     NOT NULL,           -- sha256(secret) hex；secret 不落库
  secret_prefix VARCHAR(8)   NOT NULL,           -- secret 前 4 位（列表回显、可溯源）
  scope         JSON         NOT NULL,           -- {tables:[], fields:{table:[field]}, ops:['read'], rowFilter:null}
  status        TINYINT      NOT NULL DEFAULT 1, -- 1 active / 0 revoked（吊销不可逆）
  expires_at    DATETIME NULL,                   -- NULL = 不过期（惰性判定，无 cron）
  last_used_at  DATETIME NULL,                   -- 异步更新（允许分钟级延迟）
  created_at / updated_at,
  UNIQUE KEY uk_cred_keyid (key_id),
  KEY idx_cred_owner (owner_id, status)
);

acc_audit (
  id             BIGINT UNSIGNED PK AI,
  principal      VARCHAR(40) NOT NULL,           -- 'display:{id}'（匿名层）| 'cred:{id}'（凭证层）
  owner_id       BIGINT UNSIGNED NOT NULL,
  app_id         BIGINT UNSIGNED NULL,           -- 失败链路过早（如应用不匹配）可为空
  endpoint       VARCHAR(32) NOT NULL,           -- schema / records / detail / file
  table_name     VARCHAR(64) NULL,
  params_summary VARCHAR(512) NULL,              -- 查询参数摘要（截断；不含返回内容）
  rows           INT NOT NULL DEFAULT 0,         -- 返回行数
  duration_ms    INT NOT NULL DEFAULT 0,
  ip             VARCHAR(64) NULL,
  result_code    INT NOT NULL,                   -- 0 / 40001 / 40400 / 42900 / 50019 …
  created_at     DATETIME NOT NULL,
  KEY idx_audit_cred_time (principal, created_at),
  KEY idx_audit_owner_time (owner_id, created_at),
  KEY idx_audit_created (created_at)             -- 90 天清理扫描用
);
```

设计要点：**不建 `acc_grant`**（D126 一凭证一应用，授权关系即凭证行本身，`scope` 内嵌）；`acc_audit` 是高基数流水表（不设外键、不做 JOIN；索引只服务「按凭证 / 按属主 / 按时间」三类查询与清理扫描）；本期 `acc_credential` **不设 `type` 列**（`oauth_token` 属演进预留，见 §31.9）。

### 31.3 凭证校验链（`ext/ext-auth.guard.ts`，R130/R131/R132-1）

```
Authorization: Bearer {keyId}.{secret}
  │ 缺头 / 形态不符（无点号、keyId 非 ik_ 前缀、secret 过短）
  ▼ 按 key_id 查行（uk_cred_keyid）
  │ 不存在 → 401 ｜ sha256(secret) ≠ secret_hash → 401 ｜ status=0 → 401 ｜ expires_at 已过 → 401
  ▼ request.principal = { type:'credential', credentialId, ownerId, appId, scope }
  异步更新 last_used_at（不阻塞响应）
```

- **401 语义真实化**：`HTTP 401` + `WWW-Authenticate: Bearer realm="iplat-ext", error="invalid_token"` + body `{code:50019}` —— 外部系统与下期 MCP 客户端据此发现授权要求；这是与**匿名层「HTTP 200 + 40400」防探测口径的刻意分治**（凭证错误不泄露资源存在性，应用 / 资源层失败仍统一 40400）。实现要点：网关 `GlobalExceptionFilter` 支持「自带业务码的 HttpException」（响应体 `code` 为数字时优先于状态码映射表，Nest 默认体无该字段故既有行为不变）。
- **校验不缓存**（每请求一次主键级查询）：吊销 / 轮换**立即生效**，无失效传播问题；代价由配额兜住。
- **401 也留痕**（R135 验收要求负例落表）：守卫在抛 401 前经 `AuditService` 记一条（`principal = cred:{keyId}`，`ownerId = 0` 为系统流水，不进属主检索）。

### 31.4 对外契约层（`ext/ext-contract.service.ts`，R136/D124）

**契约冻结层独立成服务**：对外端点不直接透传 `AppFacade` 返回值形状，统一经本层改写——内部响应形状变更不漂移到 v1。

- `schema` → `{data:{app:{name,description}, tables:[…]}}`（表 / 字段已按 `scope ∩ 暴露` 投影）；
- `records` 列表 → `{data:[…行…], paging:{nextCursor, size}}`（**无 total**：全量拉取场景 total 既贵又随写入漂移，管理面用管理侧接口拿 total）；
- `records/:rowId` → `{data:{…行…}}`（**解包**：内部取数执行器返回 `{op:'get', row}`，对外只出 `row`）；`files/:f/stream` → 流式（R26 MIME，`?download=1` 同开放层语义）。
- **游标**：`base64url(JSON({v:1, sort, last:[…]}))`；默认排序 `rowId ASC`；`sort` 至多 2 组白名单字段（R104 口径）且服务端**强制追加 `rowId ASC` tiebreaker**；游标非法 / 与本次 `sort` 不一致 / 长度不符 → 40001；**无 pageNo / offset**。
- **游标值必须规范化**：`Date → ISO 字符串`（比较与写入游标两侧共用 `cursorValue` 归一）。否则时间字段排序翻页时，游标经 JSON 往返由 `Date` 变串、与库内 `Date` 不可比 → keyset 定位失效（返回空页）。**该缺陷由 `smoke:ext` 实测发现并修复**。
- **「不重不漏」的适用边界**：keyset 分页在**单调排序键**（如 `createdAt ASC`）下可保证「边拉边写不重不漏」；默认 `rowId` 是 **UUID（非单调）**，此时翻页**不重**成立、「不漏」不成立（新行可能落在游标之前——非单调键下任何分页方案都无法保证）。`smoke:ext` 因此分两条断言：默认排序断「不重」，`sort=createdAt:asc` 断「不重不漏」。
- 行字段名 = 用户逻辑字段名（`app_field.name`）；`rowId / createdAt / updatedAt` 恒留；内部列（`r_cN`、`app_id` 等）不出域；`scope.fields` 对行数据同样收窄（内置三件套恒留，`expanded` 内层一并裁剪）。
- **附件流判定链（P15 为两步；W11/T151 补上第三步）**：① `app_attachment_ref` 引用存在（`deleted_at` 过滤）② 所属表·字段有效暴露
  ③ **凭证 scope 交集**（credential 分支：引用集合中至少一条 `(表, 字段)` 落在 `scope.tables` 与 `scope.fields[表]` 内，见 §33.5）——
  全部越界与「未引用」同表现 **40400**；`display` / 匿名分支无 scope 概念，不传判定谓词（P14 口径不变）。
- **行级过滤（P17 §33）**：`records` / `records/:rowId` 受 `scope.rowFilter` 强制 AND 收窄（详情不满足 → 40400）；
  附件流**不参与**行级判定（附件随记录可见性）。

### 31.5 配额与审计横切（R134/R135/R141）

- **quota.interceptor**（仅挂 `ExtDataController`）：进入时预检并计数 `req/min` 与 `req/day`（`INCR` + 首写 `EXPIRE`），超限 → `HTTP 429` + `code=42900` + `Retry-After`（按窗口重置点算）；响应完成后按**返回行数** `INCRBY rows/day`——行数**响应后记账**（先放行后扣账；单日超额 ≤ 一次页大小，可接受）。成功响应带 `X-RateLimit-Remaining-Minute` / `-Day` / `X-RateLimit-Rows-Remaining-Day`。**匿名层既有「60 次/分/IP」限流保留不动**（防爬，与凭证配额是两层）。
- **audit.interceptor**：挂 `ExtDataController` **最外层**（以覆盖内层配额 429 与 handler 侧 40400/40001 负例），从 `request.principal` + `res.locals.extAudit`（controller 只报告 `endpoint / tableName / rows / paramsSummary` 事实，记账集中一处）组装条目投递 `AuditService`；locals 缺失（负例在 handler 前抛出）时经 `extEndpointOf(request.path)` 兜底推断端点。
- **AuditService**：内存缓冲队列，**每 5s 或满 100 条** `createMany`；`onApplicationShutdown` drain；写库失败只记日志不阻断取数（进程崩溃损失 ≤ 5s 流水，登记为可接受口径）。保留 90 天：`AccessCleanTask`（`0 0 5 * * *`）分批（1000/批）删除。
- **匿名层埋点**：开放层取数控制器在响应出口（含异常路径）调 `AccessFacade.writeAudit({principal:'display:{id}', …})`——site 域对 access 域的唯一依赖，走门面；站点解析失败（无法归属属主）时不记。
- Redis Key（已登记 §9）：三键见 §9 Redis Key 表；**审计不落 Redis**（内存缓冲即可）。

### 31.6 开放层路径收窄与主体化（R137/R138；site 域 + display 域改动）

| 项                  | 变化                                                                                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 数据端点            | `GET /api/open/:slug/api/app/:appCode/**` → **`GET /api/open/:slug/disp/:id/api/app/:appCode/**`**（旧路径控制器移除）                                                                                                   |
| 校验链（R125 修订） | 站点存在 → **该 `displayId` 存在、未软删、且挂靠该站点**（`DisplayFacade.resolveForOpen`）→ `disp_grant(displayId, appId)` 命中 → `is_public=1` → 表 / 字段暴露三开关；任一不满足 40400                                  |
| 判定主体化（R138）  | `DisplayFacade.assertCanRead(appId, principal)`，`principal ∈ {display, credential}`：display 分支查 `disp_grant`；credential 分支由 access 域自行完成（R132 第 2~4 步，不需要 `disp_grant`）——签名为下期 MCP 的复用挂点 |
| 路由双保险          | 数据控制器声明在 `:slug/disp/:id/*path` 与 `:slug/*path` 通配**之前**；静态侧对 `disp/:id/api/**` 子前缀直接 40400（不落入文件解析）                                                                                     |

**实施实测两点（归档备查）**：

1. **旧路径退役表现 = `HTTP 200 + code 40400`**（而非 HTTP 404）：旧路由已无控制器，请求落到站点静态通配 `:slug/*path`，由「首段 `api`」双保险统一 40400（平台业务错误恒 HTTP 200）。「数据不可得」口径成立，但断言须按业务码而非状态码。
2. **P14 边界①（授权粒度止于站点）已闭合**：`smoke:ext` 用**同站点第二个未授权展示应用**实测 40400。

**生成规范修订（R124 改）**：展示应用页面取数用**同源相对路径** `./api/app/<appCode>/...`（页面位于 `disp/{id}/` 下，天然的挂载点）；站点**根目录页面**取数须用绝对路径 `/api/open/{slug}/disp/{id}/api/app/{appCode}/...`（相对路径会落到站点根 `api/app/...` = 已退役旧形态）；站点 README 三模板「数据应用取数」节与 `create_display_app` / `authorize_data_app` 文案同步改写（工具链变更 → `smoke:ai` 必跑）。

**存量迁移**：P14 与本期间隔极短、存量展示页极少；按「预期破坏窗口」处理——用户重新生成或手改取数路径（不动用户文件是更优纪律），发布说明明示。

### 31.7 配置组（`src/config/access.config.ts`，env 前缀 `ACCESS_*`）

| 键                             | 默认   | 说明                                         |
| ------------------------------ | ------ | -------------------------------------------- |
| `access.maxCredentialsPerUser` | 20     | 每用户凭证数上限（按 active 计；超限 50020） |
| `access.quotaPerMinute`        | 120    | 每凭证请求数/分                              |
| `access.quotaPerDay`           | 50000  | 每凭证请求数/日                              |
| `access.rowsPerDay`            | 100000 | 每凭证返回行数/日                            |
| `access.auditRetentionDays`    | 90     | `acc_audit` 清理窗口                         |
| `access.auditFlushMs`          | 5000   | 审计缓冲 flush 间隔                          |

### 31.8 错误码（§18.3 段续，本期 +3）

| 码    | 含义                                                | 场景                                                               |
| ----- | --------------------------------------------------- | ------------------------------------------------------------------ |
| 50019 | 凭证缺失 / 无效 / 已吊销 / 已过期                   | 对外四端点（**HTTP 401** + `WWW-Authenticate`；body `code=50019`） |
| 50020 | 凭证数达上限                                        | 管理侧创建                                                         |
| 50021 | 授权范围越界（scope 引用未暴露 / 不存在的表或字段） | 管理侧创建 / 编辑 scope                                            |

复用：40001 / 40400 / 42900 / 50001 / 50009。**50xxx 段用至 50021，下一可用 50022。**

### 31.9 演进预留（本期不做，架构不堵路）

1. **MCP 适配器（P15-C 已落地，D129~D134）**：`access/mcp/` 协议适配器已交付，复用 `ExtAuthGuard` / 配额 / 审计管线；`@modelcontextprotocol/sdk` + `zod` 已引入。详见 **§32**。
2. **OAuth2 client_credentials（P18 已落地，D139~D142）**：`access/credential/` + `access/ext/` 交付 `type` 列与 token 端点，守卫双形态（`ik_*` / `it_*`），配额 / 审计 / 取数链零改动。详见 **§34**。
3. **行级 `rowFilter`（P17 已落地，D136~D138）**：`access/credential/` 管理侧校验 + `PubDataService` 强制过滤通道 + `common/utils/query-filter.util.ts` 单一解析器；行级 `rowFilter` 与 W11 附件流收窄均已交付。详见 **§33**。
4. **轮换双活窗口**：v1 轮换即时生效；双活需第二有效 secret 槽（加列）。
5. **多应用凭证**：若 D126 将来放宽为一对多，拆 scope 出 `acc_grant` 表即可，凭证行不动。
6. **审计维度扩展**：`acc_audit` 已含 `tableName` 与 `paramsSummary`，按需加列即可。

### 31.10 资产登记

`AccessFacade.writeAudit` / `quota.service` / `audit.service` / `ext-contract.service` / `ext-path.util` / `access 前端资产` —— 明细见 §9 公共资产表。

---

## 32. P15-C：MCP 适配器（协议适配层）

> 在 §31 的对外契约之上加一层**协议适配**（REST 语义 → JSON-RPC 工具语义）：外部 Agent（Claude Desktop / Cursor 等）
> 以 MCP 客户端身份读取已授权数据应用。**不新立域、不加表、不加错误码、不加配置键**（D129~~D134 / R142~~R146）。
> 需求基线 `docs/P15C/`；本章为主文档收编，实测校正见 API §23.7。

### 32.1 模块结构（access 域内）

```
apps/api/src/modules/access/mcp/
├── mcp.controller.ts        # POST /api/ext/mcp（守卫+配额+审计）；GET/DELETE → 405
├── mcp-server.factory.ts    # 每请求构建 McpServer + StreamableHTTPServerTransport（无状态）
├── tool-registry.ts         # 工具注册出口（SDK 泛型类型切断点，见 §32.11）
├── tools/
│   ├── tool-deps.ts         # 工具层依赖（principal / appFacade / contract / ctx）
│   ├── get-schema.tool.ts   # iplat_get_schema
│   ├── query-records.tool.ts# iplat_query_records
│   └── get-record.tool.ts   # iplat_get_record
└── tool-errors.ts           # 业务错误 → isError 文本（含业务码）+ 每请求上下文
```

工具层与传输层解耦：三个工具是纯函数式注册（接收 `McpToolDeps` 上下文），工厂换 transport 即可产出远期 stdio 形态。

### 32.2 无状态请求生命周期（D131 / R142）

```
POST /api/ext/mcp
  → ExtAuthGuard（§31 既有：Bearer 校验 → request.principal；失败 401 + WWW-Authenticate + 50019 + 守卫留痕）
  → 配额预检 + 计数（+1）+ X-RateLimit-* 回带
  → factory.create(principal, ctx)：new McpServer({name:'iplat-ext'}) + new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
      └─ 应用可见性校验（未软删 + is_public=1，否则 40400）+ 注册三件套工具（principal 经闭包注入）
  → transport.handleRequest(req, res, body)（响应直写，JSON 形态）
  → finally：server.close() + 行数记账 + 审计落一条（成功与负例都记）
```

- 无 `sessionId` → 无会话存储、Redis 零新增键、横向扩容无障碍。
- `enableJsonResponse` → 无 SSE 长连接、无服务端推送面。
- **无状态 = 无跨请求状态**：principal 与请求上下文（行数 / 业务码）都在请求内闭环，天然隔离。

### 32.3 认证链（零改动复用）

- 守卫、401 语义、`WWW-Authenticate: Bearer realm="iplat-ext"`、守卫层 401 留痕（`principal=cred:{keyId}`、`ownerId=0`）全部沿用 §31 既有实现。
- MCP 客户端的标准认证发现行为即 401 + `WWW-Authenticate`，与远期 OAuth 2.1 方向兼容（§31.9）。
- **例外**：`GET`/`DELETE` 的 405 **不经过守卫**（守卫只挂 `POST`）——405 不触数据逻辑，且 R142 要求「一律 405」；
  若挂类级，未认证的 GET 会先撞 401 使 405 永不可达（实测确认）。
- **secret 边界**：secret 不进 `initialize` 响应、不进工具描述、不进审计参数摘要。

### 32.4 工具 → AppFacade 调用链（R146 数据通道零改）

```
tool 调用（principal = credential）
  → 凭证行解析 appId（D126 一凭证一应用；MCP 路径不带 appCode）
  → scope 收窄（§31：表 / 字段 / ops 三纵深，fields 禁通配）
  → 复用 ext-contract 同一取数实现（R104 约束 + keyset 游标，§31.4）
  → envelope 输出（structuredContent + content[0].text 双形态）
```

- **三个工具与 REST v1 端点共用同一取数实现**（协议壳不同，内核同一函数）——游标编解码器是同一份代码，
  故带出 API §23 的两个可验收性质：**逐字段一致**与 **`nextCursor` 跨协议混用**（`smoke:mcp` 双向实测通过）。
- 行数配额事后记账：`query_records` 按返回行数、`get_record` 记 1 行（复用 §31.5 的 post-response 计数口径）。
- 取数一律经 `AppFacade`（内部仍走 `DataService.queryForPublic`），**本层不新开任何数据通路**。

### 32.5 错误映射（R144，分层）

| 层                    | 场景                                                 | 表现                                              |
| --------------------- | ---------------------------------------------------- | ------------------------------------------------- |
| HTTP（守卫 / 控制器） | 无 / 伪 / 吊销 / 过期凭证                            | `401` + `WWW-Authenticate` + `50019`              |
| HTTP（控制器）        | 请求 / 行数配额超限                                  | `429` + `Retry-After` + `X-RateLimit-*` + `42900` |
| HTTP（控制器）        | 方法不允许（GET / DELETE）                           | `405` + `Allow: POST` + `40001`                   |
| 工具结果              | 表未暴露 / 越权行 / 应用不可见                       | `isError=true`，text 含 `40400`                   |
| 工具结果              | 入参形状 / 边界违例（SDK 前置 zod 校验）             | `isError=true`，text 含 `-32602`                  |
| 工具结果              | 入参语义违例（filter/sort 格式、游标与 sort 不一致） | `isError=true`，text 含 `40001`                   |
| JSON-RPC              | 未知方法                                             | 标准 `-32601`（SDK 自理）                         |

原则：**认证与配额在 HTTP 层解决**（客户端可自动发现 / 重试），**业务语义在工具结果内解决**（Agent 可读文本自纠）。

### 32.6 配额与审计记账点（R145）

- **请求配额**：controller 层每个 JSON-RPC POST 计 1（`initialize` / `tools/list` / `tools/call` 均计）——防「空握手刷接口」。
- **行数配额**：仅两个数据工具事后记账（`ctx.rows` 由工具写回，controller 统一提交，R141 同口径）。
- **审计 event**：`mcp.initialize` / `mcp.tools.list` / `mcp.tools.call`（其余方法 `mcp.{method}`）；
  `paramsSummary` = 工具名 + 入参摘要（≤512 字截断，**不含响应内容**）；`principal / ownerId / endpoint / resultCode / rows / durationMs / ip` 沿用 `acc_audit` 现有列。
- 401 由守卫留痕（`ownerId=0`，端点名 `mcp`）；429 在抛异常前记账。

### 32.7 路由注册与静态双保险

- `/api/ext/mcp` 与 `/api/ext/v1/**` 同族（`/api/ext` 前缀），**不经** site 域的静态通配（后者作用域仅 `/api/open/**`）。
- `smoke:mcp` 已加顺序断言：正例可达（initialize / tools/list）+ **伪路径 `/api/ext/mcp/extra` → 40400**（路由精确，未被通配吞并）。
- 控制器同时声明 `GET` / `DELETE` → 405 + `Allow: POST`，避免落到全局 404 歧义。

### 32.8 安全注意

- 认证兜底始终是 Bearer 凭证，**不依赖 Origin**；无会话 = 无会话劫持面；无服务端推送 = 无 SSE 长连接资源占用面。
- 工具描述对外可见（下发客户端）：不含内部实现、URL、secret（`smoke:mcp` 已断言）。
- 新依赖两个（SDK + zod，见 API §23.7 ④），版本由 `pnpm-lock.yaml` 锁定。

### 32.9 演进预留（本期不做）

- **stdio 自托管**：工具层已与传输层解耦，工厂换 transport 即可；单独立项。
- **OAuth 2.1**：`acc_credential` 加 `type` 列 + `WWW-Authenticate` 发现机制已兼容（同 §31.9）。
- **通知 / 订阅能力**：需要有状态会话 + 会话存储，届时**须推翻 D131 无状态口径**（文档先行）。
- **写操作 / aggregate 工具**：须先修订 R143 工具集冻结口径；aggregate 还需评估执行器超时与行数帽。

### 32.10 资产登记

`mcp.controller` / `mcp-server.factory` / `tool-registry` / `tools/*`（三个工具 + deps）/ `tool-errors` / `scripts/smoke-mcp.ts`（`pnpm smoke:mcp`，36 项）
—— 明细见 §9 公共资产表。

### 32.11 工程处置：SDK 类型切断点（`tool-registry.ts`）

SDK 的 `McpServer.registerTool` 泛型会对入参做逐键 `ShapeOutput` 展开，并叠加 zod v3/v4 双版本兼容类型；
实测在 TS 5.8 + zod 3.25 下**任何**调用都触发 `TS2589`（连 `z.array(z.string()).optional()` 都炸，编译堆加到 4 GB 仍失败）。
这是 SDK 的类型表达问题，非调用方写法问题。

处置：`tool-registry.ts` 内以 `as unknown as` 收敛 `registerTool` 签名（**唯一一处类型切断点**），
`inputSchema` 因此按 `Record<string, unknown>` 传递——**运行时零差异**（SDK 原方法、zod 校验照常、JSON Schema 照常下发客户端），
仅不再静态推导 handler 入参形状（各工具文件以显式 `QueryArgs` 类型 + cast 收口）。
SDK 修好类型后，删除该文件、各工具直接调 `server.registerTool` 即可，工具实现不动。

---

## 33. P17：rowFilter 行级收窄（授权第四纵深）+ W11 附件流补丁

> 在 §31 的「表 / 字段 / 操作」三纵深之上启用**行级**收窄（P15 Q8 预留的 `scope.rowFilter` 槽位），
> 并结清 P15-C 走查开出的 **W11 补丁**（对外附件流纳入 scope 交集）。**零新表、零迁移、零新端点、
> 零新错误码、零新依赖**（D136~~D138 / R147~~R150 / T151~T154）。需求基线 `docs/P17/`。

### 33.1 落点（零新表、零文件结构变动）

- 存储：`acc_credential.scope` JSON 的 `rowFilter` 槽位启用（DDL 不变，`{ tables, fields, ops, rowFilter }`）。
- 改动集中三处：
  - `access/credential/`：创建 / 编辑校验链加 rowFilter 校验段（R147）；
  - **取数内核强制过滤通道**：`PubDataService.listAll / getRow` 新增 `mandatoryFilters` 参数（R148）；
  - `common/utils/query-filter.util.ts`：R104 过滤语法**单一实现**（pub 域与 access 域共用，见 §33.6）。
- MCP（`access/mcp/`）**仅两行改动**——三件套把 `contract.mandatoryFilters(table, scope)` 透传给同一门面（R150 透明继承）。

### 33.2 校验链修订（管理侧，创建 / 编辑凭证）

```
scope 校验（既有：tables ∈ 暴露表、fields ∈ 暴露字段、ops 合法 → 50021）
  → 【新增】rowFilter 校验（R147）：
      rowFilter 须为对象（否 50021）
      每表：表 ∈ scope.tables（否 50021）→ 值须为 1~3 条字符串（否 50021）
      每条：形态/算子（R104 同一解析器）→ 字段 ∈ 该表 scope 字段口径 → 字段已暴露 → 值类型可解析
           任一不符 → 50021（errmsg 指明「表 + 条目 + 原因」）
```

- 解析器复用：与 §31 的 R104 请求 filter **同一实现**（`common/utils/query-filter.util.ts`），
  管理侧只补 scope 语义，不新写语法（R147）。

### 33.3 查询注入语义（R148）

```
对外取数（records / detail）
  → 既有：scope ∩ 暴露投影（表 / 字段）
  → 【新增】rowFilter 条件串 → app 域**同一解析器**解析为执行器条件（强制过滤通道）
  → 既有：请求 filter 参数 → 解析为执行器条件
  → 两者**并列进入同一 filter 数组** → WHERE 段 AND（含同列并列，见下）
  → 既有：sort + rowId tiebreaker → keyset 游标
```

- rowFilter 与请求 filter 是**并列 AND**，无优先级；冲突 = 空集 = 空页正常返回。
- **同列多条件必须并列 AND**（本期实测抓出的真缺陷修复）：`DataService.buildDbWhere` 原先用
  `Object.assign` 组装同一 `r_cN` 列的条件，**后者覆盖前者**；rowFilter 引入后这会让请求 `filter`
  顶掉强制条件（收窄变放宽）。现改为：该列已有条件时把新条件推入 `AND` 数组（语义与内存过滤路径一致）。
- **detail 同样注入**：`op: 'get'` 不支持 WHERE 段，故**有强制条件时改走 list 路径**（同一 WHERE + 按 `rowId` 定位）；
  行不满足 rowFilter 与行不存在**同表现 40400**（防探测不裂缝）。无 rowFilter 时保持原单行直取（零额外开销）。
- 游标与排序零影响（rowFilter 是常量 WHERE，不进游标值）；SQL 注入面：全部走同一解析器 + 参数化绑定。

### 33.4 运行期失效判拒（R149）

取数时对 rowFilter 引用做再校验：表 / 字段任一失效（下线 / 取消暴露 / 软删）→ 该表**判不可见 40400**。
**不静默跳过失效条目**（跳过 = 结果集放大 = 安全回归）。恢复暴露即自愈，无需改凭证。
实现上即「强制过滤条件走与请求参数同一解析器」的自然结果：解析失败时错误码取 40400（而非请求参数的 40001）。

### 33.5 W11 补丁：对外附件流纳入 scope 收窄（T151）

```
attachmentStream(ownerId, appCode, fileId, range?, refFilter?)
  → 既有：引用索引查找（refs = [{tableId, fieldName}, …]）
  → 既有：表·字段暴露三开关
  → 【新增】调用方注入的 refFilter(tableName, fieldName)：credential 分支传 scope 交集判定，越界引用跳过
  → display / 匿名分支不传 refFilter：口径不变（P14）
```

- **分层实现**（与基线措辞的差异见 API §24.7 ②）：app 域不认识凭证概念（单向依赖），故不接收 principal，
  改由 access 域**注入谓词**；语义与基线一致——全部引用越界 → 40400（与「未引用」同表现）。
- 判定口径与 `assertTableInScope` 完全同款：表 ∈ `scope.tables` ∧（该表未限字段 或 字段 ∈ `scope.fields[表]`）；
  多引用文件任一引用在 scope 内即放行。
- 遗留 38（P15-C 走查开出的「附件流未纳入 scope 收窄」）**由本补丁关闭**。

### 33.6 公共实现：`common/utils/query-filter.util.ts`

R104 过滤语法的**单一实现**（常量 + 纯函数：形态解析、算子集、`contains` 类型准入、值按类型归一），
pub 域（请求 filter / 强制过滤）与 access 域（管理侧 rowFilter 校验）共用。

抽到 `common/` 的动机：access 域不得 import app 域内部实现（铁律 6），若各写一份，语法一旦漂移就会出现
「管理侧放行、运行期拒绝」的裂缝——这正是 R147「复用同一解析器」要防的问题。错误码由调用方决定
（40001 请求参数 / 40400 运行期判拒 / 50021 管理侧校验），解析层只返回结果。

### 33.7 前端（T153，最小产品化）

- 凭证创建 / 编辑抽屉加「**只看部分数据**」textarea（接 JSON 对象，附一行格式说明与示例；遵守界面文案准则）；
- 前端只拦「不是合法 JSON 对象」这类明显笔误，完整校验交服务端（50021 的 errmsg 含条目定位，原样展示）；
- **不下发过滤条件**：`schema` 投影不含 `rowFilter`（§24.3）——外部系统看不到自己被收窄的规则细节。

### 33.8 演进预留（本期不做）

- OR / 嵌套条件树（需结构化 AST，推翻 D136）；变量插值（凭证主体无用户上下文）；
- `disp_grant` 行级（D137 已排除；若做须动 display 域与 P14 链路）；
- 失效判拒的「宽限模式」（告警而非判拒）——先保守，有真实诉求再议；
- 行级**写**（对外本无写）。

### 33.9 资产登记

`common/utils/query-filter.util.ts`（新增）/ `credential.service.buildRowFilter` / `credential.constant.MAX_ROW_FILTER` /
`pub-data.service.parseFilterRaws`（共用解析器）/ `pub-data.service.attachmentStream(refFilter)` /
`data.service.buildDbWhere`（同列 AND 修复）/ `access 前端凭证抽屉文本域` /
`scripts/smoke-ext-access.ts`（57 → P18 后 76 项）/ `scripts/smoke-mcp.ts`（39 → P18 后 41 项）—— 明细见 §9 公共资产表。

---

## 34. P18：OAuth2 client_credentials（接入凭证第二形态）

> 为 `acc_credential` 增加第二形态：客户端用 `client_id` / `client_secret` 在 token 端点换取
> **短时效 access token**，再以 `Bearer it_*` 使用既有全部对外端点（REST / MCP 同管线）。
> **API Key 与 OAuth2 并存、互不影响**（P15 Q2 拍板「先 API Key、架构预留 OAuth」的兑现）。
> 增量：**+1 列（`type`，迁移）/ +1 端点（token）/ +1 配置键 / 零新错误码 / 零新依赖 /
> 内部 AI 工具 43 与对外 MCP 工具 3 均不变**（D139~~D142 / R151~~R155 / T155~T158）。

### 34.1 落点与迁移

- **迁移**：`acc_credential` 加列 `type varchar(16) NOT NULL DEFAULT 'api_key'`（存量行自动 `api_key`，
  **零数据改写**；`20261002100000_add_credential_type`）。
- 改动集中在 `access/` 域：`credential/`（形态校验、令牌存储 `token-store.ts`）+ `ext/`（守卫双形态、
  `oauth-token.controller.ts`）。**配额 / 审计 / 取数 / 工具链零改动**——令牌解析后产出的 principal
  与 API Key 路径**完全同构**。
- `TokenStore` 归属 `credential/` 而非 `ext/`：`ExtModule` 已依赖 `CredentialModule`，反向归属会造成模块循环。

### 34.2 令牌生命周期（D139/R151）

```
签发：POST /api/ext/oauth/token（client_id=keyId, client_secret=secret, grant_type=client_credentials）
  → 凭证校验（sha256 比对、未吊销、未过期；**不限形态**，D141 迁移路径）
  → token = "it_" + base64url(32B)
  → Redis SET acc:token:{sha256(token)} = credentialId，EX = access.tokenTtlSeconds（默认 3600）
  → Redis SADD acc:token:idx:{credId} {sha256(token)}（索引，不随 TTL）
  → 请求配额 +1（D142）；审计 ext.oauth.token

使用：Bearer it_* → GET acc:token:{sha256} → credentialId → **实查凭证行**（R153）→ 同一 principal 管线

失效：吊销 / 轮换 secret → SMEMBERS idx → 逐个 DEL → DEL 索引（即时，R154）
```

- **键是摘要**：令牌原文不落库、不落日志、不进审计；Redis 快照泄露也拿不到可用令牌。
- **索引不设 TTL**：孤儿成员（已自然过期的摘要）在下次签发时顺带清扫（凭证级基数极低，不建后台任务）。
- **不设并发令牌数上限**：令牌风暴由请求配额兜底（D142）。

### 34.3 守卫双形态（R153/R154）

```
ExtAuthGuard.canActivate → resolvePrincipal
  → Bearer {keyId}.{secret}（含点号）→ 凭证校验（type 须 api_key；oauth 型直连 → 401，D141）
  → Bearer it_...（形态匹配）→ Redis 查 credentialId → **实查凭证行**（principalOf）→ 同一 principal
  → 其余形态 → 401 + WWW-Authenticate + 50019（与凭证失效同表现）
```

- **令牌路径为何回查 DB**：令牌只证明「持有者曾用正确 secret 换过令牌」，授权事实（scope / 吊销 / 到期）
  **永远以凭证行为准**——这是「签发后收窄 scope 立即生效」「吊销即时失效」的实现方式，
  无需逐令牌传播失效。
- MCP 端点共用同一守卫（§32.3），故 `Bearer it_*` **天然可用于 `/api/ext/mcp`**；手动 MCP 配置仍推荐
  API Key（令牌 1 小时过期，手贴体验差）。

### 34.4 token 端点契约（D140/R152/R155）

- 路径 `POST /api/ext/oauth/token`（与 `/api/ext/v1`、`/api/ext/mcp` 同族）。
- 入参：`application/x-www-form-urlencoded` 优先（RFC 要求），JSON 宽容；`grant_type` 必填且仅 `client_credentials`。
- 成功：RFC 6749 §5.1 三字段；**不回带 scope**（scope 以凭证行为准，避免快照错觉）。
- 失败：RFC 6749 §5.2（`invalid_client` 401 / `invalid_request`、`unsupported_grant_type` 400）——
  **平台 envelope 与业务码在此端点刻意不适用**（D140：互操作对象是 OAuth 客户端库）；
  唯一例外是配额超限 429 走平台口径（未超 RFC 定义范围，客户端可据此退避）。
- **控制器自写响应**：不经全局响应包装，也不经异常过滤器——「格式分治」的实现落点。
- 401 由控制器 `recordUnauthorized` 等价的 `writeAudit` 留痕（`ownerId=0` 系统流水）；
  secret / token 原文不进审计（摘要只含 `grant_type` 与 `client_id`）。

### 34.5 前端（T157，最小产品化）

- 凭证创建弹窗加「类型」二选一（默认 `API 密钥`）+ 一句话分工说明；编辑态**只读**并提示「类型创建后不可更改」。
- `UpdateCredentialDto` **显式接收 `type` 仅用于报错**：否则全局 `ValidationPipe` 的 `whitelist` 会静默剥离，
  用户以为改成功了（服务层因此返回 40001）。
- 列表新增「类型」列（显示「API 密钥」/「OAuth2 令牌」，不暴露内部标识）。

### 34.6 演进预留（本期不做）

- RFC 8414 发现端点 + MCP 自动 OAuth 流程（归 MCP 二期一并议）；
- 并发令牌数上限 / 令牌清单管理页（本期由请求配额兜底）；
- JWT 自校验令牌（需吊销名单配合，与即时失效姿态冲突）；
- refresh_token / authorization_code（无交互场景）。

### 34.7 实测校正与本期销项（相对需求基线 `docs/P18/`）

1. **修掉一个真缺陷：`access/index.vue` 无法通过 vite 生产构建**（P17 交付遗留，**本期走查 C2 证据抓出**）。
   根因：prettier 把多语句的 `@click="auditDrawer.pageNo = 1; loadAudits()"` 拆成多行，而 Vue 模板表达式
   **不支持换行分隔语句** → vite 编译期语法错误；`vue-tsc` 与 ESLint **都不报**（类型与规则层面均合法）。
   处置：抽 `searchAudits()` 函数、事件改单表达式。**教训**：前端验收资产应含 `vite build`，
   仅跑 `vue-tsc` 不足以证明可交付。
2. **`TokenStore` 模块归属**：基线未指定；实现放 `credential/` 并由此模块导出（避免 ExtModule ↔ CredentialModule 循环）。
3. **配额计入时机**：仅在客户端**通过校验后**计（D142）——无效 clientId 的请求不进配额表（否则凭猜 keyId 即可刷空他人配额）。
4. **审计负例的归属**：`invalid_client` 时无凭证上下文 → `ownerId=0` 系统流水，不进属主检索（与守卫 401 留痕同口径）；
   smoke 因此分两条断言（属主侧正例 + `ownerId=0` 直查负例）。
5. **运维提示**：`prisma generate` 在 Windows 下可能因引擎 DLL 被占用报 `EPERM`（不阻断，类型已生成）；
   `nest build` 可能触发 safe-delete 大量文件确认（清 `dist` 后重建即可）。

---

## 35. P19：站点发布与版本管理（不可变快照 + 指针翻转）+ W12 公开判定链统一

> 站点内容模型升级：**云盘站点目录 = 工作区**，「发布」= 生成**不可变快照** + 翻转指针。
> 一举解决三件事——**权限平面耦合**（快照轨不消费 `is_public`）、**写入非原子**（快照 + 指针翻转）、
> **无回滚且故障域耦合**（云盘改动不再直达公网）。同时合入前置安全补丁 **W12**（公开判定链统一为阻断优先）。
> 编号：D143~~D151 / R156~~R161 / T159~T164（W12 为清单外 T165）。

### 35.1 双轨模型（D143/D144）

```
站点内容
├── 工作区（云盘 site.root_folder_id 子树）        ← 编辑器 / AI 写入；管理态预览读这里
└── 快照区（StorageService 自营区，不经云盘文件树）
    └── site-releases/{siteId}/{releaseId}/       ← 开放层正式位读这里（不可变，R156）

开放层路由（GET /api/open/:slug/**）
  site.active_release_id 非空 → 快照轨（不消费 is_public，R161）
  为空                       → legacy 轨（直挂工作副本；公开判定 = W12 阻断优先）
  :slug/disp/{id}/**        → 恒走 legacy（展示应用独立授权链，不进快照，D150）
```

### 35.2 发布管道（D145/R157）

```
① 建版本行（version_no = 站内 max+1）           ← 先建行以取得 releaseId 作目录名
② 全量子树复制 → site-releases/{siteId}/.tmp-{releaseId}/（含 media/，排除顶层 disp/）
   逐文件 sha256 → manifest（{ 相对路径 → {fileId, contentHash, size, mime} }，随目录落盘，不落库）
③ rename .tmp- → {releaseId}                     ← 同卷原子落位
④ 统计回写 + UPDATE site.active_release_id       ← **最后一步**；此前线上不受影响
⑤ 失效缓存（slug + path）→ 保留策略清理
任一步失败：清理 .tmp- 并删除刚建的版本行（不留半成品）
并发：Redis SET NX（site:publish:{siteId}，TTL 300s 防死锁）抢锁失败 → 40121
```

- **同卷保证原子**：`releasesRoot` 与工作区同在 `UPLOAD_DIR` 下（StorageService 抽象内保证）。
- **行 ↔ 目录同生共死**：删版 / 保留清理 / 删站（`purgeForSite`）都同时清理两者，避免孤儿。

### 35.3 开放层双轨（D148/R159/R160）

- **只换根目录，解析与安全件全部复用**：抽出 `sendFile(load, req, res)` 统一出流（MIME 白名单 + CSP 沙箱 +
  nosniff + ETag/304 + Range/416 + 空闲超时 + 流式），两条轨仅在「取流来源」上不同 —— 安全件只写一遍，不会漂移。
- **`serve()` 增 `track` 参数**：`auto`（默认按站点发布状态选轨）/ `legacy`（展示应用两路由强制）。
- **`site:path` 缓存加轨维度**（`site:path:{siteId}:{track}:{path}`）：legacy 轨写缓存；**快照轨不写**
  （目录不可变，fs `stat` 足够轻，且省掉按轨失效的一致性面）。
- **`.tmp-` 对解析不可见**：中转目录名不同且解析只接受校验过的相对路径，任何探测落 40400。

### 35.4 权限平面解耦（R161，本期的核心安全收益）

`cloud_file.is_public` 原先**同时承担两个信任域的语义**：「云盘分享可见吗」与「站点可访问吗」——
用户为了让页面能访问必须显式公开，同时也暴露给了云盘公开链，属**权限放大**。

快照轨落地后：**站点可见性 = 快照里有什么**，与 `is_public` 彻底分家；`is_public` 回归纯粹的云盘分享语义。
副产物是云盘侧的任何误操作（移动 / 删除 / 改公开性）**都不再直达公网**。

### 35.5 前端（T161）

站点列表页操作列新增「发布与版本」抽屉：发布按钮（可填备注）+ 版本列表（版本号 / 备注 / 文件数 / 大小 /
时间 / 锁定 / 在线标记）+「切到此版」（回滚）+ 锁定 / 删除；**从未发布的站点顶部提示「当前为草稿直出，建议发布」**。
文案遵守界面准则（不出现 `releaseId` / `.tmp` 等内部词）。

### 35.6 W12 公开判定链统一（T165，先行补丁）

**问题**：两条链规则相反 —— `/api/open`（`resolvePublicPath`）遇第一个非 0 节点定生死，**文件自身 `1` 可穿透父级 `2`**；
`/api/pub`（`assertAncestorsNotBlocked`）任一祖先 `2` 即阻断。同一文件两链结论相反 → **权限结论不可推理**（属规格诱导）。

**修复**：统一为**阻断优先**（S3 explicit deny 同构）——`/api/open` 改为「祖先链（含自身）任一节点 = 2 即阻断，
无 2 时遇第一个 `1` 放行」。`/api/pub` 不动（本就是阻断优先）。「取消公开落库为 2」的既有语义维持。
附带前端文案两处：取消公开的确认语说明**这是显式阻断**（非回默认）；公开链接弹窗区分「公开」与「生成分享链接」。

**存量扫描（合入门禁）**：`pnpm scan:pubblock`（`scripts/scan-public-blocked.ts`）扫描「祖先链含阻断且自身显式公开」
的文件，退出码 1 表示存在受影响文件（收紧类变更须用户确认后合入）。本次实测：340 行未删文件、5 行显式公开、
**0 行显式阻断 → 影响面为零，直接合入**。

**待澄清事实的回写**：站点静态限流档值为 **120/min/IP**（代码事实；主文档旧口径 60 已按此回写）；
`site:path` 负缓存**仅在路径完全不存在时写入**，目录命中不写 —— 未越界 P4a T35 纪律，无需收窄。

### 35.7 演进预留（本期不做，挂 Phase2）

- 快照 **nginx / 对象存储直出 + 长缓存（immutable）**：与 StorageService MinIO/OSS 切换同行；
- 快照**物理去重**（manifest 已记 `contentHash`，Phase2 只做存储层）；
- 独立沙箱域服务用户站点（github.io 式，彻底解决同源债）；版本 diff 视图；公网草稿预览环境。

### 35.8 资产登记

`site/release/`（service / controller / preview / module / dto）/ `site/open/site-release-track.service`（快照轨解析）/
`site/open/open-static.controller.serveFile`（双轨统一出流）/ `infra/storage`（快照区：`releaseDirOf` / `copyStorageInto` /
`renameDir` / `removeDir` / `statInDir` / `createDirReadStream`）/ `site/manage`（删站级联 `purgeForSite`）/
`cloud-facade.resolveOwnTreePath`（预览用无公开性解析）/ 站点列表页「发布与版本」抽屉 /
`scripts/smoke-site.ts`（`pnpm smoke:site`，35 项）/ `scripts/scan-public-blocked.ts`（`pnpm scan:pubblock`）
—— 明细见 §9 公共资产表。

---

## 36. P20：展示应用目录独立 + 版本检查点 + 局部发布 + AI 能力同源

> 主题是**展示应用的内容归属**：目录从站点树独立（B1）、发布时聚合进快照（B2）、开放层双轨（B3）、
> 属主检查点（B4/T167）、局部发布（T168）；附带修复 AI 助手「说没有建应用工具」的
> 提示词-工具错位（T170~~T172）。D152~~D153 / R161~~R162 / T165~~T172。

### 36.1 目录独立（B1）与挂靠纯关系化

- 工作区恒定位 `disp-staging/{ownerId}/{displayId}`（建应用即建目录），**与站点树无关**；
- 挂靠 = 只改 `disp_display.site_id`，零文件操作——原「目录随挂靠搬迁」及其三个缺陷
  （`disp/disp/` 双层、整树搬迁牵连、中断后 404）一并移除；
- 存量数据迁移：`scripts/migrate-display-workdir.ts`（含历史缺陷目录兼容）。

### 36.2 发布聚合与开放层双轨（B2/B3）

- 站点发布把各挂靠展示应用的工作区复制进 `快照/disp/{id}/`——对外 URL 不变，站点版本**自包含**
  （回滚站点时展示页内容随之回滚，云盘改动不直达公网）；遍历复用 `common/utils/cloud-tree-copy.util`
  （与检查点同一「工作区 → 不可变快照」实现，防两份遍历漂移）；
- 开放层：已发布 → 快照轨；未发布 → 直读工作区（不再经站点树）。

### 36.3 检查点（T167/D152）与局部发布（T168）

- 检查点 = 存档（可反复写回工作区），与站点发布 = 上线**分治**，不共用表；
  `restore` 先软删进回收站再写回（「恢复错了」可撤）；
- 局部发布 = 以当前版本快照为蓝本只替换一个 `disp/{id}/` 子树——蓝本必须是**已上线那份**
  （工作区可能有别的未发布改动，从工作区重建会把半成品带上线）；
- 模块环处理：删站级联清理降为纯函数（`release/release-cleanup.util.ts`），
  使 `site.release → display.facade` 的聚合依赖不构成环。

### 36.4 AI 能力同源（T170~~T172 / R161~~R162，2026-10-05）

**病根**：能力清单（system prompt）按【权限】过滤，tools 按【权限+路由+模型支持】过滤——
两条通道各自为政，AI 会「知道能做却说没有工具」（用户实测报告）。

- **R161 同源**：清单按本轮**实发工具集**收窄（交集非空才注入）；`supportTool≠1` 时清单不注入、
  助手设定换「无工具」版（原设定在 tools 为空时是谎言）；
- **R162 豁免**：部分命中时 `EAGER_GROUPS = [app, siteLifecycle, system]` 随命中组下发——
  「把云盘里的字帖整理成应用」这类跨域混述不再裁掉创建类能力；
  **（P21 T176 修订：app/siteLifecycle 的豁免改为创建意图触发，system/common 保持恒下发，见 §37.4）**；
- **护栏**：`check-ai-prompt` 新增「能力行工具不跨组」（20 项）——行内纯度保证同源收窄时
  整行随组进退，不出现「行注入了、行内工具缺一半」的中间态。

### 36.5 资产登记

`cloud-tree-copy.util` / `storage.dispReleaseDirOf` / `display-release.{service,controller}` /
`display-release.dto` / `release-cleanup.util` / `site-release.seedFromActiveRelease`（局部装配）/
`display-facade.{listWorkPathsBySite,resolveForRelease}` / 前端 `DisplayReleasesDialog.vue` +
卡片「版本 / 发布到站点」/ `scripts/smoke-site.ts` 第 12 段（40 项）—— 明细见 §9 公共资产表。

---

## 37. P21：AI 上游调用加固（预算预估截断 + 重试落库 + 确认链上下文 + 路由豁免收窄）

> 来源：2026-10-05 AI 提示词工程与工具调用架构走查（用户指令「分析确认架构是否有问题」）。
> 结论：骨架健康（分层 / 同源纪律 / read-write 分级 / 确认卡 / 预算管理），但 4 个执行层缺陷
> 构成「偶发上游失败」的放大器。T173~~T176。

### 37.1 预算预估与截断（T173）

- **旧缺陷**：工具往返预算（`maxContext × 40%`）在工具结果**回喂之后**才检查——超限内容已不可
  撤回，收尾轮仍会硬发；且历史预算（75% 口径）与往返预算（40%）独立计算，理论可叠加到
  **115% maxContext**（admin 会话 #377 tokens_input 118,865/128,000 为逼近上限实证）。
- **新约束**：每次调上游（含收尾轮）**前**预估 `projectedInputChars`（消息 content +
  **reasoning_content**（旧口径漏算）+ tools schema），超过 `maxContext × 75%` 即截断——
  **只缩短 tool 消息 content**（从最旧开始换占位符，算法必然终止），**不动 assistant.tool_calls
  结构**（保证 tool 消息与 tool_calls 一一对应的协议不被破坏）；截断发生即强制进收尾轮（防再膨胀）。
  旧 40% 阈值降级为 debug 观测。结算基数按截断后实发内容修正。

### 37.2 上游重试与错误落库（T174）

- **重试**：`callUpstream` 拆为「重试外壳 + callUpstreamOnce」；瞬时错误（**429 / 5xx / 连接层**，
  由引擎层 `ProviderService.isRetryableUpstreamError` 按 openai SDK 异常分类）重试 2 次
  （1s / 2s，±30% 抖动）。**安全前提（硬约束）**：本轮尚无任何 delta 下发且未收到 tool_calls
  （否则客户端看到重复文本）；`signal.aborted` 不重试；400/401 等参数类不重试。
- **落库**：`ai_message` 新增 `error_msg varchar(500) null`（迁移
  `20261005061037_ai_message_error_msg`），status=2 时随结算写入 `[status=…]` 详情——
  此后任何上游失败免翻终端日志即可判定 429 vs 400（遗留 30 的「错误详情不落库」销项）。
- **明示不做**：失败轮扣费规则（如 out=0 全额失败按比例减免）属产品决策，**未修**，待拍板。

### 37.3 确认链上下文完整回喂（T175）

- **旧缺陷**：同批 tool_calls 中「read 在前、write 在后」时，write 触发确认卡即 break——
  ① 已执行的 read 结果被丢弃（确认总结缺上下文）；② write 之后的调用被**静默**暂停
  （模型不知情，总结时会误以为已完成）。
- **修法**：确认单（Redis）增 `priorToolCalls`（同批 read 的 id/name/arguments/result，
  单条 2 万 / 合计 5 万字符上限）+ `skippedToolCalls`（被暂停调用名）；`buildConfirmContext`
  重建时原 assistant 带**整批** tool_calls（同批 read 用上游 tool_call id、write 用消息 id），
  后跟同序 tool 消息，暂停调用以系统提示回喂；历史预算的 currentChars 口径同步改为
  「全部回喂 tool 结果合计」。

### 37.4 路由豁免收窄（T176）

- `EAGER_GROUPS = [app, siteLifecycle, system]` 恒豁免 → **`ALWAYS_GROUPS = [system, common]`
  恒下发 + `app`/`siteLifecycle` 创建意图触发**（`CREATE_INTENT_KEYWORDS` 词根命中或直接命中
  本组词根）。词根纪律：宁多勿漏（漏命中最坏 = 未豁免，不劣于「AI 需用户补一句」；
  多命中只是多下发，不高于旧基线）。`check:ai` 20/20，纯 CMS 查询 19/43、app 查询 23/43。
- **观察期**：上线后观察一周 `ai_usage_log.tokens_input` 分布再决定是否进一步收紧。

### 37.5 资产登记

`ProviderService.isRetryableUpstreamError`（引擎层错误分类）/ `projectedInputChars` /
`truncateToolResultsToFit`（chat.service 预算硬约束对）/ `PriorToolCallEntry`（确认单扩展）/
`ALWAYS_GROUPS` + `CREATE_INTENT_KEYWORDS`（tool.groups 豁免新口径）。
