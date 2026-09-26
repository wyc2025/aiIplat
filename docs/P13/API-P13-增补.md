# API-P13-增补：应用市场（快照式发布 / 审核 / 复制）

> 并入目标：API 新增 §20。上游 §19（P12）已闭环。
> 编号：D107~~D111 / R117~~R123 / T117~~T123。**HTTP 端点 +7；错误码 +3（50013~~50015）；AI 工具 38→41；零新依赖**。

## 20. P13：应用市场（增补并入）

> 提交/浏览/复制 = 登录态（同云盘属主口径）；审核 = `market:review` 权限 + @OperationLog；**无匿名端点**（D111）。

### 20.1 端点（+7）

**用户侧（`/api/market`，登录）**

| 方法 | 路径                      | 说明                                                                                                                                                                |
| ---- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST | `/api/market/submissions` | body `{ appCode, withDemoData? }`；提交即物化快照（R117/R118）；重复活跃条目 **50013**；演示数据超限 **50015**；成功 `{ listingCode, status: 'pending' }`           |
| GET  | `/api/market/mine`        | 我的提交（含 pending/approved/rejected/delisted 全状态，时间倒序）                                                                                                  |
| GET  | `/api/market/list`        | 市场列表：approved 且未 delisted，分页（page/pageSize ≤50），item `{ code, name, description, publisherName, tableCount, pageCount, hasDemo, copyCount, listedAt }` |
| GET  | `/api/market/:code`       | 条目详情（元数据卡片全字段）；不存在/未上架 → **50014**                                                                                                             |
| POST | `/api/market/:code/copy`  | 复制：物化为接收方新应用（R119）；条目不可复制 **50014**；配额满 **50002**；成功 `{ appCode }`                                                                      |

**审核侧（`/api/market/review`，`market:review` + @OperationLog）**

| 方法 | 路径                      | 说明                                                                                                                   |
| ---- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| GET  | `/api/market/review/list` | pending 列表（含快照摘要：表/页清单，供审核预览结构）                                                                  |
| POST | `/api/market/review/:id`  | body `{ action: 'approve'\|'reject'\|'delist', note? }`；reject 必填 note；approve 写 listed_at；delist 写 delisted_at |

### 20.2 AI 工具（+3，write 级，工具总数 38 → 41）

| 工具              | parameters                                                       | 成功返回要点                                                                         | risk  |
| ----------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----- |
| publish_data_app  | `{ appCode, isPublic }`                                          | `{ ok, pubCode?, pubUrl?, missing[] }`（开启未过 R103 → 50012 带缺项；关闭即时失效） | write |
| expose_data_app   | `{ appCode, target: 'table'\|'field'\|'page', name, isExposed }` | `{ ok, target, name, isExposed }`（page 非 display → 50004）                         | write |
| submit_market_app | `{ appCode, withDemoData? }`                                     | `{ ok, listingCode, status: 'pending' }`（50013/50015）                              | write |

- 三工具 handler 全经 Facade（AppFacade / MarketFacade），perms 空（属主自服务），关键词 app 组精准复合词（不抢 siteCms）。
- **模型闭环**：list_data_apps（PATCH2 只读）→ expose_data_app 补缺项 → publish_data_app → submit_market_app。
- 冒烟新增 **N 用例**（write 链，自动确认卡）：「把应用 X 公开并提交市场」→ 断言 expose/publish/submit 按序出现；`check:ai` 断言数 17 → 18 项。
- 手册：能力清单 +3 行（≤100 字，931→约 1030/1200）；**合注 1978/2000 仅余 22 字，先腾挪再写入（R123）**；通用版不动。

### 20.3 错误码（+3）

| 码    | 文案                     | 场景                                    |
| ----- | ------------------------ | --------------------------------------- |
| 50013 | 该应用已有待审或在架条目 | 重复提交                                |
| 50014 | 市场条目不存在或未上架   | 详情/复制防探测（未登录另行 401）       |
| 50015 | 提交内容不合规           | 演示数据超 100 行/表、快照超限/结构非法 |

复用：50001（属主）/ 50002（配额）/ 50004（页面校验）/ 50012（发布缺项）。50xxx 用至 50015；30xxx / 40xxx 零新增。

### 20.4 配置登记（新增 market 组，env `MARKET_*`）

`market.demoMaxRowsPerTable=100` / `market.snapshotMaxBytes=262144`

### 20.5 编号登记

| 系列      | 本期使用                | 说明                                               |
| --------- | ----------------------- | -------------------------------------------------- |
| 决策      | D107~D111               | PRD-P13 §2                                         |
| 规则      | R117~R123               | PRD-P13 §3                                         |
| 任务      | T117~T123               | PROGRESS「P13 任务拆解」（含 T122 = P12 尾巴收尾） |
| HTTP 端点 | +7                      | §20.1                                              |
| 错误码    | +3（50013~50015）       | §20.3                                              |
| DB        | +1 表（market_listing） | ARCHITECTURE §29.2                                 |
| AI 工具   | +3（38→41）             | §20.2；check:ai + smoke N（T95 制度）              |
| 前端依赖  | +0                      | 复用卡片流/抽屉/表单既有资产                       |
