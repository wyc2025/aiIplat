# iplat —— P4e 走查报告（Kimi 走查，2026-09-13）

**走查对象**：PROGRESS.md（T59~~T65 + 遗留 14~~17）、ARCHITECTURE.md（§18 并入）、API.md（§10 并入），对照 PRD-P4E-SITE.md / ARCHITECTURE-P4E-增补.md / API-P4E-增补.md。

**总体结论：通过（功能与实现），4 个文档补丁（W1~W4，均为低危纯文档）。** 两项实现偏差均处置正确、登记完整、文档已按实际编号回写；浏览器实测覆盖面超过 P4d。

---

## 一、重点通过项（抽查实证）

1. **任务完成度**：T59~~T65 全部完成，完成记录（PROGRESS 1049~~1067 行）逐项有证据链。
2. **验收覆盖**：接口冒烟含配额全生命周期（调 3 → 建站 → 重复 slug 40102 → 保留字 40103 → 配额满 40118 带 2/2 → 调低 40001）、删站级联（slug 立即再注册、回收站现根目录、**两个站点根直删均 30020**——多根语义实测命中）、AI 11 工具脚本化实测（单站直通/多站 needSitePick/slug 精确命中）、脱敏落库实测（`sid=leak123 → sid=***`）。
3. **浏览器实测（Playwright）**：配额 UI（满禁用/提额解禁）、UI 建站、切换器跟随与刷新持久化、删站 R50 三段确认文案、当前站自动回退、单站无感（切换器消失）、admin 配额按钮权限（common 不可经角色数据验证）。测试数据全部清理、admin 配额复位 1。
4. **两处偏差处置（示范级）**：均非实施方责任，且处理方式正确——① 详情路径改 `/api/site/detail/:id`（遗留 14）；② 错误码顺延 40118/40119（遗留 15）。两处都在 PROGRESS 遗留区、ARCHITECTURE §18、API §10.1 三处同步说明，且 API §10.1 头部加了「PRD 名义编号 vs 实际编号」对照注。
5. **T64 顺带纠正了一个文档老偏差**：winston 从未真正接入（运行日志走 Nest Logger），脱敏落在了真实落点（GlobalExceptionFilter + OperationLog 落库 url/params），并补了 deploy/nginx.conf log_format 与 README 口径。
6. **资产表/配置登记齐全**：SiteQuotaService、CloudFacade.removeSiteRoot、resolveSiteForTool、useSiteStore、SiteSwitcher、maskSensitiveQuery 六行全部入表；§5 库设计头注与 site_ 域六表段已同步 P4e 变更。

## 二、偏差性质说明（根源在我的规格，实施方处理正确）

- **40117 被占用**：我在 P4e 文档头写「40xxx 用到 40116」，但 P4c 实施时已把 40117 用于 `CloudListingDisabled`（文件夹未开放列表，API.md 446/470 行在案）。我出 P4e 编号前没有复核最新错误码表——**检查前置纪律我自己没执行**。顺延 40118/40119 是唯一正确解，前端硬编码不受影响。
- **`GET /api/site/:id` 路由冲突**：`/api/site/` 下单段已有 article/comment/templates 静态路由，`:id` 参数段会抢先匹配（ParseIntPipe 对 "article" 直接 400），且跨模块注册顺序不可控。这是我规格时没预判的冲突，`/detail/:id` 是合理最小修复。遗留 14 的建议（远期把站点 CRUD 收敛到 `/api/site/manage/*` 命名空间）记入演进预留即可，本期不动。

## 三、发现（4 低 + 2 观察）

### 【低】W1. API.md §6.2 旧 mine 端点未随 D52 清除

§10.1 已声明废弃且代码已删除，但 §6.2 原表 315~317 行（GET/POST/PUT mine）、348 行（mediaFolderId「取自 GET /api/site/mine」）、417 行（/mine/apply-template）原样保留——同一文档两处矛盾。

