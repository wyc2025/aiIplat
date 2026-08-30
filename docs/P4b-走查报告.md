# iplat —— P4b 走查报告（Kimi 走查，2026-08-30）

> 走查对象：P4b 完成后的 PROGRESS.md / ARCHITECTURE.md / API.md / PLATFORM-GUIDE.md（2026-08-29~~30 版）
> 走查基准：PRD-P4B-SITE.md（D19~~D28 / R16~R23 / 12 条验收）+ ARCHITECTURE-P4B-增补.md（§15）+ 九条铁律 + P4a 走查 10 项
> 结论：**走查通过**。12 条验收全部闭环有实证，P4a 走查 9 处补丁逐一落实，我自查的 3 个设计问题（D28 缓存头 / 错误码分段 / mkdir -p）全部按修订实施并有冒烟证据。发现 6 处低severity 文档项 + 2 项观察，无高/中问题。修复量约 10 分钟。

---

## 一、重点通过项（抽查实证，非仅看记录）

1. **P4a 走查 9 处文档补丁全部落实**：W1 §13 已补断档且内容与指令逐字一致；W3 §10 例外清单 ✓；W4 §6.1 例外口径 ✓；W5 备案（§14.11 + API §6.1 双落点）✓；W6 残留指针已清 ✓；W7 40105 双含义 ✓；W8 cloud_file 表补 is_public 行 ✓；W9 §4.7 区分表述 ✓；W10 资产表状态 ✓
2. **W2 三态全链路闭环**：API §6.4/§7.3 双落点 + T43 代码（布尔→三态 int + 双标签 + 按钮 ===1 判断）+ T45 验收 11 实测（取消公开→40400→恢复）
3. **D28 缓存修订链路完整**：§14.4 步骤 6 已改 no-cache + T41 冒烟实证（四文件 no-cache / ETag 304 零字节 / 301 回归）
4. **mkdir -p 陷阱防住了**：冒烟"写两次 pages/about.html 无 pages (1)"实证；R6 计数排除将软删旧文件的细节坑（目录满 500 覆盖误拒）被发现并解决——这个坑我的设计没写到，是实现的超额发现
5. **错误码分段纪律成立**：SiteFacade 40xxx / CloudFacade 30xxx，自查记录明确"无 site 段码出现在 cloud 域"
6. **两个环境缺陷的顺带修复质量好**：body limit 100KB→2mb（否则编辑器 1MB 死在 DTO 之前）、操作日志 TEXT 截断（否则每次保存日志落库失败必报错）——均已回写 §15.5/§15.11
7. **PLATFORM-GUIDE 还债**：T40 其实已超 2000（2035），T41 先压缩再追加，实测当前 1928 字 ✓（并立下"动手册必跑字数核查"的新纪律）
8. **偏差闭环**：summarize ctx 签名 / summary 存储口径 / SiteFacadeModule 独立模块，三处"实现修订→T45 并入同步"全部兑现（§12.1/§15.6/§15.1 已按实现表述）
9. **指针行已删**，§15 并入，增补头部标注"已并入"；测试数据零残留记录完整

## 二、发现（6 低 + 2 观察）

### 【低】B1. §15.8 指针错挂，README 契约纪律实质内容无落点

`### 15.8 README 契约与 PLATFORM-GUIDE 分工（D26/R22，见 §14.9）`——§14.9 是 **Redis Key** 小节，指针错挂。且 15.8 是空壳，D26 的实质（README=AI 契约唯一权威 / 三套逐字一致 / 开放 API 变更必须同步 README / 手册 ≤2000 字）在权威文档里只剩 15.7 末条一句。

**修复**：15.8 改为：

```markdown
### 15.8 README 契约与 PLATFORM-GUIDE 分工（D26/R22）

- 模板内置 README.txt 是开放 API 的 **AI 契约唯一权威**（七端点字段级，以 ./api/ 相对路径视角）；三套模板主体逐字一致（T44 抽查口径）
- **R22 维护纪律**：开放 API 任何变更必须同任务同步三套 README；PLATFORM-GUIDE 只放摘要，注入后总长 ≤2000 字（改动后必须跑字数核查）
```

### 【低】B2. 主文档 §15 缺「前端集成」小节（增补 §15.9 并入时丢失）

