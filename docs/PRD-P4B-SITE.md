# PRD-P4B：个人网站·AI 编写站点 + 在线编辑器 + 模板库（site 域二期）

> 前置阅读：ARCHITECTURE.md（§14 已并入）+ API.md §6 + PRD-P4A-SITE.md + P4a-走查报告.md
> 编号延续：决策自 D19 起（P4a 用到 D18）；业务规则自 R16 起（P4a 用到 R15）；site 错误码自 40113 起（P4a 用到 40112）；cloud 错误码自 30012 起（P3 用到 30011）
> 开工前置：CodeBuddy 先按《P4a-走查报告.md》第二节套完 9 处文档补丁（W2 代码项除外，并入 T43）

---

## 0. 决策表（已批准，编号延续 P4a）

| #   | 决策                  | 结论                                                                                                                                                             | 理由                                                                                                                                                                                          |
| --- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D19 | P4b 范围              | **三项子能力全做**：AI 编写站点（工具三件套）+ 在线编辑器（CodeMirror 6）+ 模板库雏形（3 套预置）                                                                | 用户已批准                                                                                                                                                                                    |
| D20 | 新依赖                | **仅 CodeMirror 6 一组**（前端）：`codemirror` 元包 + `@codemirror/lang-html` / `lang-css` / `lang-javascript` / `lang-json` / `lang-markdown`，版本由 pnpm 锁定 | 用户已批准的唯一新依赖；后端零新依赖                                                                                                                                                          |
| D21 | AI 写入确认粒度       | **批量一次一卡**：`write_site_files` 单次最多 10 个文件，确认卡展示结构化文件清单（路径/动作/大小），不逐文件弹卡                                                | 一次建站涉及多文件，逐文件确认体验不可接受；批量又必须可审                                                                                                                                    |
| D22 | 写入语义双轨          | **AI 写入 = 软删旧版 + 新建**（回收站可回滚）；**编辑器保存 = 更新行**（同 P4a overwrite，fileId/URL 不变、内容立即生效、旧版不可回滚）                          | AI 批量高风险必须可回滚；站点访问是路径语义（/api/open/{slug}/app.js），软删+新建后同路径即时可访问；编辑器人在回路，更新行语义与覆盖上传一致且天然避开 site:path 缓存失效问题                |
| D23 | 模板应用语义          | **温和覆盖**：仅处理模板自带文件——同名软删（回收站回滚）+ 复制新版；站点内其他文件与 media/ 一律不动                                                             | 用户可能在模板外自建文件，全量清空不可接受                                                                                                                                                    |
| D24 | 错误码                | site 段续用 40113~~40116；cloud 段续用 30012~~30013；「标签不存在」维持 40400 备案（走查 W5），不新占码                                                          | 段纪律延续                                                                                                                                                                                    |
| D25 | 计费                  | 不新增结算逻辑；工具调用走 P2b 多轮合并计费（同一 assistant 消息累加 tokens 统一结算）                                                                           | 复用既有链路                                                                                                                                                                                  |
| D26 | AI 知识契约           | **README.txt 是 AI 读站点契约的唯一权威**（开放 API 七端点字段级契约 + 三条纪律），随模板分发；PLATFORM-GUIDE.md 只加 ≤120 字摘要（2000 字总上限约束不变）       | 契约完整版塞不进 system prompt；README 随站点走，人类与 AI 读同一份                                                                                                                           |
| D27 | file.list 的 isPublic | 走查 W2 修复：**返回原始三态 int（0/1/2）**，前端 1→「公开」、2→「已阻断」、0→无标签；T43 实施                                                                   | 三态下布尔丢信息（继承与阻断不可区分），且有"设公开→取消公开=意外阻断"行为陷阱                                                                                                                |
| D28 | 开放静态缓存头修订    | **全部开放静态资源改 `Cache-Control: no-cache`**（ETag/304 协商保留），修订 P4a §14.4 的"白名单 max-age=3600"                                                    | AI/编辑器高频迭代要求"改完立即可见"；max-age=3600 下 js/css 最长 1 小时旧版。no-cache+ETag 下未变资源仅 304 头部零字节体，个人站点量级成本可接受；未来正解是 CDN（§14.15 预留）而非加回强缓存 |