**补丁**：删 §6.2 mine 三行，该行段首注「站点 CRUD 自 P4e 迁至 §10.2」；348 行来源改「站点详情（§10.2 GET /api/site/detail/:id）」；417 行删除（新路径已入 §10.3 apply-template 行）。

### 【低】W2. ARCHITECTURE 四处 mine 路径注释残留

935 行（manage 目录注释）、936 行（template 目录注释）、1090 行（§15.7 template.controller 注释）、1177 行（§15.7 流程描述端点）仍写 mine 路径。

**补丁**：935 改「站点 CRUD（§10.2 集合端点）」；936/1090 的 apply-template 路径改 `/api/site/:id/apply-template`；1177 行端点路径同步替换（流程描述本身不变）。

### 【低】W3. 三张错误码总表未收录新码

- ARCHITECTURE §4.7 30xxx 表止于 30019，缺 **30020**（§18.7 有、总表无）；
- ARCHITECTURE §14.11 表止于 40116，缺 **40118/40119**；同章 368 行「site 域 40101~40116」范围表述未更新；
- API.md 错误码总表（394 行「site 段（续 40113~40116）」段）同样缺 40118/40119，且 30xxx 段缺 30020。

**补丁**：三处总表补行 + 368 行改「40101~40119（40117 为 P4c 开放层码，见 §16.2）」+ API.md 段标题续接范围同步。注意沿用「实际编号」口径并保留顺延注。

### 【低】W4. §1 技术表 winston 行失实（T64 暴露的老偏差）

41 行「日志：winston（运行日志）+ 操作日志落库」——实际 winston 依赖在库但零使用，运行日志走 Nest Logger。

**补丁**：改为「Nest Logger（console，运行日志）+ 操作日志落库；winston 依赖在库未接入，接入时 URL 字段统一过 maskSensitiveQuery（§18.6）」。

### 【观察 1】create_site 工具层端到端执行无实证记录

脚本实测覆盖了注册（11 工具）、resolveSite 各分支、summarize 携带站点标识；底层创建链（POST /api/site）已全量手动实测。唯独「确认卡确认 → handler → manage.create → 站点真实落库」这段工具层 wiring 没有明确实测记录（风险低，create_site 是纯委托）。**建议你在 AI 对话里真实建一次站**（配额先调 2），顺手验证多站追问体验。

### 【观察 2】遗留 17 环境经验有长期价值

「tsx 直接跑 Nest 不可行（esbuild 不出 design:paramtypes 元数据），脚本化验证须针对 dist 产物写普通 JS」——这条建议摘录进交接文档/PLATFORM-GUIDE 之外的开发者注意事项，后续各期脚本化冒烟都会用到。不强制，CodeBuddy 顺手即可。

## 四、修复分工

- **CodeBuddy（4 个纯文档补丁 W1~W4，无代码改动、无回归）**：补丁内容见上三节，均为删行/改注/补表行级别。完成后 PROGRESS 末尾照旧追加一行补丁回执（照 W1~~W4 / B1~~B6 先例格式）。
- **你（用户）**：① AI 对话真实建站一次（观察 1）；② 站点列表/切换器真机手感已过 Playwright，可抽查；③ P0（admin 密码 + JWT 密钥）继续挂账，正式上线前我会提醒。
- **我**：盘点文档状态更新；P4e 增补三份文档保留为历史细节参考（照惯例不删）。

## 五、下一步

PROGRESS 已标注「下一阶段未定（PRD 路线图剩余：P5 个人网站进阶 / P6 自定义域名等）」。盘点文档 §4 待立项清单仍有：内容审核引擎、AI 云盘工具、AI 定时任务、真实支付、RAG、分片上传/秒传/缩略图、回收站自动清理。你可以直接说方向，我来做需求分析与立项。

---

## 六、复查（2026-09-13 第二轮：事后调整 + W1~W4 复核）

