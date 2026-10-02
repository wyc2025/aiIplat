# ARCHITECTURE-P17 增补（§33：rowFilter 行级收窄）

版本：2026-10-02 ｜ 对应 PRD-P17（D136~~D138 / R147~~R150 / T152~T154）
地位：主文档 ARCHITECTURE.md §33 的入库蓝本。

---

## §33.1 落点（零新表、零新域文件结构变动）

- 存储：`acc_credential.scope` JSON 的 `rowFilter` 槽位启用（DDL 不变，`{ tables, fields, ops, rowFilter }`）。
- 改动集中两处：
  - `access/credential/`：创建/编辑校验链加 rowFilter 校验段（R147）；
  - 取数内核（ext-contract 同一实现）：scope 交集后、请求 filter 合并前，注入 rowFilter WHERE 段（R148）。
- MCP（`access/mcp/`）零改动——三件套走同一内核（§32.4），透明继承（R150）。

## §33.2 校验链修订（管理侧，创建/编辑凭证）

```
scope 校验（既有：tables ∈ 暴露表、fields ∈ 暴露字段、ops 合法 → 50021）
  → 【新增】rowFilter 校验（R147）：
      每条条目：表 ∈ scope.tables（否 50021）
        → 字段 ∈ 该表 scope 字段口径 ∧ 暴露开关内（否 50021）
        → 算子 ∈ R104 算子集（否 50021）
        → 值按字段定义类型可解析（否 50021）
      errmsg 指明条目（表.字段 + 原因）；每表 ≤3 条（超 50021）
```

- 解析器复用：与 R104 请求 filter **同一解析函数**（铁律 5），rowFilter 校验 = 解析 + 存在性/暴露检查，不新写语法。

## §33.3 查询注入语义（R148）

```
对外取数（records / detail）
  → 既有：scope ∩ 暴露投影（表/字段）
  → 【新增】rowFilter 条件 → WHERE 段（AND，参数化绑定，值已按字段类型解析）
  → 既有：请求 filter 参数 → WHERE 段（AND）
  → 既有：sort + rowId tiebreaker → keyset 游标
```

- rowFilter 与请求 filter 是**并列 AND**，无优先级；冲突 = 空集 = 空页正常返回。
- **detail 同样注入**：行不满足 rowFilter → 40400（与「行不存在」同表现，防探测不裂缝）。
- 游标与排序零影响（rowFilter 是常量 WHERE，不进游标值）。
- SQL 注入面：全部走参数化绑定，条件串经同一解析器转义（与 R104 filter 同保证）。

## §33.4 运行期失效判拒（R149）

取数时（缓存外路径）对 rowFilter 引用做轻量再校验：表/字段任一失效（下线 / 取消暴露 / 软删）→ 该表判不可见 40400。**不静默跳过失效条目**（跳过 = 结果集放大 = 安全回归）。恢复暴露即自愈，无需改凭证。

> 性能口径：暴露开关与 schema 本就有缓存（§31），再校验挂在同一缓存键上，不新增 DB 往返。

## §33.5 前端（T153，最小产品化）

- 凭证抽屉 scope 编辑区加「行过滤（可选）」textarea：接 JSON 对象 `{"book": ["status:eq:published"]}`；附一行语法说明（`表名 → ["字段:算子:值", …]，每表至多 3 条，多条为且的关系`）+ 算子清单 tooltip。
- 50021 响应的 errmsg 原样展示（含条目定位）；界面文案遵守 AGENTS.md 界面文案准则。
- 不动 PLATFORM-GUIDE（合注余量 7 字）。

## §33.6 演进预留（本期不做）

- OR / 嵌套条件树（需结构化 AST，推翻 D136）；
- 变量插值（如 `{{principal}}`——凭证主体目前无上下文变量）；
- disp_grant 行级（D137 已排除，若做须动 display 域与 P14 链路）；
- 失效判拒的「宽限模式」（如告警而非判拒）——先保守，有真实诉求再议。
