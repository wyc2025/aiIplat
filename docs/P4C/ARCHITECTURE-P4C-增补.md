# iplat —— ARCHITECTURE-P4C 增补（云盘公开机制 + 批量拖拽上传 + 在线解压）

> 与 PRD-P4C-PUBLIC.md 同读。章节号 §16 起，T50 完成后并入 ARCHITECTURE.md 主文档并删除本指针。
> **并入进度**：主文档头部已加本指针行（T46）；T46 新增公共资产（公开访问判定链 / CloudFacadeModule）已登记主文档 §9 资产表；其余增量（UploadQueue / FileView / UnzipService 等）随对应任务登记，T50 全量并入 §16 后本文件退役。
> 主文档全部既有约定（统一响应 / 网关层 / 域边界 / 开放层纪律）继续有效，本文只写增量。

---

## 16.1 数据库变更（cloud 域）

`cloud_file` 表加两列：

| 列              | 类型                           | 说明                                                                 |
| --------------- | ------------------------------ | -------------------------------------------------------------------- |
| `public_token`  | VARCHAR(32) NULL，**唯一索引** | 仅显式设公开（is_public=1）的行有值；取消公开置空（token 轮换，R27） |
| `allow_listing` | TINYINT NOT NULL DEFAULT 1     | 仅文件夹有意义：1=允许访客浏览列表，0=仅路径可达（D32）              |

- 迁移后存量数据不受影响（is_public=0 的行 token 为 NULL）
- token 生成：URL-safe 随机串 ≥21 位；插入撞唯一索引时重生成重试（R24）
- 软删（deleted_at 非空）的行 token 视为失效，公开端点查询条件必须带 `deletedAt: null`

## 16.2 公开访问链路（开放层扩展）

### 路由与前缀（D31）

公开端点独立前缀 **`/api/pub/`**，挂在 site 域开放层旁（与 `/api/open/` 并列），由开放层统一装配：@Public + 独立限流桶 + 统一 40400 防探测。slug 校验规则不变，无需保留字。

### 端点清单（契约字段见 API-P4C-增补.md）

| 端点                                    | 说明                         | 限流桶      |
| --------------------------------------- | ---------------------------- | ----------- |
| `GET /api/pub/f/{token}/info`           | 独立公开文件元信息           | 数据 60/分  |
| `GET /api/pub/f/{token}/raw`            | 文件流（inline + Range）     | 静态 120/分 |
| `GET /api/pub/f/{token}/download`       | 文件流（attachment）         | 静态 120/分 |
| `GET /api/pub/d/{token}/list?path=`     | 公开文件夹列表（单层）       | 数据 60/分  |
| `GET /api/pub/d/{token}/info?path=`     | 文件夹内子项元信息           | 数据 60/分  |
| `GET /api/pub/d/{token}/raw?path=`      | 子项文件流（inline + Range） | 静态 120/分 |
| `GET /api/pub/d/{token}/download?path=` | 子项文件流（attachment）     | 静态 120/分 |

### 判定链路（每个端点统一）

```
token 查 cloud_file（deletedAt null 且 is_public=1）→ 40400
→ 三态上溯判定（任一祖先 is_public=2 → 40400）（R25）
→ d 类端点：path 逐段下行解析子项（任一段不存在/未继承公开 → 40400；目标项 is_public=2 → 40400）
→ list 端点额外：allow_listing=0 → 40117
→ 输出：info/list 走统一响应 {code,message,data}；raw/download 走流式（@SkipTransform）
```

- raw/download 复用 T27 `streamToResponse`（Range 三形式 / 206 / 416）与 StorageService 流式读取，**禁整文件进内存**
- MIME：白名单沿用 P3 预览白名单；**text/html、image/svg+xml 强制 attachment**；文本类强制 `text/plain; charset=utf-8`（R26）
- 缓存头：no-cache + ETag（D28 口径）；304 支持
- 一期不加 Redis 缓存（D38），DB 直查

### 实现归位

- `modules/cloud/` 内新增 `public/` 子模块（controller + service），经 CloudFacade 复用路径解析与流式能力；**不跨域 import site 域内部文件**
- 三态上溯判定逻辑已有（P4a），抽取复用，禁止重写一份

## 16.3 落地页前端（web）

- 静态路由三条：`/view/f/:token`、`/view/d/:token`、`/view/d/:token/file`，全部无布局、免登录，加入 router guard 白名单（照 T31 `/share/:token` 先例）
- 组件：`views/cloud/public-view/FileView.vue`（类型分支，query/path 两种寻址共用）+ `FolderView.vue`（列表 + 下钻）
- `<video>/<audio>` 的 src 直接指 raw 端点，浏览器自动发 Range 请求
- 文本分支渲染一律 `textContent`；页面 `<meta name="robots" content="noindex">`
- 失败态组件：统一 404 提示（不区分原因）
- 复制公开链接复用已修复的复制能力；若为新增公共函数须登记资产表

## 16.4 批量上传队列（web）

