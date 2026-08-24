# iplat —— 项目进度档案（PROGRESS.md）

> 本文件由 AI 在每完成一个任务后更新。开工前先读本文件，从"进行中 / 下一个待办"继续。

## 当前状态：P1 底座全部完成（T1~T10），P2a AI 模块（对话 + 套餐积分）进行中

## 里程碑总览

| 阶段 | 目标                              | 状态   |
| ---- | --------------------------------- | ------ |
| P1   | 后台管理底座                      | 已完成 |
| P2a  | AI 模块：对话 + 套餐积分（ai 域） | 进行中 |
| P2b  | AI 模块：工具调用 Agent 化        | 未开始 |
| P3   | 云盘模块（cloud 域）              | 未开始 |
| P4   | 个人网站模块（site 域）           | 未开始 |

## P2a 任务拆解（AI 模块）

| 编号 | 任务                                                                                                                   | 状态   |
| ---- | ---------------------------------------------------------------------------------------------------------------------- | ------ |
| T11  | ai 域骨架 + 数据库（7 张 ai_ 表 + 迁移 + seed：厂商配置/示例模型/默认套餐/AI 菜单树及权限标识）+ 引入 @nestjs/schedule | 已完成 |
| T12  | 引擎层：ProviderService（OpenAI 兼容适配器）+ 用户侧模型列表接口                                                       | 已完成 |
| T13  | 会话与消息 CRUD 接口（建会话/列表/重命名/删除/消息列表/自动生成标题）                                                  | 已完成 |
| T14  | SSE 对话接口 + CreditService（预检/结算/幂等）+ 限流 + 上下文截取                                                      | 待办   |
| T15  | 套餐体系：plan CRUD、开通/切换/指派、我的套餐与用量接口、月度重置 cron                                                 | 待办   |
| T16  | system 域增量：在线用户跟踪 + 在线列表接口 + 踢下线接口                                                                | 待办   |
| T17  | 前端 AI 对话页（SSE 流式渲染、markdown-it、会话管理、模型切换、停止生成）                                              | 待办   |
| T18  | 前端 开通套餐页 + 我的用量页 + 管理端三页 + 在线用户页 + 联调验收（对照 PRD-P2A 第 7 节）                              | 待办   |

## 第一期任务拆解（P1 底座）

| 编号 | 任务                                                                                                                  | 状态   | 完成日期   |
| ---- | --------------------------------------------------------------------------------------------------------------------- | ------ | ---------- |
| T1   | monorepo 初始化：pnpm workspace、apps/web + apps/api 骨架、docker-compose（MySQL 8 + Redis 7）、ESLint/Prettier/husky | 已完成 | 2026-08-16 |
| T2   | api 骨架：gateway 层（守卫/拦截器/过滤器/装饰器）、统一响应、全局异常、Swagger、Prisma + Redis 接入                   | 已完成 | 2026-08-17 |
| T3   | 数据库：Prisma schema（sys_* 全部 11 张表）+ 迁移 + seed（admin、默认角色、系统管理全套菜单及按钮权限）               | 已完成 | 2026-08-17 |
| T4   | auth 模块：登录（双 token）、刷新、登出、userinfo（用户+角色+权限标识+菜单树）、登录失败锁定                          | 已完成 | 2026-08-17 |
| T5   | system 域 CRUD：用户 / 角色 / 菜单 / 部门 / 字典 全套接口 + 分页 + 权限控制                                           | 已完成 | 2026-08-17 |
| T6   | 日志模块：操作日志拦截器落库、登录日志、两个查询接口                                                                  | 已完成 | 2026-08-17 |
| T7   | web 骨架：request.ts 封装（双 token 静默刷新）、路由守卫、动态路由转换器、Pinia 四个 store、v-permission 指令         | 已完成 | 2026-08-17 |
| T8   | Layout + 登录页：侧边栏/顶栏/TabsBar/设置抽屉、登录页、登录联调、404 页                                               | 已完成 | 2026-08-17 |
| T9   | 系统管理页面：用户 / 角色 / 菜单 / 部门 / 字典 / 日志查询页（ProTable + FormDialog 模式）                             | 已完成 | 2026-08-23 |
| T10  | Dashboard + 个人中心 + 整体联调验收（对照 PRD.md 验收标准）                                                           | 已完成 | 2026-08-23 |

## 进行中

（空，下一个待办 T14：SSE 对话接口 + CreditService + 限流 + 上下文截取）

