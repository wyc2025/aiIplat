# iplat

可扩展的个人平台 —— 以后台管理为底座，逐步生长出 AI 助手、云盘、个人网站等能力。

采用 **pnpm monorepo + 模块化单体** 架构：前端 Vue 3，后端 NestJS，按业务域（system / ai / cloud / site）聚合代码，预留未来拆分为微服务的边界纪律。

## 功能与进度

| 阶段 | 内容                                                                                                   | 状态      |
| ---- | ------------------------------------------------------------------------------------------------------ | --------- |
| P1   | 后台管理底座：登录认证（双 token）、RBAC 权限、用户/角色/菜单/部门/字典管理、操作与登录日志、个人中心  | ✅ 已完成 |
| P2a  | AI 对话：多厂商切换（DeepSeek / Kimi / 通义千问 / 智谱GLM）、SSE 流式输出、套餐与积分计费、用量明细    | ✅ 已完成 |
| P2b  | AI 工具调用：Function Calling、自然语言操作系统（查在线用户/踢人/改资料等）、平台知识问答              | ✅ 已完成 |
| P3   | 云盘：文件树 / 上传下载预览 / 回收站 / 分享链接 / 配额管理                                             | ✅ 已完成 |
| P4a  | 个人网站：开放站点（静态托管 + 文章/评论/栏目）+ 开放数据 API                                          | ✅ 已完成 |
| P4b  | 个人网站：AI 编写站点（工具三件套）+ 在线编辑器 + 模板库                                               | ✅ 已完成 |
| P4c  | 云盘增强：公开链接（/view 免登录落地页）+ 批量拖拽上传 + 在线解压                                      | ✅ 已完成 |
| P4d  | 云盘增强二期：移动（剪切/拖拽）+ 多选批量 + 打包下载 + 分享升级（提取码/文件夹分享）+ 公开语义分流     | ✅ 已完成 |
| P4e  | 多站点：站点数配额（默认 1，admin 可调）+ 站点列表/删站 + AI 多站语义（含 create_site）+ 日志 sid 脱敏 | ✅ 已完成 |

## 技术栈

**前端 `apps/web`**

| 技术                 | 说明                                                  |
| -------------------- | ----------------------------------------------------- |
| Vue 3.5 + TypeScript | `<script setup>` 组合式 API                           |
| Vite 7               | 构建工具                                              |
| Element Plus         | 组件库（unplugin 自动按需引入）                       |
| Tailwind CSS 4       | 仅承担布局类工具样式                                  |
| Pinia                | user / permission / tabs / settings / site 五个 store |
| Vue Router 4         | 动态路由（菜单驱动，`import.meta.glob` 映射）         |
| Axios                | 双 token 静默刷新、单飞行重试                         |
| markdown-it          | AI 消息渲染                                           |
| CodeMirror 6         | 云盘文本文件在线编辑（按语言分包加载）                |

**后端 `apps/api`**

| 技术         | 说明                                           |
| ------------ | ---------------------------------------------- |
| NestJS 11    | 模块化框架                                     |
| Prisma 6     | ORM（`relationMode="prisma"` 逻辑外键）        |
| MySQL 8      | 主数据库                                       |
| Redis 7      | 权限缓存、token 黑名单、限流、AI 并发锁/确认单 |
| JWT 双 token | access 2h + refresh 7d，旋转刷新               |
| openai SDK   | 经 baseURL 适配 4 家 OpenAI 兼容厂商           |
| yauzl        | 云盘在线解压（流式，Zip Slip 防护）            |
| iconv-lite   | zip 条目名 GBK 解码                            |
| Swagger      | 接口文档 `/api/docs`                           |

## 架构要点

- **模块化单体**：`modules/` 下按域聚合（system / ai / cloud / site），表名带域前缀（`sys_` / `ai_` / `cloud_` / `site_`），禁止跨域 JOIN 与跨域 import，域间只经门面 Service 交互 —— 未来可按域平滑拆为微服务
- **进程内 gateway 层**：守卫 / 拦截器 / 过滤器 / 装饰器统一收口（`@Public` `@RequirePermission` `@CurrentUser` `@OperationLog`），横切逻辑不散落在业务里
- **统一响应**：`{ code, message, data }`，全局异常映射业务错误码
- **RBAC**：用户-角色-菜单五表模型，按钮级权限标识（如 `system:user:create`），超管 `*` 通配，Redis 缓存权限
- **AI 无特权**：AI 工具调用全程携带用户身份过 RBAC，按权限过滤下发工具、执行时二次校验；写操作一律弹确认卡片，用户确认后才执行
- **AI 积分计费**：套餐月度积分制，按 token 折算积分，先预检后结算，message_id 幂等防重复扣减

## 目录结构

```
iplat/
├── apps/
│   ├── web/            # Vue 3 前端
│   └── api/            # NestJS 后端
│       └── src/
│           ├── gateway/    # 守卫/拦截器/过滤器/装饰器
│           └── modules/
│               ├── system/ # 用户/角色/菜单/部门/字典/日志
│               ├── ai/     # 对话/套餐/积分/工具调用
│               ├── cloud/  # 文件树/传输/回收站/分享/公开访问/解压
│               └── site/   # 开放站点/栏目/文章/评论/模板库
├── packages/
│   └── shared/         # 前后端共享类型与常量
├── docs/               # 全部设计与进度文档（见下文）
├── docker-compose.yml  # MySQL 8 + Redis 7
└── AGENTS.md           # AI 协作开发宪法
```