## 1. 背景

P4a 已交付编程型站点骨架：用户经云盘管文件、开放层（/api/open/{slug}/）静态托管 + 七端点数据 API。但当前站点内容只有两条路：手写 markdown 文章（后台表单），或用户在云盘里徒手改 HTML/CSS/JS（无编辑器、纯文本 textarea 都没有）。P4b 把"写站点"这件事本身做成产品能力，对齐用户愿景的三块：

1. **AI 编写站点**：对话里说"帮我把首页改成深色主题，加一个关于页"，AI 读站点现状 → 批量产出文件 → 用户一张确认卡审阅 → 生效。AI 必须能读懂站点契约（README.txt）才能写出能跑的代码。
2. **在线编辑器**：云盘里文本类文件可直接编辑保存，人在回路精修。
3. **模板库雏形**：默认博客之外再提供作品集、名片两套，建站/换肤一键应用，可回滚。

未来愿景（自建表/自建接口/功能分享市场）本期不做，但架构不堵路（见架构增补 §15.15）。

## 2. 范围

### 做

1. AI 工具三件套：`list_site_files`（read）/ `read_site_file`（read）/ `write_site_files`（write，确认卡）
2. 确认卡结构化文件清单（AiTool 增加 summarize 钩子 + ToolConfirmCard 渲染扩展）
3. 云盘在线编辑器：CodeMirror 6 + `PUT /api/cloud/file/:id/content` 保存接口
4. 模板库：`assets/site-templates/{default,portfolio,card}/` + 列表/应用接口 + 站点设置页入口
5. README.txt 升级为字段级 AI 契约（三套模板同步）；PLATFORM-GUIDE.md 加摘要
6. 走查 W2 代码修复（file.list 三态 int + 前端双标签）

### 不做

- AI 直接操作文章/栏目/标签/评论的工具（站点代码经开放 API 已能展示文章；AI 代发文章属内容运营场景，P4c 另议）
- **AI 生成/写入二进制资源**：工具与编辑器都只覆盖文本；图片等二进制资源仍需用户在云盘页手动上传（AI 需要图片时引导用户上传 media/，工具 description 明写）
- 模板预览图（template.json 预留 preview 字段，本期无图）
- 多版本历史（回收站即回滚，不做快照链）
- 编辑器移动端适配、协同编辑、diff 视图
- 用户自建表/自建接口/功能分享市场（未来愿景，仅预留）

## 3. 功能细则

### F1 AI 工具三件套（ai 域，`modules/ai/tool/tools/` 下三个文件 + bootstrap 注册）

| 工具   | name               | risk  | perms            | 说明                                                                                                                                                                                                                |
| ------ | ------------------ | ----- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 列文件 | `list_site_files`  | read  | site:site:manage | 返回我的站点文件树（管理侧语义，属主视角，**不做公开性判定**）：`{ site: { slug, title, status }, files: [{ path, isDir, size, updatedAt }], truncated }`；深度 ≤10、上限 500 条（超出 truncated=true）；不含回收站 |
| 读文件 | `read_site_file`   | read  | site:site:manage | 入参 `{ path }`；仅文本白名单扩展名（40114）、单文件 ≤64KB（40115）；返回 `{ path, size, content }`（UTF-8）                                                                                                        |
| 写文件 | `write_site_files` | write | site:site:manage | 入参 `{ files: [{ path, content }] }`，1~10 个；逐文件校验与写入，**部分成功语义**：返回 `[{ path, action: created\\                                                                                                | overwritten, size, ok, error? }]` 明细回喂模型汇报 |

