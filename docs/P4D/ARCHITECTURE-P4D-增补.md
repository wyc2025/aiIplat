# iplat —— ARCHITECTURE-P4D 增补（云盘操作增强 + 分享升级 + 公开语义分流）

> **[已并入]** 本增补已于 T58（2026-09-12）作为 **§17** 完整并入 `docs/ARCHITECTURE.md`（含实现偏差登记 §17.8）。
> 本文件保留为历史细节参考（同 P3/P4a/P4b/P4c 增补惯例），**与主文档冲突时以主文档与代码为准**。
> 既有约定全部继续有效，本文只写增量。

---

## 17.1 数据库变更（cloud 域）

`cloud_share` 表加列：

| 列              | 类型             | 说明                                                     |
| --------------- | ---------------- | -------------------------------------------------------- |
| `password_hash` | VARCHAR(64) NULL | 提取码哈希（D47，不明文存储）；NULL = 无密码（现状兼容） |

- `cloud_share.file_id` 既有引用即可承载文件夹（行 isDir=1 的 id），**无需改列**；分享文件夹 = file_id 指向目录行（D48）
- 迁移手写 migration.sql + `migrate deploy`（沿用 T46 环境口径）

## 17.2 移动与批量（api，modules/cloud/）

### move 接口

`POST /cloud/file/:id/move`，body `{ targetParentId }`，`cloud:file:upload` + @OperationLog：

```
assertOwned（源与目标均当前用户，30001）→ 目标必须是目录且不在回收站
→ 防环：targetParentId 位于源子树内（含源自身）→ 30019；源为站点根 → 30019；源在回收站 → 30019
→ 同名判定 R4 → 计算 targetPublic（目标上溯是否经过 is_public=1 锚点：站点根或 token 公开目录）
→ 更新 parentId（逻辑外键，单字段写）；used 不变
→ 响应 { id, name, finalName, targetPublic }
```

- 批量移动 = 前端队列逐条调 move（D42），无批量接口
- 公开继承警告（R39）：`targetPublic: true` 时前端弹确认框二次确认后重发（携带 `confirmPublic: true` 跳过二次标记——防止每个批量项都弹窗：批量移动遇公开目标时**整批一次确认**，前端合并处理）

### file.list 扩展（R46）

行内新增 `inSite: boolean`——后端沿 parentId 上溯，经过站点根锚点（site_site.root_folder_id）即为 true。上溯有界 ≤10 层，与公开判定链同口径。

### 打包下载

`POST /cloud/file/pack-download`，body `{ ids: string[] }`（1~100 项），`cloud:file:list` 权限，@SkipTransform 流式：

- yazl 流式压缩：逐文件 createReadStream → zip 流 → 响应，**零临时落盘、禁整包进内存**（D45/R41）
- zip 内条目名写 UTF-8 flag（防 Windows 资源管理器 GBK 误读）
- 目录条目递归展开（有界 ≤10 层、条目总数复用 CLOUD_UNZIP_MAX_ENTRIES 口径 5000 上限，超出截断并记日志）
- 管理侧视角：打包自有文件不查三态；回收站内 id → 跳过并在响应头 `X-Pack-Skipped` 计数
- 响应头：`Content-Type: application/zip`、`Content-Disposition: attachment; filename*=UTF-8''iplat-pack-*.zip`
- 单条目 > CLOUD_MAX_FILE_SIZE → 跳过并计入 skipped（R41）

## 17.3 分享升级（api，modules/cloud/share/）

### 提取码链路（D47/R42）

- 创建/编辑分享：`POST /cloud/share` body 加 `password?: string`（4~8 位；空 = 移除密码）；存 `password_hash`（bcrypt，复用既有依赖）
- 访客校验：`POST /cloud/share/:token/verify`（@Public，body `{ password }`）→ 通过签发**短期访问凭证**（Redis `share:pass:{token}:{sid}` TTL = min(2h, 分享剩余有效期)，sid 返回前端持有）→ 后续访客请求头 `X-Share-Sid: {sid}`
- 无密码分享：verify 直通（现状兼容）
- 防爆破：`share:passfail:{ip}:{token}` INCR，连续 5 次锁 10 分钟（照登录 10102 口径），错误码 30018（密码错误/锁定复用提示剩余秒数）