## 快速开始

**环境要求**：Node.js ≥ 20、pnpm 9、Docker Desktop（提供 MySQL / Redis）

```bash
# 1. 安装依赖
pnpm install

# 2. 启动基础设施（MySQL 8 + Redis 7）
pnpm infra:up          # 等价于 docker compose up -d

# 3. 初始化数据库（迁移 + 种子数据）
pnpm db:migrate
pnpm db:seed

# 4. 启动开发服务（两个终端）
pnpm dev:api           # 后端 http://localhost:3000
pnpm dev:web           # 前端 http://localhost:5173
```

- 默认账号：`admin / Admin@123`（⚠️ 生产部署前务必修改）
- 接口文档：http://localhost:3000/api/docs

环境变量在 `apps/api/.env` 配置（`DATABASE_URL`、`REDIS_URL`、`JWT_ACCESS_SECRET`、`JWT_REFRESH_SECRET` 等，参考 `.env.example`；`.env` 已加入 .gitignore，**切勿提交**）。

**日志脱敏（P4E D56）**：应用层已对日志中的 URL 统一打码 `sid` / `password` 等敏感查询参数（`common/utils/url-mask.util.ts`，落点：全局异常日志与操作日志）。反向代理层同样需打码：`deploy/nginx.conf` 使用不含查询串的自定义 `log_format`（备选方案见文件头注释），**若自建 Nginx 请沿用同一口径**，避免 `?sid=` 分享凭证明文落 access_log。

## 文档索引

本项目采用**文档驱动开发**：先定契约与边界，再动手编码。

| 文档                                                                                                                      | 内容                                                |
| ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| [AGENTS.md](./AGENTS.md)                                                                                                  | AI 协作开发宪法（9 条铁律，AI 工具自动加载）        |
| [docs/PRD.md](./docs/PRD.md)                                                                                              | P1 产品需求（页面、业务规则、验收标准）             |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)                                                                            | 技术宪法（目录、规范、表结构、权限链）              |
| [docs/API.md](./docs/API.md)                                                                                              | 接口契约唯一权威来源（含错误码表）                  |
| [docs/PRD-P2A-AI.md](./docs/PRD-P2A-AI.md) / [ARCHITECTURE-P2A-增补](./docs/ARCHITECTURE-P2A-增补.md)                     | P2a AI 对话与积分                                   |
| [docs/PRD-P2B-AI.md](./docs/PRD-P2B-AI.md) / [ARCHITECTURE-P2B-增补](./docs/ARCHITECTURE-P2B-增补.md)                     | P2b AI 工具调用与平台知识                           |
| [docs/PRD-P3-CLOUD.md](./docs/PRD-P3-CLOUD.md) / [ARCHITECTURE-P3-增补](./docs/ARCHITECTURE-P3-增补.md)                   | P3 云盘模块                                         |
| [docs/PRD-P4A-SITE.md](./docs/PRD-P4A-SITE.md) / [ARCHITECTURE-P4A-增补](./docs/ARCHITECTURE-P4A-增补.md)                 | P4a 个人网站（开放站点 + 文章）                     |
| [docs/PRD-P4B-SITE.md](./docs/PRD-P4B-SITE.md) / [ARCHITECTURE-P4B-增补](./docs/ARCHITECTURE-P4B-增补.md)                 | P4b AI 编写站点 + 在线编辑器 + 模板库               |
| [docs/P4C/PRD-P4C-PUBLIC.md](./docs/P4C/PRD-P4C-PUBLIC.md) / [ARCHITECTURE-P4C-增补](./docs/P4C/ARCHITECTURE-P4C-增补.md) | P4c 公开机制 + 批量上传 + 在线解压                  |
| [docs/P4D/PRD-P4D-CLOUD.md](./docs/P4D/PRD-P4D-CLOUD.md) / [ARCHITECTURE-P4D-增补](./docs/P4D/ARCHITECTURE-P4D-增补.md)   | P4d 移动/批量/打包下载 + 分享升级 + 语义分流        |
| [docs/P4E/PRD-P4E-SITE.md](./docs/P4E/PRD-P4E-SITE.md) / [ARCHITECTURE-P4E-增补](./docs/P4E/ARCHITECTURE-P4E-增补.md)     | P4e 多站点（配额化）+ 删站 + AI 多站语义 + sid 脱敏 |
| [docs/PLATFORM-GUIDE.md](./docs/PLATFORM-GUIDE.md)                                                                        | 平台使用手册（注入 AI system prompt）               |
| [docs/PROGRESS.md](./docs/PROGRESS.md)                                                                                    | 进度台账（任务拆解与完成记录，AI 每次交付后更新）   |

## 路线图

- [x] 后台管理底座（认证 / RBAC / 系统管理）
- [x] AI 对话 + 多厂商切换 + 套餐积分
- [x] AI 工具调用（自然语言操作系统）+ 平台知识问答
- [x] 云盘（公开链接 / 批量拖拽上传 / 在线解压）
- [x] 云盘增强二期（移动与批量 / 打包下载 / 分享提取码与文件夹分享 / 公开语义分流）
- [x] 个人网站（支持 AI 生成站点）
- [x] 多站点（P4e：站点数配额 + 站点列表/删站 + AI 多站语义 + 日志 sid 脱敏）
- [ ] AI 定时任务、真实支付接入、RAG 知识库

## License

个人项目，暂未选择开源协议。