门禁与失败语义：

- 未开通站点 → handler 回喂失败结果（40101 语义："用户尚未开通个人网站，请引导其到「个人网站 → 站点设置」创建"），模型转述，**不抛给访客**
- 无权限用户在工具过滤阶段即看不到三件套（P2b 既有机制），不存在越权路径；执行时二次校验（P2b 既有）
- 站点停用（status=0）**不影响**工具读写（停用只关开放层）

写文件逐文件流程（R18；站点语义校验在 SiteFacade，机械执行在 CloudFacade，错误码分段见架构 §15.3）：

1. 路径规范化：拒绝对路径 / `..` / 空段 / 反斜杠 → 40113；末段扩展名必须在文本白名单 → 40114；`Buffer.byteLength(content)` ≤256KB → 40115
2. 中间目录 **mkdir -p 语义**：逐段下行，已存在目录直接复用、不存在才创建（复用 R4 同名"(1)"与 R6 深度/数量上限）；**严禁无脑创建**——同路径二次写入若造出 "pages (1)" 平行目录，站点"路径即 URL"语义下即致命错误；中间段撞到同名文件/末段撞同名目录 → 该项失败记入明细（30001）
3. 同路径已存在未删文件 → **软删旧版**（deleted_at，进回收站，used 不动）
4. StorageService.writeFromBuffer + CloudFacade.registerPublicFile 登记新行（used += size，upsert 懒创建）
5. 全部完成后经 SiteFacade.invalidateSitePaths(siteId, paths) **精确失效** `site:path:{siteId}:{path}`（含可能存在的 "404" 负缓存）——AI 写完访客立即可见，不等 60s

### F2 确认卡结构化清单（write 工具确认体验扩展）

- AiTool 接口新增**可选** `summarize?: (params) => any`；write_site_files 返回 `[{ path, action, size }]`（action 预判：同路径存在 → overwritten，否则 created）
- tool_confirm 事件的 summary 字段：有 summarize 用其返回值（结构化），无则维持 P2b 现状（params 截断字符串）——**向后兼容，既有 7 个工具零改动**
- ToolConfirmCard：summary 为数组时渲染为文件清单小表格（路径 / 动作标签（新建=绿、覆盖=橙）/ 大小），字符串时维持现状
- 确认单 TTL 600s、先取后删一次性、并发流锁等 P2b 机制不变

### F3 在线编辑器（web，云盘页入口）

- 入口：「我的文件」列表操作列新增「编辑」按钮——仅当 `isDir=0` 且扩展名在文本白名单且 size ≤1MB 时显示；v-permission `cloud:file:upload`
- 组件 `views/cloud/components/FileEditorDialog.vue`：全屏 el-dialog + CodeMirror 6；按扩展名动态选 language（html/css/js(json)/md 有高亮，txt/svg/xml/yml/csv 纯文本）；**禁止**引 one-dark 等额外主题包（平台无暗色，用默认主题）
- 加载：复用 `GET /api/cloud/file/preview/:id` 流式取文本（可编辑文件 ≤1MB < preview 的 2MB 上限，无冲突）
- 保存：按钮 + Ctrl/Cmd+S → F4 接口；保存中原地 loading
- 脏检查：内容变更未保存时关闭弹窗 → ElMessageBox 二次确认
- CodeMirror 按需 import（动态 import language 包），不阻塞云盘页首屏

### F4 编辑器保存接口（cloud 域）

`PUT /api/cloud/file/:id/content`，权限 `cloud:file:upload`（与覆盖上传同语义，不新增权限标识、不动 seed），挂 @OperationLog：

1. assertOwned（30001）+ 非目录（40001）
2. 扩展名文本白名单 → 否则 30012；`Buffer.byteLength(content)` ≤1MB → 否则 30013
3. **更新行语义**（D22）：writeFromBuffer 写新物理文件 → 更新行（storage_name/size/update_time，mime 按白名单表重解析）→ used 差额记账（GREATEST 兜底，同 R5）→ 删旧物理文件
4. fileId/URL 不变 → site:path 缓存的 fileId 仍有效，开放层**立即生效**（ETag 随 size/mtime 变化自然失效），无需跨域失效