增补 §15.9 的 CodeMirror 约束没有落点：**D20 依赖白名单**（codemirror 元包 + 5 个 lang 包，禁主题包/禁增强包——铁律 7 的护栏）、FileEditorDialog 异步加载、ext→language 映射、编辑按钮显示条件（非目录+白名单+≤1MB+v-permission）、三态标签渲染规则。资产表有 FileEditorDialog 行但无约束。

**修复**：§15.5 之后插入：

```markdown
### 15.5a 前端编辑器集成（CodeMirror 6）

- 依赖白名单（D20 批准，除此之外零新增）：`codemirror` 元包 + `@codemirror/state` / `@codemirror/view` + `lang-html/css/javascript/json/markdown/xml`；**禁主题包、禁 lint/autocomplete 增强包**
- FileEditorDialog 组件整体异步加载（defineAsyncComponent），language 包按 ext 动态 import（html/css/js/json/md/xml 高亮，其余纯文本），云盘首屏 bundle 不携带编辑器代码
- 「编辑」入口显示条件：非目录 + 文本白名单 ext + size ≤1MB + v-permission `cloud:file:upload`；加载复用 preview 接口
- file.list 三态标签（R23）：isPublic 1→「公开」/ 2→「已阻断」/ 0→无标签；「设为公开/取消公开」按钮按 `isPublic === 1` 判断
```

### 【低】B3. §9 资产表「站点默认模板」行指向已删路径

该行仍写 `apps/api/assets/site-template`（已建 T36），T44 已 git mv 到 `site-templates/default/` 并删除旧目录——资产表指向幽灵路径，违反资产表"优先复用"的初衷。

**修复**：该行改为 `| 站点默认模板 | （已迁移至 site-templates/default，T44） | 见「站点模板库」行 | 已迁移 |` 或直接删行。

### 【低】B4. §4.8 速览错误码段未随 P4b 扩展

§4.8 末条"site 域 40101~~40112（表见 §14.11）"——现为 40101~~40116。

**修复**：改"40101~40116"。

### 【低】B5. API.md 两处残留

- §6.4 file.list 行尾"（代码随 T43 生效）"——T43 已完成，过渡注删除
- §7.4 末段"恢复链路对 pending write 按**.**params 重算"——错别字（"按."→"按 "）

### 【低】B6. D22 双写语义对比表并入时丢失

我增补 §15.4 的"AI 写入 vs 编辑器保存"对比表（fileId 变/不变、回滚能力、缓存处理、理由——**防后人误合并两种语义**）只剩文字结论散见 15.3/15.5。可选修复：把对比表补回 §15.4 末尾。

### 【观察 1】仓库根 README.md 严重过期（不在 P4b 验收范围，顺带发现）

根 README 仍写"P2b 设计完成待开发、P3/P4 规划中"，路线图未勾 P2b/P3/P4，目录结构缺 cloud/site，技术栈缺 CodeMirror，文档索引缺 P3~P4b 各 PRD。门面文档失真，建议列入 P4c 杂项或下次随手更新（内容可按 PROGRESS 当前状态行刷新）。

### 【观察 2·已闭环】模板 README.txt 已亲验（2026-08-30 补验）

用户补发 `assets/site-templates/default/README.txt`，逐字段亲验**通过**：七端点契约完整且字段级（site/columns/tags/articles/articles{id}/comments GET+POST），统一响应 `{code,message,data}` 与 code=0 ✓；错误码口径（40400 资源类统一 / 40001 / 42900 / 40111 评论间隔）与 §14.11 一致 ✓；目录语义（尾斜杠 / 301 / 无 index.html→404 无列表）与 §14.3 一致 ✓；三条纪律（相对路径禁 / 开头、CSP sandbox 说明、textContent + html:false 防 XSS）✓；bigint ID 字符串、ISO 时间、pageSize≤50、viewCount 去重说明、"已提交，审核后展示"固定文案、"AI 助手无法代写二进制"明文化 ✓。21 项关键串机械核对全命中。平台侧接口（编辑器 PUT、AI 工具三件套）正确地未混入——它们属 PLATFORM-GUIDE 分工，符合 D26。三套逐字一致的结论仍由 T44 抽查承载，无反证。

## 三、修复分工

B1~B6 全部纯文档，无代码改动、无需回归验收。可由 CodeBuddy 一次套完（约 10 分钟），或并入下阶段开工前置。观察 1 建议入 P4c 任务表。
