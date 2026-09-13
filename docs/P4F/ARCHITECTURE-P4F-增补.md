# ARCHITECTURE-P4F 增补 —— 回收站自动清理 + 配额对账 + 历史小瑕疵

> 验收后并入主文档为 §19。编号与 PRD-P4F-CLOUD 对齐（D58~~D61 / R58~~R62 / T66~T70）。零新依赖（@nestjs/schedule 自 P2a 已启用）。

## 19.1 配置增量（cloud 配置组）

| 配置                         | env                            | 默认 | 说明                               |
| ---------------------------- | ------------------------------ | ---- | ---------------------------------- |
| `cloud.recycleRetentionDays` | `CLOUD_RECYCLE_RETENTION_DAYS` | 30   | 回收站保留天数（D58）              |
| `cloud.recycleCleanEnabled`  | `CLOUD_RECYCLE_CLEAN_ENABLED`  | true | 自动清理总开关（false 时任务空跑） |

## 19.2 回收站自动清理（T67）

```
modules/cloud/recycle/
├── recycle.controller.ts / recycle.service.ts   # 既有
└── recycle-clean.task.ts                        # 本期新增：@Cron(每日 03:30)
```

- 执行链：`enabled 检查 → 查 deleted_at < now-N 天的行（分页拉取，每批 ≤500）→ 逐根节点走 RecycleService 既有彻底删除链（含子树物理删 + used 回退）→ 汇总日志（扫描/清除/失败三计数）`
- **子树去重**：父目录与子行可能同批命中——以「回收站内的最顶层行」为执行单元（父行清理会级联子行），避免重复删除/重复回退 used；实现可照回收站「清空」按钮既有的顶层归集逻辑
- 幂等：任何一行删除失败只记日志不影响其他行，下轮自然重试；不加分布式锁（个人平台单实例，R59 口径）
- used 记账完全复用彻底删除链内部逻辑（R59 禁另写），彻底删除链已有的「物理文件缺失静默」口径自动覆盖磁盘/库不一致场景

## 19.3 配额对账（T68）

```
modules/cloud/admin/
├── admin.controller.ts   # 新增两端点（cloud:admin:quota）
└── admin.service.ts      # reconcile(userId?) / reconcileFix(userId)
```

- **诊断**：按 R60 公式三段聚合（`SUM/COUNT` 三条 SQL，勿全量拉行）：未删除行 / 回收站行 / 已回退头像行（parent_id=-1 且 deleted_at 非空）；返回 `{ stored, expected, diff, parts: { active, recycled, revertedAvatars } }`（每项含 count+bytes）；`userId` 缺省 = 全用户逐行返回
- **修正**：先重算再写入 `cloud_usage.used = expected`（行不存在则懒创建）；响应带 `{ oldUsed, newUsed, diff }`；@OperationLog('云盘','配额对账修正')
- **前端**：用户管理「调整配额」弹窗打开时并行拉诊断 → 弹窗内一行展示「公式值 X / 当前值 Y / 差额 Z」；`diff ≠ 0` 时出现「按公式值修正」按钮（二次确认文案带旧/新值）；diff = 0 显示「一致」不出按钮
- 归因提示：22,751 字节历史差额大概率落在「已回退头像行」识别项（P3 头像回退链与 P4d 之前口径差异），诊断明细应能直接验证——结论回填 PROGRESS

## 19.4 三小瑕疵（T69）

1. **download(row) revokeObjectURL**：照 P4d `saveBlob` 最终口径统一（延时回收），全仓 grep `revokeObjectURL` 逐处对齐，不留第二写法
2. **ElMessageBox 中文**：根因修复 = 全局 locale（`app.use(ElementPlus, { locale: zhCn })` 或 ElConfigProvider 顶层包裹，二选一以现状为准）；函数式弹窗（ElMessageBox/ElMessage）读全局配置，修后所有确认框按钮中文；回归检查既有中文硬编码按钮不受影响
3. **guard.ts debug 日志**：移除 `console.warn` 调试残留；如确有排障价值改 `import.meta.env.DEV` 条件输出

## 19.5 资产表 / 手册回写（T70）

- 资产表新增：`RecycleCleanTask`（回收站自动清理 cron）、对账两端点并入既有 admin 行注、`saveBlob` 行注补「全仓 Blob 下载唯一口径」
- README/PLATFORM-GUIDE：回收站 30 天自动清除一句话进手册（用户可感知行为），PLATFORM-GUIDE 字数核查 ≤2000