- 新组件 `views/cloud/file/UploadQueue.vue`（面板：逐文件进度 + 总进度 + 结果汇总）+ `useUploadQueue.ts` composable（队列状态机）
- 并发 3，worker 池模式；单文件失败记录原因继续下一个（R28）
- drop zone：FileExplorer 列表区监听 dragover/drop；`e.dataTransfer.items` 检测 `webkitGetAsEntry().isDirectory` → 文件夹则提示不入队（D35）
- 上传走既有 instance 直连 + onUploadProgress（T31 口径），`timeout: 0`
- 队列非空时注册 beforeunload，卸载时移除
- 后端零改动（D34）

## 16.5 在线解压链路（api）

### 依赖（D37 特批）

`apps/api` 直接依赖新增：`yauzl`（流式 zip 解压）+ `iconv-lite`（GBK 解码）。除此之外零新增。**安装后即登记本节与资产表。**

### 配置组扩展（upload 配置组，照 P3 先例）

| 环境变量                     | 默认               | 说明                   |
| ---------------------------- | ------------------ | ---------------------- |
| `CLOUD_UNZIP_MAX_ENTRIES`    | 5000               | 单包条目数上限         |
| `CLOUD_UNZIP_MAX_TOTAL_SIZE` | 524288000（500MB） | 单包解压累计总大小上限 |

单条目大小上限直接复用 `CLOUD_MAX_FILE_SIZE`，不新增配置。

### 流程（`POST /api/cloud/file/:id/unzip`）

```
校验：目标是 zip（扩展名 + size ≤ CLOUD_MAX_FILE_SIZE）→ 30014
→ 计算解压目标：同目录 / 包名文件夹（R4 同名"(1)"，R31）
→ 配额预检：used + 压缩包声明总大小 > quota → 30003（预检仅尽早失败，以实时累计为准）
→ yauzl 流式逐条读取：
    条目名校验（含 ".." / 绝对路径 / 反斜杠开头 → 30016，整包拒绝）
    条目名非 UTF-8 flag → iconv-lite GBK 解码
    条目数累计 > MAX_ENTRIES → 30015
    目录条目：记录待建（深度/数量上限沿用 R6 / 单目录 500 项 30006）
    文件条目：流式写 tmp 区（createWriteStream，禁入内存），累计大小 > MAX_TOTAL_SIZE 或超配额 → 30015/30003
→ 全部成功：批量 moveToStorage 转正 + 事务落库（目标文件夹行 + 全部文件行 + used 记账 R3）
→ 任何失败：清理 tmp + 已转正文件回滚删除，零残留（R30）
→ @OperationLog；同步返回 { folderId, folderName, fileCount, totalSize }
```

- 单文件接口语义同步：IO 期间前端 loading + `timeout: 0`
- 实现位置：`modules/cloud/transfer/unzip.service.ts`（与上传同属传输层）

## 16.6 错误码增量

| 码    | 场景                                                                 | 号段归属        |
| ----- | -------------------------------------------------------------------- | --------------- |
| 30014 | 压缩包格式不支持或已损坏                                             | cloud（管理侧） |
| 30015 | 解压超限（条目数 / 累计总大小）                                      | cloud           |
| 30016 | 压缩包含非法路径条目（Zip Slip 拦截）                                | cloud           |
| 40117 | 该文件夹未开放列表浏览                                               | 开放层          |
| 40400 | 公开资源类统一（token 无效 / 已取消 / 已删除 / 被阻断 / 路径不存在） | 复用既有        |
| 42900 | 限流                                                                 | 复用既有        |

## 16.7 公共资产表追加（T50 并入主文档 §9）

| 资产                         | 位置                     | 说明                              | 状态     |
| ---------------------------- | ------------------------ | --------------------------------- | -------- |
| 公开访问判定链               | modules/cloud/public/    | token 校验 + 三态上溯 + path 下行 | P4c 新增 |
| UploadQueue / useUploadQueue | views/cloud/file/        | 并发 3 上传队列 + drop zone       | P4c 新增 |
| FileView / FolderView        | views/cloud/public-view/ | 公开落地页 / 列表页               | P4c 新增 |
| UnzipService                 | modules/cloud/transfer/  | yauzl 流式解压 + tmp 中转事务     | P4c 新增 |
| 依赖白名单追加               | package.json（api）      | yauzl + iconv-lite（D37 特批）    | P4c 新增 |

## 16.8 文档同步要求（R22 纪律联动）

- 三套模板 README.txt：补「公开文件 raw 直链（/api/pub/f/{token}/raw）可被站点页面引用」说明（逐字一致，T50 抽查）
- PLATFORM-GUIDE.md：加公开/批量上传/解压能力摘要，改完跑字数核查（≤2000 字）
- 根 README.md 刷新（P4b 走查观察 1）：路线图勾至 P4c、目录结构补 cloud/site、技术栈补 CodeMirror 6 / yauzl / iconv-lite、文档索引补 P3~P4c 各 PRD
