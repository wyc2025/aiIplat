# iplat —— 技术架构约定（ARCHITECTURE.md）

> 本文档是 iplat 的技术宪法。代码生成与审查以本文档为准；与对话中的口头约定冲突时，以本文档为准。

---

## 1. 技术选型总表

### 1.1 前端（apps/web）

| 类别          | 选型                                      | 约束                                                                |
| ------------- | ----------------------------------------- | ------------------------------------------------------------------- |
| 框架          | Vue 3.5 + TypeScript                      | 全部 `<script setup>`，禁止 Options API                             |
| 构建          | Vite 7                                    | dev 代理 `/api` → `http://localhost:3000`                           |
| 组件库        | Element Plus 2.x                          | unplugin-vue-components 按需自动引入，禁止全量 import               |
| 图标          | @element-plus/icons-vue                   | 菜单图标选择器使用                                                  |
| 路由          | Vue Router 4                              | 静态路由 + 动态路由（后端菜单驱动）                                 |
| 状态          | Pinia                                     | 固定四个 store：user / permission / tabs / settings                 |
| HTTP          | Axios                                     | 业务代码只允许使用 `src/utils/request.ts` 的封装实例                |
| 样式          | Tailwind CSS 4 + SCSS + CSS 变量          | Tailwind 只做布局/间距/对齐工具类；组件风格、主题用 SCSS + CSS 变量 |
| 图表          | ECharts 5                                 | 按需引入                                                            |
| 工具库        | VueUse、dayjs、lodash-es                  | 时间格式化统一用 dayjs                                              |
| 规范          | ESLint 9 + Prettier + husky + lint-staged | 提交时自动校验                                                      |
| 环境          | Node ≥ 20，pnpm 9                         |                                                                     |
| Markdown 渲染 | markdown-it                               | 仅用于 AI 回复渲染；渲染输出必须防 XSS（不允许 raw HTML）           |

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
        └── usage/          #   用量明细（用户侧 + admin 侧查询）
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

| code  | 含义                                          |
| ----- | --------------------------------------------- |
| 0     | 成功                                          |
| 40001 | 参数校验失败                                  |
| 40100 | 未登录 / token 失效                           |
| 40300 | 无权限                                        |
| 40400 | 资源不存在                                    |
| 50000 | 服务器内部错误                                |
| 1xxxx | 业务错误（各域自定义，如 10001 用户名已存在） |

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

- `POST /api/system/file/upload`：multipart，Multer 接收，单文件上限 10MB
- 存储：`UPLOAD_DIR/yyyyMM/uuid.ext`，落库 `sys_file`
- 业务代码只允许通过 `infra/storage/StorageService` 读写文件，禁止直接操作 fs

---

## 5. 数据库设计（sys_ 前缀为 P1 底座；P2a 新增 7 张 ai_ 表）

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

---

## 9. 公共资产表（优先复用，禁止重复造；新增后必须回写登记）