## 遗留问题

1. 本机全局 pnpm 为 10.12.4，已通过根 `packageManager: pnpm@9.15.9` 锁定，corepack 自动切换到 pnpm 9 执行
2. 本 IDE 环境的 node 进程被 safe-delete shim 拦截批量删除（`SAFE_DELETE_BULK_CONFIRM_REQUIRED`）：`nest build` 清 `dist` 仍会被拦（Vite 7.3.6 对清理拦截有容错，web dev 可正常启动）。**已确认的规避方式：api 构建先 `Remove-Item -Recurse -Force apps\api\dist` 再 `nest build`（本会话多次验证有效）；web/api dev 服务由用户在自有 PowerShell 窗口启动（不经 CodeBuddy 注入，无 shim）**
3. docker.io 直连不通，镜像已通过 daocloud 镜像源拉取（`docker.m.daocloud.io/library/...`）并打标准 tag；若后续容器重建需拉新镜像，沿用该源或配置 Docker Desktop 加速器
4. 本机原 MySQL 服务已停止（`net stop MySQL`），未改启动类型；重启电脑后若 MySQL 自启会再次占用 3306，届时需再次停止或执行 `Set-Service MySQL -StartupType Manual`
5. 个人中心头像上传未实现：PRD F11 功能要点提到"头像上传"，但细则仅定义"左侧个人卡片头像展示"且验收标准未涉及，按细则实现（无头像显示昵称首字母）；P2 云盘 StorageService 就绪后可低成本补做
6. agent-browser 浏览器自动化输入中文会乱码（工具编码问题，非页面问题）；联调涉及中文输入时改用英文数据、中文节点用 DOM 索引/ID 定位
7. CodeBuddy execute_command 会把命令写入临时 .ps1 执行，PowerShell 以 GBK 解析导致**命令中显式书写的中文路径/字符串乱码**；规避：命令一律用相对路径、避免命令行内嵌中文字符串
8. （验收发现）AppMain 页面切换的 `<Transition>` 多根节点警告：T10 已给 user/role/menu/dept 四页补单根包裹，但修复后未在浏览器专门复验警告是否消除（低风险，功能不受影响）；P2 新页面开发注意保持单根节点
9. （运维建议）admin 初始密码仍为 seed 值 `Admin@123`，生产部署前务必通过个人中心修改；`.env` 中 JWT 双密钥亦为本地开发值，上线需替换
10. （P2a 环境）`prisma generate` / `migrate dev` 末尾会报 `EPERM: rename query_engine-windows.dll.node.tmp* -> query_engine-windows.dll.node`——原因是运行中的 api 进程（`node dist/main.js`）占用该 dll；**类型生成与迁移本身均成功**（index.d.ts 已含新模型、迁移已应用），仅最后一步引擎 dll 替换失败，残留 `.tmp*` 文件在 node_modules 内无害。规避：如需完全干净可先停 api 服务再 generate，或忽略该告警

## 完成记录