### 访客端点扩展

既有 `GET /cloud/share/:token`（info）+ `/download` 扩展：

| 端点                                 | 说明                                                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `GET /cloud/share/:token`            | info 响应扩展：`needPassword`、`itemType: file\|folder`、`mime/ext/size`（供预览分支）；未过密码门 → 30017 |
| `GET /cloud/share/:token/raw`        | 新增：文件流（inline + Range），MIME 口径同 R26/R44（html/svg 强制 attachment）                            |
| `GET /cloud/share/:token/list?path=` | 新增：文件夹分享单层列表（动态子树 R43；is_public=2 项过滤不可见）                                         |
| `GET /cloud/share/:token/pack`       | 新增：文件夹分享整包下载（复用 §17.2 yazl 链路，访客视角**含三态过滤**）                                   |

- 所有访客端点统一经密码门（needPassword 且无有效 sid → 30017）；独立限流 30 次/分/IP 沿用
- 文件夹分享停止/过期/删除源 → 全端点 30008（既有分享失效码）
- 错误码新增：30017 需提供提取码 / 30018 提取码错误或已锁定 / 30019 非法移动目标（§17.2）

## 17.4 前端（web）

### 数据源适配层（D46）

- `views/cloud/public-view/FileView.vue` / `FolderView.vue` 抽 `usePublicSource` 适配层：`{ kind: 'pub'|'share', token, sid? }` → 统一 info/list/raw/download 取数；公开页与分享页共用渲染组件
- 分享访客页 `/share/:token` 改造：密码门禁子页 → FileView（文件）/ FolderView（文件夹）

### 云盘页

- 剪切板：`useClipboard` 命名冲突注意（已有 vueuse useClipboard 用于复制）——内部移动剪切板命名 `useMoveClipboard`（pinia 或组件态，会话内存不持久化）
- 拖拽：行 draggable + 目标 dragover 高亮（文件夹行 / 面包屑项）；`dataTransfer.types` 含 `Files` → 上传（T48 链路）、否则 → 内部移动（R40）
- 多选：`selectionMode` ref 切换复选框列；多选工具栏挂文件页头部
- 公开分流：按钮组按 `row.inSite` 渲染（R45）；`useMoveClipboard` 粘贴触发 R39 警告弹窗

## 17.5 错误码增量

| 码    | 场景                                       |
| ----- | ------------------------------------------ |
| 30017 | 该分享需要提取码（未验证或凭证过期）       |
| 30018 | 提取码错误（含连续错误锁定提示剩余秒数）   |
| 30019 | 非法移动目标（自身子树 / 站点根 / 回收站） |

## 17.6 公共资产表追加（T58 并入 §9）

| 资产             | 位置                     | 说明                                   | 状态     |
| ---------------- | ------------------------ | -------------------------------------- | -------- |
| usePublicSource  | views/cloud/public-view/ | pub/share 双寻址数据源适配层           | P4d 新增 |
| PackService      | modules/cloud/transfer/  | yazl 流式打包（管理侧 + 分享侧双调用） | P4d 新增 |
| 分享密码门       | modules/cloud/share/     | verify + sid 凭证 + 防爆破             | P4d 新增 |
| useMoveClipboard | views/cloud/file/        | 剪切/粘贴/拖拽移动状态                 | P4d 新增 |
| 依赖白名单追加   | package.json（api）      | yazl（D45 特批）                       | P4d 新增 |

## 17.7 文档同步要求

- PLATFORM-GUIDE：分享提取码/文件夹分享/批量操作/语义分流摘要，改完字数核查（≤2000）
- README.txt 三套：本次开放层契约无变更（分享非站点开放 API），**无需改动**，T58 复核确认即可
- 盘点文档与交接文档：P4d 完成状态由走查环节更新