| 名称                                                        | 位置                                      | 用途                                                          | 状态                              |
| ----------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------- | --------------------------------- |
| request                                                     | web/src/utils/request.ts                  | Axios 封装（双 token 静默刷新）                               | 已建（T7）                        |
| v-permission                                                | web/src/directives/permission.ts          | 按钮权限指令                                                  | 已建（T7）                        |
| useTable                                                    | web/src/hooks/useTable.ts                 | 列表页通用逻辑（分页/查询/加载态）                            | 已建（T9）                        |
| token                                                       | web/src/utils/token.ts                    | 双 token localStorage 读写                                    | 已建（T7）                        |
| tree                                                        | web/src/utils/tree.ts                     | 平铺列表组树（dept/menu 通用）                                | 已建（T7）                        |
| validate                                                    | web/src/utils/validate.ts                 | 密码/手机号/邮箱校验规则                                      | 已建（T7）                        |
| useUserStore 等四 store                                     | web/src/stores                            | user/permission/tabs/settings                                 | 已建（T7）                        |
| useDict                                                     | web/src/hooks/useDict.ts                  | 字典取值与渲染（带缓存）                                      | 已建（T9）                        |
| ProTable                                                    | web/src/components/ProTable               | 搜索+表格+分页+操作列                                         | 已建（T9）                        |
| FormDialog                                                  | web/src/components/FormDialog             | 新增/编辑表单弹窗                                             | 已建（T9）                        |
| IconSelect                                                  | web/src/components/IconSelect             | 图标选择器                                                    | 待建（T9）                        |
| Upload                                                      | web/src/components/Upload                 | 文件上传                                                      | 待建（T9）                        |
| JwtAuthGuard                                                | api/src/gateway/guards                    | 全局认证守卫                                                  | 已建（T2）                        |
| PermissionGuard                                             | api/src/gateway/guards                    | 全局权限守卫                                                  | 已建（T2）                        |
| TransformInterceptor                                        | api/src/gateway/interceptors              | 统一响应 + bigint 转字符串                                    | 已建（T2）                        |
| OperationLogInterceptor                                     | api/src/gateway/interceptors              | 操作日志异步落库（配 @OperationLog）                          | 已建（T6）                        |
| GlobalExceptionFilter                                       | api/src/gateway/filters                   | 全局异常兜底                                                  | 已建（T2）                        |
| @Public / @RequirePermission / @CurrentUser / @OperationLog | api/src/gateway/decorators                | 装饰器组                                                      | 已建（T2）                        |
| PageQueryDto / PageResultDto                                | api/src/common/dto                        | 分页基类                                                      | 已建（T2）                        |
| BusinessException                                           | api/src/common/exceptions                 | 业务异常（code + message）                                    | 已建（T2）                        |
| ErrorCode                                                   | api/src/common/constants/error-code.ts    | 统一错误码常量                                                | 已建（T2）                        |
| RedisKey                                                    | api/src/common/constants/redis-key.ts     | Redis Key 生成约定                                            | 已建（T2）                        |
| parseDurationToSeconds                                      | api/src/common/utils/duration.ts          | '2h'/'7d' 时长解析为秒                                        | 已建（T10，自 auth.service 抽出） |
| 配置模块组                                                  | api/src/config                            | database/redis/jwt/upload 配置 + validate.ts 启动环境变量校验 | 已建（T2）                        |
| PrismaService / RedisService                                | api/src/infra/prisma、api/src/infra/redis | 基础设施服务（全局模块，懒连接）                              | 已建（T2）                        |
| StorageService                                              | api/src/infra/storage                     | 文件存储抽象（预留 MinIO/OSS 切换）                           | 待建（T9）                        |
| ProviderService                                             | api/src/modules/ai/engine                 | OpenAI 兼容适配器（流式调用 + usage 解析）                    | 待建（T12）                       |
| CreditService                                               | api/src/modules/ai/credit                 | 积分预检/结算/余额                                            | 待建（T14）                       |
| @SkipTransform                                              | api/src/gateway/decorators                | SSE 接口跳过统一响应                                          | 待建（T14）                       |
| sse                                                         | web/src/views/ai/utils/sse.ts             | 前端 SSE 客户端                                               | 待建（T17）                       |
| MarkdownView                                                | web/src/views/ai/components               | markdown-it 渲染封装（禁 raw HTML）                           | 待建（T17）                       |

### Redis Key 增补约定（写入 RedisKey 常量）

| Key                    | 类型/TTL                                                 | 用途                                                                                         |
| ---------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `online:{userId}`      | hash，30min 滑动                                         | 在线用户（username/nickname/ip/loginAt/lastActiveAt），JwtAuthGuard 校验通过时刷新，登出删除 |
| `ai:chatting:{userId}` | string，TTL 300s（兜底防进程崩溃残留），流结束时主动删除 | 单用户并发流限制（存在即拒绝新流，20007）                                                    |

---

## 10. SSE 接口特例约定（P2a 新增）

1. SSE 是统一响应格式的**唯一例外**，仅限 `POST /api/ai/chat`：
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