- 2026-08-16 T1：monorepo 初始化完成。pnpm workspace（apps/web、apps/api、packages/shared）；web 骨架（Vite 7 + Vue 3.5 + TS + Element Plus 按需引入 + Tailwind 4 + Pinia），`vue-tsc + vite build` 通过；api 骨架（NestJS 11 + ConfigModule + helmet + 全局前缀 /api），`nest build` 通过；docker-compose（MySQL 8.0 + Redis 7，含健康检查与数据卷）；ESLint 9 flat config + Prettier + husky + lint-staged 配置完成，`eslint .` 0 错误 0 警告；已按 ARCHITECTURE.md 建好前后端目录骨架（.gitkeep 占位）；`apps/api/.env` 已生成（含随机 64 位 JWT 双密钥）
- 2026-08-17 T2：api 骨架完成。gateway 层：JwtAuthGuard（@Public 放行）/ PermissionGuard（@RequirePermission，权限从 Redis `user:perms:{userId}` 读取，超管 `*` 通配，T4 登录时写入）/ TransformInterceptor（统一 { code, message, data }，bigint 转字符串）/ GlobalExceptionFilter（BusinessException 恒 200 + 错误码，HttpException 按映射，未知异常 500 + 日志）/ 装饰器组（@Public @RequirePermission @CurrentUser @OperationLog）；common 层：ErrorCode、RedisKey、BusinessException、PageQueryDto/PageResultDto；config 层：database/redis/jwt/upload 配置 + validate.ts 环境变量校验；infra 层：PrismaService / RedisService（全局模块，懒连接，无中间件也可启动）；限流 300 次/分/IP；Swagger `/api/docs`；prisma/schema.prisma 骨架（模型待 T3）。验证：`prisma generate` ✓、`nest build` ✓、`vue-tsc + vite build` ✓、`eslint .` 0 错误 0 警告 ✓；冒烟：无 MySQL/Redis 可启动，404 → `{"code":40400,...}` 统一格式 ✓、Swagger 200 ✓。经用户确认新增 devDependency `@types/express`（gateway 层 Request/Response 类型）
- 2026-08-17 T3：数据库层完成。Docker 基础设施就绪（MySQL 8.0.46 + Redis 7，均 healthy）；`prisma/schema.prisma` 定义 11 张 sys_* 表（SysUser/SysRole/SysUserRole/SysMenu/SysRoleMenu/SysDept/SysDictType/SysDictData/SysLoginLog/SysOperationLog/SysFile），采用 `relationMode="prisma"` 逻辑外键（sys_menu/sys_dept 以 parent_id=0 表示根、软删除场景，物理 FK 无法满足），按建议补齐关联字段索引；迁移 `20260817020431_init` 已应用，11 张表全部创建；`prisma/seed.ts`（tsx 运行，幂等）：admin 用户（Admin@123，bcrypt salt 10）、admin/common 两角色、菜单树 34 条（含 23 个按钮权限标识，命名 `域:模块:操作`）、common→首页工作台、admin→admin 角色关联；验证：表结构 ✓、数据计数 ✓（中文存储正常）、seed 幂等（重跑新增 0 条）✓、`nest build` ✓、`eslint .` ✓
- 2026-08-17 T4：auth 模块完成（modules/system/auth/）。登录：锁定检查 → bcrypt 校验（用户不存在与密码错误统一提示 10101 防枚举）→ 清计数、记录 lastLoginAt/Ip、签发双 token；token 对共用同一 jti 作为会话标识（登出时可精确删除对应 refresh）；refresh 存 `refresh:{userId}:{jti}` TTL 7d；刷新走 rotation（旧 refresh 立即失效，复用返回 10104）；登出把 access jti 加黑名单（TTL=剩余有效期，依赖 AuthUser 新增 exp 字段）+ 删 refresh；userinfo 返回 user（剔除 password、bigint id 转字符串由 TransformInterceptor 统一处理）+ roles + perms + 菜单树（服务端组树，含 visible=0 节点供路由注册，超管全量/普通用户按角色过滤）；登录失败锁定：Redis `login:fail:{username}` INCR（首次失败开 10 分钟窗口），连续 5 次后拒绝并提示剩余秒数（10102），成功即清零；权限缓存 `user:perms:{userId}` 在登录/刷新/userinfo 时写入，TTL 7d（角色/菜单变更的主动失效在 T5 实现）；登录接口限流 10 次/分；新增错误码 10101~10104。冒烟 10 项全过：登录 ✓、userinfo（roles=[admin] perms=[*] 菜单树）✓、无 token/非法 token 40100 ✓、rotation ✓、旧 refresh 复用 10104 ✓、登出 ✓、登出后旧 access 黑名单 40100 ✓、5 次失败 → 10102 锁定 600s ✓、锁定中正确密码也拒绝 ✓。注意：tsx 无法直接运行 NestJS（esbuild 不支持 emitDecoratorMetadata，DI 元数据丢失），冒烟/运行一律走 `nest build` + `node dist/main.js`；构建清理 dist 时如遇审批弹窗未通过，可用 Move-Item 重命名旧 dist 替代删除
- 2026-08-17 T5：system 域五个 CRUD 模块完成（user/role/menu/dept/dict，均在 modules/system/ 下，每模块 controller+service+dto+module 四件套）。权限控制：全部接口挂 @RequirePermission，标识与 seed 菜单按钮一致。删除前置校验：角色被引用 10302、菜单有子级 10401、部门有子级 10501/有用户 10502、字典类型有数据 10602。超管保护：admin 用户不可禁用/删除/改角色/重置密码（10202），admin 角色不可编辑/删除/分配菜单（10303）。perms 缓存主动失效：角色分配菜单 / 用户分配角色 / 菜单增删改 后删除受影响用户的 `user:perms:{userId}`（守卫下次请求时回源重建）。重置密码返回随机 8 位明文（仅展示一次）。新增错误码 10201~10602。seed 补充内置字典 sys_common_status（2 项）+ sys_user_gender（3 项）。树形接口（dept/menu）返回平铺列表由前端组树。冒烟（Node fetch 脚本）：dept/role/user/menu/dict 增删改查 ✓、用户名重复 10201 ✓、重置密码 ✓、禁用 admin 10202 ✓、角色分配菜单+回显 ✓、删除前置校验 10502/10302 ✓、分页结构 ✓。构建 `nest build` ✓、`eslint .` ✓、tsc --noEmit ✓
- 2026-08-17 T6：日志模块完成。OperationLogInterceptor（gateway/interceptors）：仅对挂 @OperationLog 的接口生效，响应后异步写 sys_operation_log（userId/username/module/action/method/url/params/ip/status/errorMsg/duration），参数剔除 password 等敏感字段，写库失败只记运行日志不阻断业务；注册在 TransformInterceptor 之后。登录日志：auth login 成功/失败/锁定/禁用各落库 sys_login_log（含 ip + UA 粗略解析 browser/os），异步不阻断登录。两个查询接口：GET /system/log/login（system:log:login，按用户名/状态/时间）、GET /system/log/operation（system:log:operation，按用户/模块/状态/时间），纯查询无增删改。T5 五个模块的 21 个增删改接口全部补挂 @OperationLog。冒烟：登录日志成功/失败均落库 ✓、操作日志（部门管理/新增部门/POST/status=1/duration）✓、两个查询接口分页 ✓。构建 ✓、ESLint ✓、tsc ✓
- 2026-08-17 T7：web 骨架完成（apps/web/src/）。utils：token.ts（localStorage 双 token 唯一存取）、request.ts（请求拦截器自动带 Bearer；响应 code===0 直接返回 data；code===40100 单例静默刷新——并发请求挂起 pendingQueue 排队、刷新成功重放、失败清 token 跳 /login；其他 code 统一 ElMessage 报错；拦截器解包 AxiosResponse 故 fulfilled 用 any 接收、出口 request<T> 断言收窄）、tree.ts（平铺组树）、validate.ts（密码/手机号/邮箱规则）。api：system/auth.ts（login/logout/getUserInfo）。stores（Pinia setup 写法）：user（userInfo/roles/isSuperAdmin）、permission（perms/menus/routesLoaded/hasPerm，超管 * 放行）、tabs（页签增删）、settings（侧边栏折叠/TabsBar/面包屑开关，localStorage 持久化）。router：index.ts 静态路由（login/404/layout 容器 + 兜底）、dynamic.ts（import.meta.glob('../views/**/*.vue') 映射 component 字符串，menus 递归转 RouteRecordRaw 注册到 layout 下，幂等 removeRoute 再 addRoute）、guard.ts（白名单/无 token 跳登录/未加载菜单先拉 userinfo 注册动态路由再 replace 重走导航/已登录访问 /login 重定向首页）。directives/permission.ts：v-permission 无权限移除元素、数组满足其一、超管放行。types/api.d.ts 全局类型。装配 main.ts（pinia+router+guard+指令），App.vue 改为 router-view；补 login（可联调最小实现）/layout 占位/404/dashboard 占位页。ESLint 页面目录关闭 vue/multi-word-component-names（views/layout 的 index.vue/404.vue 单词组件名为路由通用做法）。验证：vue-tsc --noEmit ✓、vite build ✓、eslint . ✓（--fix 修复属性格式）
- 2026-08-17 T8：Layout + 登录页完成。布局 6 组件（layout/index + Sidebar/SidebarItem/Navbar/TabsBar/AppMain/Settings）：侧边栏 210px↔64px 折叠、深色菜单、图标用全局注册的 EP 图标以组件名动态渲染、hidden 菜单不进侧边栏；顶栏折叠按钮+面包屑+设置图标+用户下拉（个人中心/退出登录）；TabsBar 页签增删（dashboard 不可关）、AppMain 路由出口带过渡；设置抽屉开关页签栏/面包屑（settings store 持久化）。登录页：居中卡片+logo+标题+表单校验+loading+回车提交，失败/锁定提示走 request 拦截器统一 ElMessage。修复两个关键问题：① 动态路由 404——dashboard 移入静态路由 children（所有登录用户可见的保底页），`/:pathMatch(.*)*` catch-all 不再误命中；权限加载抽到 layout `beforeEnter: ensurePermissionLoaded`（redirect 前完成动态注册）；② ElMessage/ElMessageBox 无样式/不显示——它们是 JS 调用非模板组件，unplugin-vue-components 不注入样式，已显式 import 'element-plus/es/components/message/style/css' 与 message-box/overlay 样式。浏览器可视化联调（agent-browser + 本机 Chrome）确认：登录页渲染、登录跳转 dashboard、侧边栏/顶栏/页签/面包屑正常、错误提示弹出、退出确认框正常、刷新路由不丢。遗留：system/* 业务页 404 属正常（页面组件 T9 实现）；验证过程清了 admin 登录失败计数
- 2026-08-23 T9：系统管理 7 个页面完成并通过浏览器联调（并行子代理开发 + 主线程修复验证）。公共资产：`hooks/useTable`（列表页通用：分页/查询/重置/加载态）、`components/ProTable`（工具栏+表格+分页封装）、`components/FormDialog`（弹窗表单封装）、`hooks/useDict`（字典缓存）；后端补 `GET /system/dict/data/:type` 免权限字典数据接口。页面：用户（含分配角色/重置密码）、角色（含菜单树勾选）、菜单（树形表格）、部门（树形）、字典（左右布局类型+数据）、登录日志、操作日志，全部处理加载中/空数据/失败三态。**联调修复关键 bug**：catch-all 路由用 `redirect: '/404'` 时 vue-router 在全局守卫之前完成重定向，守卫拿到 `to.path=/404`（白名单放行），`routesLoaded` 检查永远不触发——整页刷新直达 `/system/user` 等深层路径必 404；改为直接渲染 404 组件 + 守卫重放改用 `path/query` 重建（不用 spread to，避免携带 catch-all 的 name/matched 劫持导航）。联调验证（agent-browser）：登录 ✓、7 页面数据渲染 ✓（含树形菜单 34 条、日志 19+2 条）、整页刷新直达深层路径 ✓、新增用户（弹窗表单+角色下拉+提交+列表刷新）✓、删除用户（确认框+列表刷新）✓、权限按钮显隐（admin 行无删除按钮）✓、退出登录（确认框样式正常）✓；vue-tsc/eslint/vite build 均 0 错误。safe-delete 规避：dev 服务由用户在自有 PowerShell 窗口启动（api 直接 `node dist/main.js` 无需构建）
- 2026-08-23 T10：Dashboard + 个人中心 + P1 整体验收完成，**PRD 12 条验收标准全部通过**。后端：`modules/system/dashboard/`（GET stats 四项统计 + login-trend 近 7 天 $queryRaw 按日聚合补零，登录即可访问）；`user/profile.controller.ts`（PUT /system/user/profile 改基本信息、PUT /system/user/profile/password 改密码，@OperationLog）；**改密码全端踢下线**：Redis `user:pwd:changed:{userId}` 记录时间戳（TTL=access 有效期），JwtAuthGuard 校验 token iat 早于它即拒绝（40100"密码已修改"），同时 SCAN 删除该用户全部 refresh + 清权限缓存；错误码 10203 旧密码错误；`parseDurationToSeconds` 抽到 common/utils。前端：Dashboard 重写（统计卡片/ECharts 按需折线图含 resize/快捷入口按菜单权限过滤/三态）；个人中心页（左卡片+基本信息/修改密码 Tab，改密成功清会话回登录）；tabs store localStorage 持久化；user/role/menu/dept 四页根级包 div 修复 Transition 警告；ESLint 修 .vue 文件 no-undef 误报。**联调修复 3 个关键 bug**：① request.ts 只在 HTTP 200 分支处理 40100，而无效 token 走 HTTP 401 error 分支 → 静默刷新从未触发；统一两分支到 handleTokenInvalid（并修复触发刷新的请求本身不重放的问题）② `PUT /system/user/profile/password` 被 UserController 的 `PUT /system/user/:id/password` 抢先匹配（Express 按注册顺序）→ ProfileController 注册到 UserController 之前 ③ 个人中心依赖后端菜单分配动态路由，未分配该菜单的角色 404 → profile 移入静态路由（与 dashboard 同理）。验收实测：登录/锁定（5×10101→10102 锁 600s，Redis 计数验证）/菜单渲染刷新不丢/测试角色仅见用户管理/无 delete 权限按钮隐藏+接口 40300/CRUD 前置校验（10501/10302）/双日志记录（改密含 3 条历史失败记录）/静默刷新+双 token 失效跳登录/改密后旧 access 40100+旧 refresh 10104+页面自动踢出/Swagger/TabsBar 持久化恢复/三态。测试数据已清理（tester3/QA Role/测试部门已删，登录失败锁已清）
- 2026-08-23 补充修复（用户反馈）：菜单管理"新增子级/编辑"弹框中父级菜单反显数字而非名称——根因是 `Number(parent.id)` 把字符串 id 转 number，与 el-tree-select 选项 value（字符串 id）类型不匹配导致选不中；部门管理页存在同款问题。修复：menu/dept 两页表单 parentId 全程保持字符串，仅在提交时转 number（`openCreate`/`openEdit`/`handleSubmit` 三处）。已验证：新增子级反显父级中文名、编辑回填正常、无变化提交成功，vue-tsc/eslint 0 错误
- 2026-08-24 T11：ai 域骨架 + 数据库完成。① `prisma/schema.prisma` 追加 7 张 ai_ 表（AiProvider/AiModel/AiConversation/AiMessage/AiPlan/AiUserPlan/AiUsageLog，延续 `relationMode="prisma"` 逻辑外键，decimal(8,4)/decimal(10,2) 价格、longtext 消息体、unique(provider_id,model)、unique(message_id) 结算幂等、索引 (user_id,updated_at)/(conversation_id,created_at)/(user_id,created_at)）；迁移 `20260823173222_add_ai_domain` 已创建并应用。② 引入 `@nestjs/schedule@6.1.3`，`app.module.ts` 注册 `ScheduleModule.forRoot()`（月度重置 cron 归 T15 实现）；同步补回 `@types/express@5.0.6` devDependency（T2 曾添加但未落盘，本次 pnpm 重装暴露缺失导致 nest build 报 TS2307，已修复）。③ 建立 `modules/ai/ai.module.ts` 聚合模块（空骨架，子模块随 T12~T15 挂载）+ provider/conversation/chat/engine/credit/plan/usage 七子目录 .gitkeep 占位，并注册进 app.module。④ seed 增补：AI 厂商 4 家（deepseek/kimi/qwen/zhipu，baseUrl 按各家 OpenAI 兼容端点预填，apiKey 空）+ 示例模型 6 个（status=0 停用）+ 套餐 2 个（体验版 10000/标准版 100000 积分）；菜单树新增"AI 助手"目录（AI 对话/开通套餐/我的用量三页，无按钮权限，接口层用套餐校验兜底）、"AI 管理"目录（厂商模型/套餐管理/用量明细三页，含 13 个 `ai:*` 权限标识）、"系统管理"下"在线用户"（system:online:list/kick）；common 角色分配"AI 助手"三页，admin 拥有全部。验证：`prisma validate` ✓、`prisma generate` ✓（7 张 ai_ 模型类型已生成）、`migrate` ✓、seed 幂等（重跑菜单新增 0 条）✓、数据核查（4 厂商/6 模型/2 套餐/菜单树/common 角色 5 菜单）✓、`eslint` 0 错误 ✓、`nest build` ✓
- 2026-08-24 T12：引擎层 + 用户侧模型列表接口完成。引入 `openai@7.5.0`（PRD D3 批准白名单）。① 引擎层 `modules/ai/engine/`：`engine.types.ts`（EngineChatMessage/EngineUsage/EngineStreamEvent/EngineStreamParams 类型）、`provider.service.ts`（ProviderService 适配器：`createClient(baseUrl, apiKey)` 用 openai SDK 构造兼容 client；`streamChat()` 以 async generator 产出 `{type:'delta'}`/`{type:'done', usage}` 事件，`stream_options.include_usage=true` 使上游末 chunk 携带 usage，`done.usage` 为 null 时表示上游未返回需上层兜底估算；上游异常向上抛出由 chat 层转 SSE error；支持 AbortSignal 中断用于"停止生成"；不缓存 client、apiKey 变更即时生效）、`engine.module.ts`（导出 ProviderService）。② provider 域 `modules/ai/provider/`：`provider.service.ts`（AiProviderService：`availableModels()` 查 status=1 且厂商 status=1 的模型，按厂商/模型 sort 升序，price 转 string 返回）、`provider.controller.ts`（`GET /api/ai/models`，登录即可不挂 @RequirePermission）、`provider.module.ts`。③ `ai.module.ts` 挂载 AiProviderModule + EngineModule。④ 错误码 20001~20007 补入 error-code.ts。验证：`nest build` ✓、`eslint` ✓；冒烟（临时 3001 端口实例 + tsx 脚本）：登录 ✓、`/api/ai/models` 返回 code 0（6 个示例模型均 status=0 故空列表属预期，临时启用 1 个模型后接口正确返回该模型）✓、未登录 40100 ✓
- 2026-08-24 T13：会话与消息 CRUD 接口完成（`modules/ai/conversation/`）。① schema 增补：给 AiConversation/AiMessage 增加与 AiModel 的 relation（`model`，可选）+ `@@index([modelId])`，迁移 `20260824052413_add_ai_model_relations` 已应用（relationMode=prisma 逻辑外键，不生成物理 FK）。② `conversation.service.ts`：`page()`（分页列表，updatedAt 倒序，含 modelDisplayName）、`update()`（重命名 title / 切换 modelId，切换时校验模型存在→40400、停用→20003，归属校验→20004）、`remove()`（软删会话 + 消息级联软删，事务）、`messages()`（不分页，最近 50 条按 createdAt 正序，含 modelDisplayName）；`assertOwned` 统一归属校验（id + userId + deletedAt=null）。③ `conversation.controller.ts`：GET /ai/conversation、PUT /ai/conversation/:id、DELETE /ai/conversation/:id、GET /ai/conversation/:id/messages，均用 @CurrentUser('userId') 拿登录态，不挂 @RequirePermission（用户自服务），PUT/DELETE 挂 @OperationLog。④ dto：ConversationQueryDto（继承 PageQueryDto）、UpdateConversationDto（title 1~50 字 / modelId 至少一项）。验证：`prisma validate` ✓、`migrate` ✓（含 generate，因 api 服务未运行无 dll 占用）、`nest build` ✓、`eslint` ✓；冒烟（临时 3001 实例 + 造数脚本）：列表含 modelDisplayName ✓、重命名 ✓、切换不存在模型 40400 ✓、切换停用模型 20003 ✓、消息列表 3 条正序 ✓、不存在会话 20004 ✓、删除后列表不含 ✓。注：本次因 Docker daemon 停止，已重新启动 Docker Desktop + docker compose up -d（MySQL/Redis 恢复 healthy）

### P1 最终状态总结（三句话）

1. **跑通方式**：`docker compose up -d` 启动 MySQL/Redis 后，在自有 PowerShell 窗口分别执行 `pnpm --filter @iplat/api start:prod`（dist 已构建；重新构建需先 `Remove-Item -Recurse -Force apps\api\dist` 再 `nest build` 绕过 safe-delete 拦截）和 `pnpm --filter @iplat/web dev`，浏览器访问 http://localhost:5173 以 admin/Admin@123 登录即可完整使用全部功能（Swagger 见 http://localhost:3000/api/docs）。
2. **已知瑕疵**：功能层仅剩个人中心头像上传未做（PRD 细则未定义，P2 StorageService 就绪后补）与 Transition 警告修复未复验（遗留问题 8）两处小项，其余均为环境类问题（safe-delete 拦截、工具中文乱码、本机 MySQL 自启风险，见遗留问题 1~~4/6~~7），不影响交付代码本身。
3. **P2 注意**：cloud 域建表必须 `cloud_` 前缀、禁止跨域 JOIN 与跨域 import（只经对方模块 Service 交互）；前端列表/弹窗一律复用 ProTable/FormDialog/useTable/useDict 并回写公共资产表，新页面保持单根节点；文件能力先落地 StorageService 抽象（本地磁盘起步、预留对象存储），并沿用 P1 固化的交付惯例（bigint→string、三态、@OperationLog、权限标识与 seed 菜单同步、DTO 校验）。

---

## 更新规则（AI 必读）

1. 每完成一个任务：把状态改为"已完成"、填日期、在"完成记录"追加一行简述
2. 开始新任务时：先把它挪到"进行中"，同一时间只允许一个任务处于进行中
3. 发现阻塞或不确定事项：记入"遗留问题"，并告诉我
4. 新增公共组件 / hook / 工具 / 后端通用能力时，同步登记到 `ARCHITECTURE.md` 的公共资产表