实现提示：行更新逻辑与 transfer 的 overwriteExisting 同源，应抽公共方法复用，禁止复制粘贴。

### F5 模板库（site 域新子模块 `modules/site/template/`）

- 资产目录迁移：`apps/api/assets/site-template/`（P4a 单数目录）→ `apps/api/assets/site-templates/default/`；新增 `portfolio/`（作品集：单页 + 作品网格 + 关于区）、`card/`（名片站：极简单页 + 社交链接 + 精简文章列表）；每套含 `index.html / style.css / app.js / README.txt` 四件套 + `template.json`（`{ "name", "description", "version", "preview?" }`）
- 模板纪律（与 P4a 默认模板相同）：只用相对路径 `./api/*` 调开放 API；允许 CDN；用户内容一律 textContent 注入；markdown-it CDN 时 html:false
- `GET /api/site/templates`（site:site:manage）：读目录 + template.json → `[{ id, name, description }]`（id=目录名）
- `POST /api/site/mine/apply-template` `{ templateId }`（site:site:manage，@OperationLog）：站点不存在 40101；模板不存在 40116；按 D23 温和覆盖——遍历模板文件（不含 template.json），同路径软删 + writeFromBuffer + registerPublicFile；**media/ 与模板外文件不动**；完成后 invalidateSitePaths 精确失效；返回应用的文件清单
- 建站流程（manage.create）模板源改读 `site-templates/default/`；迁移完成后删除旧 `site-template/` 目录（注意：已建站用户的站点文件早已复制进各自云盘，不受影响）
- 前端：站点设置页加「模板库」卡片——三套模板单选 + 描述 + 「应用模板」按钮（二次确认：提示"同名文件将被覆盖，旧版可在回收站还原"），应用成功提示文件数

### F6 README 契约升级 + PLATFORM-GUIDE 摘要（D26）

- 三套模板的 README.txt 统一升级为**字段级契约**（人类与 AI 同读）：站点 URL 与目录语义（含尾斜杠/index.html 规则）、开放 API 七端点逐字段契约（以 `./api/...` 相对路径视角书写）、三条纪律（fetch 用相对路径；CSP sandbox 下无 localStorage/凭证，alert/confirm 可用；用户内容必须 textContent 注入）
- README 维护纪律（R22）：**开放 API 变更必须同 PR 同步 README**，与 PLATFORM-GUIDE 同级
- PLATFORM-GUIDE.md 的「个人网站」章节追加摘要（≤120 字）："用户可能拥有个人站点（/api/open/{slug}/）。AI 可用 list_site_files / read_site_file / write_site_files 帮用户查看与改写站点文件；动手前先 read_site_file('README.txt') 获取开放 API 契约；write_site_files 为 write 工具需用户确认。"
- 工具 description 写明："改写站点前先 read_site_file('README.txt') 了解开放 API；若文件不存在，按 PLATFORM-GUIDE 摘要保守操作"（兼容 P4a 老站点的旧版 README）

## 4. 业务规则（延续编号）

