# ARCHITECTURE-P13-增补：应用市场（快照式发布 / 审核 / 复制）

> 并入目标：ARCHITECTURE 新增 §29。上游 §28（P12）已闭环。
> 编号：D107~~D111 / R117~~R123 / T117~T123。**零新依赖；+1 域（market）+1 表；AI 工具 38→41**。

## 29.1 域结构（apps/api/src/modules/market/）

| 子目录      | 职责                                                              | 关键类                                                                                    |
| ----------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `listing/`  | 提交（快照物化）/ 我的 / 浏览 / 详情 / 复制编排                   | ListingService、MarketController（`/market`，登录属主口径）                               |
| `review/`   | admin 审核（pending 列表 / 通过 / 拒绝 / 下架）                   | ReviewService、ReviewController（`/market/review`，`market:review` 权限 + @OperationLog） |
| `snapshot/` | 快照结构（纯函数）：物化 ⇄ 序列化，**零依赖手写校验**（zod 先例） | snapshot.ts、snapshot-marshal.core.ts                                                     |
| `facade/`   | MarketFacade（ai 域工具用：submit/listMine）                      | MarketFacadeModule                                                                        |

- **market 域零跨域 import**：复制物化经 `AppFacade.materializeListing`（新增写方法）；审核/浏览只读 market 自有表。
- ai 域工具三走：expose/publish → AppFacade 新增方法；submit → MarketFacade。

## 29.2 数据模型（market_listing，迁移 `20260927xxxxxx_add_market_domain`）

| 列                                      | 说明                                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------------ |
| id / code                               | 市场条目编号（对外展示用，slug 化）                                                  |
| publisher_id / publisher_name           | 发布者（快照时冗余昵称，防用户改名影响在架卡片）                                     |
| source_app_id                           | 谱系（副本的 source_app_id 也记它，照 R93/ARCH §28.8）                               |
| name / description                      | 快照时冗余（与源应用解耦）                                                           |
| snapshot JSON                           | 结构快照（R117）：{ version, tables:[{name,label,fields:[…]}], rels:[…], pages:[…] } |
| demo_data JSON\|null                    | 演示数据（R118）：{ table: [{data…, attachment 字段已置 null}] }；has_demo 冗余标记  |
| status                                  | pending / approved / rejected / delisted                                             |
| review_note / reviewer_id / reviewed_at | 审核三件套（拒绝必填 note）                                                          |
| copy_count                              | 复制次数（元数据卡片展示）                                                           |
| created_at / delisted_at                | —                                                                                    |

索引：`(status, created_at)` 浏览、`(publisher_id, source_app_id, status)` 50013 校验查询、`uk(code)`。「每应用 1 活跃条目」应用层校验（MySQL 无部分唯一索引）。

## 29.3 复制物化流程（AppFacade.materializeListing，红线全走 DataService）

```
POST /market/:id/copy（接收方登录态）
  ├─ 校验条目 approved 且未 delisted（否则 50014）
  ├─ 校验接收方应用配额（50002）
  ├─ 事务内重建结构：app_def(active, source_app_id=谱系, is_public=0)
  │    → tables/fields（快照逐名重建，n:n 中间表照 set_relation 重建 from_id/to_id）
  │    → pages（schema 原样，admin/display 都建，is_public=0）
  ├─ demo_data 逐行 DataService.create（独立事务；错误行跳过 + 计数；附件字段已 null 无需处理）
  └─ copy_count+1；返回 { appCode }（接收方菜单即时出现，R96 动态段）
```

- 物化在 **app 域内完成**（AppFacade 实现，复用 SchemaService/PageService/DataService），market 域只做编排——数据写入红线不破。
- 快照结构非法（版本不符/缺表缺字段）→ 50015 语义拒绝（不静默修补）。

## 29.4 AI 工具链路（ai 域，全经 Facade）

| 工具              | 参数                                   | 成功返回                                 | 关键路径                                         |
| ----------------- | -------------------------------------- | ---------------------------------------- | ------------------------------------------------ |
| publish_data_app  | `{ appCode, isPublic }`                | `{ ok, pubCode?, pubUrl?, missing[] }`   | AppFacade.setPublic（R103 校验 → 50012 带缺项）  |
| expose_data_app   | `{ appCode, target, name, isExposed }` | `{ ok, target, name, isExposed }`        | AppFacade.setExposure（page 非 display → 50004） |
| submit_market_app | `{ appCode, withDemoData? }`           | `{ ok, listingCode, status: 'pending' }` | MarketFacade.submit（50013/50015）               |

- 三工具 write 级确认卡；确认文案含后果（R122）；关键词归 app 组（精准复合词，不抢 siteCsm——照 PATCH2 纪律）。
- **模型闭环流**：list_data_apps（读缺项）→ expose_data_app 逐表/页补齐 → publish_data_app 开公开 → submit_market_app 提交市场。

## 29.5 前端（apps/web）

- 应用中心加「应用市场」节点（seed，所有登录用户）；三个新页：`views/market/index.vue`（卡片流）、详情抽屉（内嵌复制按钮）、`views/market/review/index.vue`（admin）；我的应用卡片加「发布到市场」弹窗。
- 发布弹窗：withDemoData 勾选 + 行数预览（>100 红字，照配额表交互先例）；复制成功 ElMessage + 跳新应用结构页。

## 29.6 安全 / 配置 / 接缝

- 安全：快照 JSON 入出库均过 snapshot-marshal 校验（防手改库致物化炸）；复制物化全参数绑定；审核 @OperationLog；市场接口登录态（无匿名浏览 v1）。
- 配置（`market.config.ts`，env `MARKET_*`）：`demoMaxRowsPerTable=100` / `snapshotMaxBytes=256KB`。
- 与 P14 接缝：市场更新机制（编辑/新版本）→ 挂账；AI 创建 agent 化 → P14；市场运营数据（复制榜等）→ 有量再立。