### 6.1 三项事后调整——核验通过

1. **站点 CRUD 收敛 `/api/site/manage/*`**：API §10.2 / ARCHITECTURE §18.2 已改写到位（含「为什么不用顶层 :id」的说明、apply-template 收编、双控制器拆分流避免 `SiteManageModule→SiteTemplateModule→SiteFacadeModule` 循环——域纪律保持住了）；HTTP 实测旧路径全 40400、新路径全通、静态端点不受影响；浏览器复测建站/编辑/删站全链路。templates 列表留顶层（平台级资源）的取舍正确。全仓残留检查：旧路径仅在「为什么不用」的说明性文字中出现（有意保留），无契约性残留。
2. **错误码保持现状 + 文档对齐**：用户拍板后 PRD-P4E 的 §4/R47/R56/R57/验收 1/7 已全部改为实际编号（我侧 output 副本已同步对齐）。
3. **admin 自身配额按钮修复**：根因定位准确（`v-if="row.username !== 'admin'"` 是从云盘配额按钮抄来的守卫），修复最小（只去 v-if 保留 v-permission），复现→修复→复位证据完整。云盘配额按钮同款守卫未动——**建议同样放开**（admin 自调云盘配额是同性质诉求，一行改动，可搭 W1~W4 的车）。

### 6.2 补测核验——验收缺口全部关闭

开放层多站独立（两站互不串、删站后 40400 与「从未存在」逐字一致不泄漏存在性）、R37 移动保护（30019 双目标实测）、**R54 回收站还原实测**（还原后 isDir=1/isPublic=1/inSite=false/isSiteRoot=false，精确命中规则原文）。至此 11 条验收全部有实证。

### 6.3 W1~W4 未套用——补丁目标需随命名空间调整更新

本轮文件未包含 W1~W4（ CodeBuddy 优先做了功能调整）。补丁仍然有效，但 W1/W2 的目标文案要按 manage 命名空间最终态写：

- **W1（API.md §6.2）**：删 mine 三行（315~317）+ 348 行 mediaFolderId 来源改「站点详情（§10.2 `GET /api/site/manage/:id`）」+ 417 行删除（现行路径 §10.2 `POST /api/site/manage/:id/apply-template`）；§6.2 段首注「站点 CRUD 自 P4e 迁至 §10.2（`/api/site/manage/*`）」
- **W2（ARCHITECTURE）**：936 行 manage 目录注释改「站点 CRUD（§10.2，`/api/site/manage/*`）」；937/1091/1178 行 apply-template 路径改 `/api/site/manage/:id/apply-template`
- **W3（三处错误码总表）**：ARCHITECTURE §4.7 补 30020、§14.11 补 40118/40119 + 368 行范围改「40101~40119（40117 为 P4c 开放层码）」、API.md 总表补 40118/40119/30020——**均未做，原样有效**
- **W4（§1 winston 行）**：未做，原样有效

### 6.4 新观察

- **观察 3（头像修复的遗留线索）**：遗留 18 的 A/B 实测暴露了一个结构性事实——`parent_id=-1` 的头像行永远过不了 pub 祖先链判定（「能建链、永远打不开」的静默失败）。本次用 Blob 方案绕过是对的，但建议把「assertOwned 不校验 parentId 导致孤儿行可建公开链」记为 pub 机制的已知边界，将来若头像要走公开 URL 需先改判定链。已在 PROGRESS 详细登记，无需动作。
- **观察 1 滚动**：create_site 工具层端到端（确认卡→真实建站）仍无实证，补测未覆盖；建议不变——AI 对话里真实建一次站。

### 6.5 结论更新

**P4e 走查通过**（功能、实现、测试、三项事后调整全部核验）；待办 = W1~W4 纯文档补丁（W1/W2 按 6.3 更新后的目标执行）+ 可选的云盘配额按钮同款守卫放开。