| #   | 规则                                                                                                                                                                                                                                          |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R16 | 工具门禁：三件套 perms = `site:site:manage`；未开通站点回喂引导文案（40101 语义）；站点停用不阻断工具；权限过滤 + 执行二次校验沿用 P2b                                                                                                        |
| R17 | 路径与内容约束：path 为站点根相对路径，规范化拒绝绝对路径/`..`/空段/反斜杠（40113）；扩展名限文本白名单 `html/htm/css/js/mjs/txt/md/json/svg/xml/yml/yaml/csv`（40114）；AI 写单文件 ≤256KB、单次 ≤10 个（40115）；目录深度 ≤10（复用 30006） |
| R18 | AI 写入语义：同路径软删旧版（回收站可回滚）+ 新建登记；used 软删不动、新建 +size；中间目录自动创建（0=继承公开）；写完精确失效 site:path 缓存；逐文件独立成败，返回明细（部分成功不整体回滚）                                                 |
| R19 | 编辑器保存语义：更新行（fileId/URL 不变）+ used 差额 + 旧物理文件删除不可回滚；白名单 30012、>1MB 30013；开放层立即生效                                                                                                                       |
| R20 | 模板应用语义：仅覆盖模板自带文件的同名项（软删回滚），media/ 与模板外文件不动；精确失效 site:path；挂操作日志                                                                                                                                 |
| R21 | 确认卡：批量文件清单结构化展示（路径/动作/大小）；确认单一次性、600s 过期不变；取消 = 不落任何文件                                                                                                                                            |
| R22 | README.txt 是站点开放 API 的 AI 契约权威；开放 API 任何变更必须同步三套模板的 README（验收检查项）                                                                                                                                            |
| R23 | file.list 的 isPublic 返回原始三态 int（0=继承/1=显式公开/2=显式阻断）；前端 1→「公开」、2→「已阻断」、0→无标签；有效公开性只在开放层访问时上溯判定，列表不逐行算链（走查 W2）                                                                |

## 5. 错误码

### site 段（续 40113~40116）

| code  | 含义                                                     | 处理                        |
| ----- | -------------------------------------------------------- | --------------------------- |
| 40113 | 站点文件路径非法（越出站点根 / 含 .. 或绝对路径 / 空段） | 工具回喂，模型修正路径      |
| 40114 | 文件类型不允许（非文本白名单扩展名）                     | 工具回喂 / 编辑器按钮不显示 |
| 40115 | 内容超限（AI 写单文件 >256KB / 单次 >10 个 / 读 >64KB）  | 工具回喂，模型拆分或精简    |
| 40116 | 模板不存在                                               | 刷新模板列表                |

### cloud 段（续 30012~30013）

| code  | 含义                                     | 处理               |
| ----- | ---------------------------------------- | ------------------ |
| 30012 | 该文件类型不支持在线编辑（非文本白名单） | 提示"请下载后编辑" |
| 30013 | 内容超出在线编辑上限（1MB）              | 提示"请下载后编辑" |

> 备案（走查 W5）：标签不存在维持通用 40400，不占新码。

## 6. 验收标准（T45 联调逐条实测）

1. **无站点引导**：未开通用户在 AI 对话要求改站点 → 工具回喂引导，模型回复引导去站点设置，无报错栈
2. **AI 建站全链路**：已开通用户发"把首页改成深色主题并加一个关于页"→ AI 先 read README/现有文件（工具标签可见，读取类并行一轮发出）→ write_site_files 弹**一张**确认卡（文件清单含路径/新建或覆盖动作/大小，标注"动作为预估"）→ 确认后访客地址立即可见新内容——**含 js/css**（D28 缓存头修订后不再受 max-age=3600 影响；site:path 精确失效 + 浏览器强刷一次验证）
3. **覆盖回滚**：AI 覆盖 index.html 后，回收站可见旧版；还原旧版并删除新版后，站点恢复（路径语义，无需其他操作）
4. **越界防护**：path 含 `../`、绝对路径 → 40113；写 `app.exe` → 40114；单文件 >256KB / 一次 11 个文件 → 40115；均回喂模型且不落盘（实测方式：构造参数直调工具 handler 冒烟，不经真实模型——模型输出长度天然到不了 256KB）；**写 `pages/about.html` 两次，不产出 "pages (1)" 平行目录**
5. **部分成功**：构造配额不足场景（剩余空间小于批量总大小），部分文件失败 → 返回明细，模型正确汇报哪些成功哪些失败；失败文件无残留行
6. **取消确认**：确认卡点取消 → 零文件落盘、零软删，模型被告知用户已取消
7. **编辑器链路**：云盘页 app.js 显示「编辑」→ 弹窗代码高亮 → 修改保存 → 开放层刷新立即新内容（fileId 不变）；未保存关闭有脏检查确认
8. **编辑器约束**：exe/图片无「编辑」按钮；>1MB 文本保存 → 30013；保存接口写 sys_operation_log
9. **模板应用**：应用 portfolio → 站点四件套被替换（回收站可见旧四件套），media/ 与自建的其他文件原样；再应用 card 可继续切换；站点立即生效
10. **README 契约**：三套模板各自建站/应用后，read_site_file('README.txt') 内容含七端点字段级契约且与 API.md §6.3 一致
11. **三态标签（W2）**：file.list 返回 0/1/2；云盘页显式公开项显「公开」、阻断项显「已阻断」、继承项无标签；"设为公开→取消公开"后该文件在公开目录下 404 且界面可见「已阻断」（行为陷阱可视）
12. **权限**：无 site:site:manage 的角色的用户，工具过滤后模型看不到三件套；无 cloud:file:upload 不显示「编辑」按钮，直调保存接口 40300

