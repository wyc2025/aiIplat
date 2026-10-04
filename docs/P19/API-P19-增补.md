# API 增补 — P19 站点发布与版本管理

> 版本：2026-10-02 **v2**（采纳外部代码级分析复核修订）· 状态：已拍板生效
> 配套：PRD-P19 / ARCHITECTURE-P19-增补（D143~~D151 / R156~~R161 / T159~~T164 / 错误码 40121）；前置补丁 W12。
> ⚠ 路由前缀约定：站点 CRUD 现行于 `/api/site/manage/*` 命名空间（顶层 `/api/site/*` 无参数段——Express 路由冲突教训），本批管理态端点同挂该空间、同鉴权；若实施时现状有变，以现状为准并在走查对齐。
> v2 变更：2.7 补充权限解耦（R161）与 disp 不进快照；§5 冒烟补 AI 门禁与验收 #9~~#11。

---

## 1. 端点总表

| #   | 方法   | 路径                                          | 态   | 说明                                     |
| --- | ------ | --------------------------------------------- | ---- | ---------------------------------------- |
| 1   | POST   | `/api/site/manage/:id/publish`                | 管理 | 发布快照并置为当前版本（发布即上线）     |
| 2   | GET    | `/api/site/manage/:id/releases`               | 管理 | 版本列表                                 |
| 3   | POST   | `/api/site/manage/:id/releases/:rid/activate` | 管理 | 切换当前版本（回滚=activate 旧版）       |
| 4   | POST   | `/api/site/manage/:id/releases/:rid/pin`      | 管理 | 锁定/解锁 `{pinned:boolean}`             |
| 5   | DELETE | `/api/site/manage/:id/releases/:rid`          | 管理 | 删除版本（当前/锁定版拒绝）              |
| 6   | GET    | `/api/site/manage/:id/preview/{*path}`        | 管理 | 预览轨：工作副本流式出流                 |
| 7   | GET    | `/api/open/:slug/{*path}`                     | 开放 | **行为变更**：双轨解析（D144），无新端点 |

权限：端点 1~6 均需登录 + 站点权限（与站点 CRUD 同款鉴权；无权限 → 403）。端点 7 维持公开 + 限流 + 40400 防探测（限流档值以代码现状为准，见 W12 待澄清）。

## 2. 端点契约

### 2.1 发布 `POST /api/site/manage/:id/publish`

请求：

```json
{ "label": "首页改版上线" } // label 可选，≤100 字，超长 40001
```

成功响应（平台信封，data 内）：

```json
{
  "id": "rel_…",
  "versionNo": 3,
  "label": "首页改版上线",
  "fileCount": 42,
  "totalBytes": 183204,
  "pinned": false,
  "createdBy": "u_…",
  "createdAt": "2026-10-02T12:00:00.000Z",
  "active": true
}
```

失败：40121（并发发布进行中）；40400（站点不存在）；403（无权限）。

### 2.2 版本列表 `GET /api/site/manage/:id/releases`

data = 版本对象数组（字段同 2.1，`active` 标记当前版本），按 versionNo 倒序。量小（≤上限+锁定），不分页。

### 2.3 切换 `POST /api/site/manage/:id/releases/:rid/activate`

无请求体。成功：data = 被激活的版本对象；`site.active_release_id` 同步翻转，`site:path` 缓存即时失效（R159），下一次开放层请求即生效。目标不存在/不属于该站点 → 40400。

### 2.4 锁定 `POST /api/site/manage/:id/releases/:rid/pin`

请求：`{ "pinned": true }`。锁定版豁免自动清理与手动删除（R158）。

### 2.5 删除 `DELETE /api/site/manage/:id/releases/:rid`

当前版本或锁定版 → 40001（拒绝并说明原因）；其余删除行 + 清理快照目录。

### 2.6 预览 `GET /api/site/manage/:id/preview/{*path}`

读工作副本出流，安全件与开放层同款（MIME 白名单 + CSP 沙箱 + nosniff + ETag/304 + no-cache）；未登录 → 401，无权限 → 403，路径穿越/不存在 → 40400。

### 2.7 开放层行为变更 `GET /api/open/:slug/{*path}`

- `active_release_id` 非空 → 从该版本快照目录出流；**快照轨不消费 `is_public` 三态**（R161 权限平面解耦：工作副本侧任意改动 is_public 不影响已发布内容）；
- 为空 → 维持直挂工作副本（legacy 轨，公开判定遵循 **W12 阻断优先**语义）；
- `:slug/disp/{id}/**` 展示应用托管链维持现状，**不进快照**（D150）；
- 其余安全件、限流、ETag/304、no-cache、40400、回退链全部不变；调用方无感知。

## 3. 错误码增量

| 码    | 含义                           | HTTP                       |
| ----- | ------------------------------ | -------------------------- |
| 40121 | 发布进行中（同站并发抢锁失败） | 200+业务码（平台信封惯例） |

其余复用 40001 / 403 / 40400，零额外新增。

## 4. 管理页「发布与版本」面板规格（前端）

- 入口：站点管理页新增面板/页签「发布与版本」。
- 顶部：「发布新版本」按钮（可填 label 弹窗）；站点从未发布时显示提示条「当前为草稿直出，建议发布」（D144）。
- 列表列：版本号 / 发布时间 / 发布人 / 备注 / 文件数 / 大小 / 操作。
- 当前版本：radio 单选，切换即调 activate（即时生效，可反复横跳）；当前版本行禁用删除。
- 操作：锁定/解锁 toggle、删除（二次确认；当前/锁定版禁用）。
- 发布按钮在 40121 时提示「发布进行中，请稍后」并禁用至完成。
- **验收硬要求：`vite build` 通过**（角色卡纪律）。

## 5. 冒烟 `smoke:site` 场景段 + AI 门禁

覆盖 PRD 验收 1~11：隔离性 / 预览轨正负例 / 发布即上线（含 media/ 可访）/ 回滚横跳 / 并发 40121 + .tmp 无残留 / 保留策略（调小 KEEP 跑）/ legacy 兼容 + disp 链不变 / 路径穿越与越权负例 / **权限解耦负例（工作副本置 2 不影响已发布快照）** / **AI 文案（write_site_files 草稿语义，无「已上线」表述）+ `pnpm check:ai` + `pnpm smoke:ai` 全绿 + 手册合注 ≤2000 字** / 工程门禁（smoke:site 全绿 + smoke:ext、smoke:mcp 回归 + vite build）。
顺带关闭：P18-C1（TTL 自然过期用例条目化进 smoke:ext）、P18-S1（删 PROGRESS 文末过期 zod 行）。
依赖：W12（公开判定链统一）先行合入，legacy 轨直接继承其语义与存量扫描结论。

---

_零新依赖；迁移=1 新表 + 1 新列（可空），安全。_
