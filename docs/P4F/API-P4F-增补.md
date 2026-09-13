# API-P4F 增补 —— 回收站自动清理 + 配额对账

> 验收后并入 API.md 为 §11。与 PRD-P4F-CLOUD（D58~~D61 / R58~~R62）对齐。**本期零新错误码**（参数错误复用 40001，权限复用 cloud:admin:quota）。

## 11.1 变更总览

- 新增：配额对账诊断 + 修正两端点（管理侧）
- 行为变化（无接口变更）：回收站超 N 天行每日自动物理清除（默认 30 天，`CLOUD_RECYCLE_RETENTION_DAYS` / `CLOUD_RECYCLE_CLEAN_ENABLED`）
- 前端行为修复（无接口变更）：ElMessageBox 中文化、`download(row)` Blob 回收口径、guard.ts 调试日志收敛、云盘「配额」按钮对 admin 行放开（R62）

## 11.2 配额对账（登录态，`cloud:admin:quota`）

| 方法 | 路径                                     | 说明                                                                                                                                                                                                                                                                                                              |
| ---- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET  | /api/cloud/admin/usage-reconcile?userId= | 诊断（只读）。`userId` 缺省 = 全用户。单用户响应：`{ userId, stored, expected, diff, parts: { active: {count,bytes}, recycled: {count,bytes}, revertedAvatars: {count,bytes} } }`；全用户 = 上述对象的数组。`expected = active.bytes + recycled.bytes − revertedAvatars.bytes`（R60），`diff = expected − stored` |
| PUT  | /api/cloud/admin/usage-reconcile         | 修正。body `{ userId }`；服务端重算后写 `cloud_usage.used = expected`（行不存在懒创建）；响应 `{ userId, oldUsed, newUsed, diff }`；挂 @OperationLog('云盘','配额对账修正')（R61）                                                                                                                                |

前端入口：用户管理「调整配额」弹窗内嵌（打开弹窗并行拉诊断；`diff ≠ 0` 出「按公式值修正」按钮 + 二次确认；diff = 0 显示「一致」），不新开页面（D59）。

## 11.3 回收站自动清理（无 HTTP 端点）

- 纯 cron 行为（每日 03:30，cloud 域 `recycle-clean.task.ts`），规则 R58/R59
- 用户可感知口径进 PLATFORM-GUIDE：「回收站内容保留 30 天后自动彻底清除」
- 验收复现路径：DB 改 `deleted_at` 构造超期行 + 手动触发 task 方法（或临时调短 N），勿等真实隔天