## 7. PROGRESS 片段（直接替换「进行中」区并追加任务表行）

```markdown
## 进行中

P4b 个人网站·AI 编写站点 + 在线编辑器 + 模板库（T41~T45）

| 任务 | 内容                                                                                                                                                                                                                                                                                                                                                                                                       | 状态   | 完成日期 |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------- |
| T41  | AI 站点工具三件套（list_site_files / read_site_file / write_site_files）+ SiteFacade 扩展（getMySiteInfo / invalidateSitePaths / listFiles / readFile / writeFiles——站点语义校验层）+ CloudFacade 机械原语（listSubtreeRaw / readFileRaw / writeFileRaw，含 mkdir -p 逐段复用）+ 错误码 40113~40116 + 开放静态 Cache-Control 改 no-cache（D28）+ README 契约升级（先落 default 模板）+ PLATFORM-GUIDE 摘要 | 未开始 |          |
| T42  | AiTool summarize 钩子 + ToolConfirmCard 结构化文件清单 + AI 建站全链路联调（含部分成功/取消/越界回喂）                                                                                                                                                                                                                                                                                                     | 未开始 |          |
| T43  | CodeMirror 6 编辑器（FileEditorDialog + 云盘页「编辑」入口）+ PUT /api/cloud/file/:id/content（30012/30013，更新行语义）+ 走查 W2 修复（file.list 三态 int + 前端双标签）                                                                                                                                                                                                                                  | 未开始 |          |
| T44  | 模板库：assets/site-templates/{default,portfolio,card}/ 迁移与新增 + template.json + GET /api/site/templates + POST /api/site/mine/apply-template（40116，温和覆盖）+ 站点设置页模板库卡片                                                                                                                                                                                                                 | 未开始 |          |
| T45  | 联调验收（对照 PRD-P4B 第 6 节 12 条）+ 文档回写（ARCHITECTURE 并入 §15 并删指针行 / API.md §7 并入 / 资产表 / PLATFORM-GUIDE / PROGRESS）                                                                                                                                                                                                                                                                 | 未开始 |          |
```

## 8. 遗留（登记，不阻塞）

1. AI 操作文章/栏目/标签/评论的工具（P4c 候选，需先定"AI 代发内容"的产品语义）
2. 模板预览图（template.json.preview 字段预留，本期列表纯文字）
3. 编辑器无 diff 视图（覆盖前不可对比新旧内容；回收站兜底）
4. 多版本历史 / 用户自建表 / 自建接口 / 功能分享市场：未来愿景，架构预留见 §15.15
5. P4a 遗留继续有效：内容审核引擎、用户删站功能、u2 浏览器全流程手工复核、nest build safe-delete 环境拦截
