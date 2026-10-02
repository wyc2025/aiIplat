# 走查补丁 W11：对外附件流纳入凭证 scope 收窄（轻量单文档）

编号：W11（走查报告-P15-C 开出）｜任务：T151 ｜日期：2026-10-02
状态：**已拍板生效**（2026-10-02 用户确认收窄裁决），可转交 CodeBuddy 实施
增量：零新表 / 零新端点 / 零新错误码 / 零新依赖 / 零内部 AI 工具变动。

---

## 1. 背景与缺陷

对外附件流端点 `GET /api/ext/v1/app/:appCode/files/:fileId/stream`（REST 与 MCP 同源，实现 `apps/api/src/modules/app/pub/pub-data.service.ts#attachmentStream`）准入判定只看两条：

1. 引用索引 `app_attachment_ref`（文件确被该应用某行引用）；
2. 表·字段暴露三开关。

**缺第三条**：同组 records/detail 端点都做的 `assertTableInScope`（凭证 scope 交集）。后果：凭证 scope 只含 A 表时，只要 B 表与其附件字段已暴露、且 B 表某行引用了文件 F，该凭证仍可流式下载 F——与「scope 即授权边界」的设计口径不一致（fileId 为 UUID 不可猜只是缓解，不是口径；且 UUID 可经开放层公开页、其他凭证等渠道外流）。

## 2. 裁决（走查报告 §3 W11）

**收窄**：附件流在 credential 主体分支下补 scope 交集判定，与 records 同源同口径。

## 3. 判定链修订（仅 credential 分支动）

```
attachmentStream(appCode, fileId, principal)
  → 既有：引用索引查找（得引用集合 refs = [{table, field, rowId}, …]）
  → 既有：表·字段暴露三开关
  → 【新增】principal 为 credential 时：
      refs 中至少存在一条 (table, field) 满足
        table ∈ scope.tables
        且（scope.fields 未配置该表 或 field ∈ scope.fields[table]）
      否则 → 40400（与 records 越权同码同语义，防探测口径不变）
  → display / 匿名分支：不变（display 主体无 scope 概念，P14 口径不动）
```

- 交集语义与 `assertTableInScope` 完全同款：scope.fields 未配置 = 该表全字段（在暴露开关内）。
- 多引用文件（同一文件被多表/多行引用）：任一引用落在 scope 内即放行——与 records「行可见即可读其附件」的直觉一致。
- 失败一律 40400，不区分「未引用 / 未暴露 / 越 scope」（防探测不裂缝）。

## 4. 边界与非目标

- 不动开放层匿名取数（P14 链路）；不动管理侧；不动 acc_credential 表结构与 scope 存储格式。
- 不做「行级」收窄（rowFilter 是后续候选，本期补丁不搭车）。

## 5. 验收（并入 smoke:ext，第 7 段扩 2 条）

1. **新负例**：凭证 scope 不含 album 表（其余条件与 C3 正例相同）→ `files/:fileId/stream` 返回 40400（防探测形态）。
2. **新正例**：scope 含 album 但 fields 仅配 `['title']`（不含 cover）→ cover 引用文件 40400；改为含 cover 后 200——验证字段级交集。
3. 回归：smoke:ext 原 41 条全绿（C3 段 4 条正例的凭证 scope 本已含 album 全表，不受影响）；smoke:mcp 36/36 全绿（MCP 侧同源，自然继承）。

## 6. 文档落点

- API §22.2 附件流端点补一句：「credential 主体按 scope 表·字段交集收窄（W11）；display/匿名主体不变」。
- ARCH §31 附件流判定链补第三步；遗留 38 标注「已由 W11 收窄」。
- PROGRESS 补 T151 行 + 回执；遗留 38 关闭。
