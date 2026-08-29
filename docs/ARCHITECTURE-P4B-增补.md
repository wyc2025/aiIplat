# iplat —— 架构文档 P4b 增补：AI 编写站点 + 在线编辑器 + 模板库

> 本文档是 ARCHITECTURE.md 的 P4b 增补，既定铁律（域边界、统一响应、gateway 层、资产复用）全部沿用。
> **并入机制（同 P4a 先例）**：CodeBuddy 开工前在 ARCHITECTURE.md 开头（标题行之后）插入指针行——
> `> ⚠️ 进行中阶段：P4b。本文件尚未包含 P4b 内容，须与 ARCHITECTURE-P4B-增补.md 同读（T45 并入后删除本行）。`
> T45 验收后把本文档 §15 并入 ARCHITECTURE.md、删除指针行、本文档头部标注"已并入，保留为历史细节参考"。
> P4b 关键前提：P4a 全部机制（三态 is_public / 开放层 / 缓存体系）不动；唯一新依赖 = 前端 CodeMirror 6（D20，已批准）。

## 15. 个人网站二期（P4b）

### 15.1 目录结构变更

```
api/src/modules/site/
└── template/                  # 本期新增：模板库子模块
    ├── template.controller.ts # GET /api/site/templates、POST /api/site/mine/apply-template
    ├── template.service.ts    # 模板清单读取 + 温和覆盖应用（写入经 SiteFacade.writeFiles，失效经 SiteFacade.invalidateSitePaths）
    └── template.module.ts     # imports SiteModule 内的 facade 即可（同域直注）；不直接碰 StorageService

api/src/modules/ai/tool/tools/ # 本期新增三个工具文件（P2b 框架原位扩展）
├── list-site-files.tool.ts
├── read-site-file.tool.ts
└── write-site-files.tool.ts
# tool.bootstrap.ts 注册；ToolModule 补 import SiteModule（**工具只注入 SiteFacade 一个门面**，零跨域 import 内部实现）

apps/api/assets/
└── site-templates/            # 自 P4a 的 site-template/（单数）迁移而来
    ├── default/               # 原默认博客四件套 + template.json
    ├── portfolio/             # 作品集
    └── card/                  # 名片站

web/src/views/cloud/components/
└── FileEditorDialog.vue       # 本期新增：CodeMirror 6 全屏编辑弹窗（云盘页「编辑」入口）
```

### 15.2 AI 工具契约（三件套）

| 工具               | risk  | perms            | parameters（JSON Schema 要点）                               | handler 返回                                                                                       |
| ------------------ | ----- | ---------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `list_site_files`  | read  | site:site:manage | `{}`（无参数，固定列整树）                                   | `{ site: { slug, title, status }, files: [{ path, isDir, size, updatedAt }], truncated: boolean }` |
| `read_site_file`   | read  | site:site:manage | `{ path: string }`（必填）                                   | `{ path, size, content }`（UTF-8）                                                                 |
| `write_site_files` | write | site:site:manage | `{ files: [{ path, content }] }`（minItems 1 / maxItems 10） | `[{ path, action: "created"\\                                                                      | "overwritten", size, ok, error? }]`（部分成功语义） |

- **description 纪律**（决定模型选对工具，措辞即契约）：三个工具的 description 都须写明"操作的是**当前用户自己的个人站点文件**（站点根 = 云盘「我的站点」目录）；改写前建议先 read_site_file('README.txt') 获取开放 API 契约"；write_site_files 额外写明"同路径已存在文件会被覆盖（旧版进回收站可还原）；本工具需用户确认后才会执行；**只能写文本文件，图片等二进制资源写不了——需要图片时引导用户在云盘页手动上传到 media/**"
- **轮次预算适配**（MAX_TOOL_ROUNDS=3 不变，P2b 既有常量）：建站链路刚好 3 轮——list（第 1 轮）→ 多个 read **并行**（第 2 轮，一个 response 可带多个 tool_calls）→ write（第 3 轮）。description 里引导模型"读取类调用尽量并行、一轮发出"；需写 >10 个文件时模型应分批 write（每批一张确认卡），不要试图一轮塞完
- **未开通站点**：SiteFacade.getMySiteInfo 返回 null → handler 返回失败结果 `{ ok: false, errorCode: 40101, message: "用户尚未开通个人网站，请引导其到「个人网站 → 站点设置」创建" }`（回喂模型转述，不抛出）
- **管理侧语义**：三件套是属主视角，**不经 resolvePublicPath、不做公开性判定**（区别于开放层）；路径解析走 CloudFacade 新增的管理侧方法
- 常量在工具文件内定义并写入 schema description：`SITE_FILE_TEXT_EXTS`（白名单）、AI 写单文件 256KB / 单次 10 个 / 读 64KB

### 15.3 域门面扩展（跨域唯一通道）

**分层纪律（错误码分段归位）**：站点语义校验（路径规范 / 文本白名单 / 大小与数量上限）全部收敛在 **SiteFacade**，抛 site 段码（40113~40115 / 40400）；**CloudFacade 只做机械原语**（树遍历 / 读盘 / 行写入），假设调用方已校验，仅抛 cloud 段自有码（30001 不存在 / 30003 配额 / 30006 深度与数量）。禁止 cloud 域代码抛 site 段码（分段纪律同 §4.3 错误码表）。ai 域工具因此**只需注入 SiteFacade**；site 域内 template 模块直接同域注入 SiteFacade。

**SiteFacade 新增**（site 域 exports，供 ai 工具与同域 template 模块）：

```ts
getMySiteInfo(userId: number): Promise<{ id: number; slug: string; title: string; status: number; rootFolderId: bigint } | null>

invalidateSitePaths(siteId: number, paths: string[]): Promise<void>
// 对每个 path DEL `site:path:{siteId}:{path}`（含 "404" 负缓存）；site 域自持 key，cloud/ai 域不可见

listFiles(userId: number): Promise<{ site: {...}; files: { path, isDir, size, updatedAt }[]; truncated: boolean } | null>
// 内含 getMySiteInfo → CloudFacade.listSubtreeRaw；null = 未开通（工具回喂 40101 引导）

readFile(userId: number, path: string): Promise<{ path, size, content }>
// 校验（路径 40113 / 白名单 40114 / ≤64KB 40115 / 不存在 40400）→ CloudFacade.readFileRaw

writeFiles(userId: number, files: { path: string; content: string }[]):
  Promise<{ path: string; action: "created" | "overwritten"; size: number; ok: boolean; error?: string }[]>
// 逐文件：校验（40113/40114/40115）→ CloudFacade.writeFileRaw（30003/30006 等 cloud 码捕获为该文件 error）→
// 部分成功语义，单文件失败不影响其余 → 全部完成后 invalidateSitePaths（仅 ok 的路径）
```

**CloudFacade 新增机械原语**（cloud 域 exports，管理侧语义——属主操作，不做公开性判定、不做站点语义校验）：

```ts
listSubtreeRaw(rootFolderId: bigint, opts?: { maxDepth?: number; limit?: number }):
  Promise<{ files: { path: string; isDir: boolean; size: number; updatedAt: Date }[]; truncated: boolean }>
// 自 rootFolderId 有界下行（默认 maxDepth 10 / limit 500，超限 truncated=true）；不含回收站；path 为相对站点根的 '/' 连接路径

readFileRaw(rootFolderId: bigint, path: string): Promise<{ size: number; content: Buffer }>
// 逐段下行解析（有界 ≤10）；不存在 30001；是目录 30001；读盘返回 Buffer（解码由调用方负责）

writeFileRaw(userId: number, rootFolderId: bigint, path: string, content: Buffer):
  Promise<{ action: "created" | "overwritten"; size: number }>
// 中间目录：**mkdir -p 语义——逐段下行，已存在目录直接复用，不存在才经 createFolder 创建**（R4 同名"(1)"仅在撞名时兜底；
// 严禁每段无脑 createFolder，否则同路径二次写入会造出 "pages (1)" 平行目录，站点路径即 URL 下这是致命错误）
// 中间段撞到同名**文件**、或目标末段撞到同名**目录** → 抛 30001（无法下穿/无法以文件覆盖目录）；
// SiteFacade 捕获后记为该文件的 per-file error 回喂（站点语义校验只管路径字符串形态，物理冲突以 cloud 侧实际探测为准）
// 同路径未删文件 → 软删（回收站，used 不动）→ StorageService.writeFromBuffer → registerPublicFile（used += size，upsert）
// 配额：used + size > quota → 30003
```

纪律：ai 域工具 handler 只允许注入 SiteFacade（§12.3 门面约定延伸）；site/template 模块写云盘只经 SiteFacade.writeFiles（间接走 CloudFacade），不直接注入 CloudFacade。

### 15.4 缓存失效口径（P4a 缓存体系的本期补充）

| 写入路径                       | 涉及缓存              | 失效方式                                                                                |
| ------------------------------ | --------------------- | --------------------------------------------------------------------------------------- |
| write_site_files（AI）         | site:path（含负缓存） | 写完经 SiteFacade.invalidateSitePaths 精确 DEL 每个 ok 的 path                          |
| apply-template                 | site:path             | 同上（被覆盖的模板路径）                                                                |
| PUT file/:id/content（编辑器） | 无需失效              | 更新行语义 fileId 不变，site:path 缓存的 fileId 仍有效；ETag 随 size/mtime 变化自然失效 |
| 站点数据（文章等）             | site:data             | P4a 既有 scanDel 不变                                                                   |

**⚠️ 对 P4a 的修订（D28）：开放静态 Cache-Control 收紧为 no-cache**

§14.4 步骤 6 的「白名单 public max-age=3600」在 P4b 场景下不成立：AI 改了 app.js/style.css 后，访客浏览器缓存最长 1 小时仍用旧版，"AI 写完立即可见"（验收第 2 条）必然失败。本期修订为：

- **全部开放静态资源：`Cache-Control: no-cache`**（html 原本就是 no-cache，不变；js/css/图片/字体等白名单由 max-age=3600 改为 no-cache）
- ETag（W/"size-mtime"）/304 协商**保留**——内容未变时响应仅 304 头部（零字节体、不走流式），成本极低；内容变了立即 200 新版
- 性能权衡：每个静态请求多一次回源协商 RTT，个人站点量级可接受；限流口径不变（static 桶 120 次/分/IP）；未来流量上来后的正解是 §14.15 预留的 CDN / X-Accel-Redirect，而非把缓存加回来
- 实现位置：open/mime.ts 或 open-static.controller 的响应头常量，一处改动全局生效（响应头由服务端动态输出，已生成站点零改动）

**双写语义对比**（D22 的架构理由，防后续误合并）：

|                   | AI 写入（SiteFacade.writeFiles）              | 编辑器保存（content 接口）   |
| ----------------- | --------------------------------------------- | ---------------------------- |
| 行语义            | 软删旧版 + 新建行                             | 更新原行                     |
| fileId / 公开 URL | 变 / 不变（路径语义）                         | 不变 / 不变                  |
| 回滚              | 回收站还原旧版                                | 不可回滚（同 P4a overwrite） |
| site:path 缓存    | 必须精确失效                                  | 无需处理                     |
| used              | 软删不动 + 新建 +size（旧版占配额至彻底删除） | 差额记账（GREATEST 兜底）    |
| 理由              | AI 批量高风险，必须可回滚                     | 人在回路，与覆盖上传一致     |

### 15.5 编辑器保存接口（cloud 域，transfer 之外的新端点）

`PUT /api/cloud/file/:id/content`，`@RequirePermission('cloud:file:upload')` + `@OperationLog('云盘', '在线编辑保存')`：

1. assertOwned（30001）→ isDir=1 拒绝（40001）
2. ext ∈ 文本白名单 → 否则 30012；`Buffer.byteLength(content)` ≤ 1MB → 否则 30013
3. StorageService.writeFromBuffer 写新物理文件 → 更新行——**仅更新 `storage_name` / `size` / `update_time` 三列**（编辑不改文件名与扩展名，`mime`/`ext`/`is_public` 等其余字段一律不动）→ used 差额记账（`GREATEST(used+delta,0)`，复用 R5 口径）→ 删旧物理文件
4. **行更新逻辑必须抽公共方法**（FileService 层，如 `replaceFileContent(file, buffer)`），transfer 的 overwriteExisting 改为调用它——禁止复制粘贴；抽离后 overwrite 上传与在线保存共用同一实现

DTO：`{ content: string }`（@IsString + @MaxLength(1_048_576) 字符级粗拦，字节级在 service 精算）。

### 15.6 确认卡结构化清单扩展

```ts
export interface AiTool {
  // ……既有字段不变，新增可选：
  summarize?: (params: any) => any // write 工具确认卡摘要；缺省维持 P2b（params 截断字符串）
}
```

- chat.service 写确认单时：工具有 summarize 则 `summary = tool.summarize(params)`（JSON 序列化进确认单与 ai_tool_call），无则维持现状——**既有 7 工具零改动**
- write_site_files 的 summarize：逐路径预判 action（查存在性，只读不写）→ `[{ path, action, size }]`
- ToolConfirmCard.vue：summary 为数组 → 渲染文件清单表格（el-table 迷你：路径 / 动作标签（created 绿 overwritten 橙）/ 大小 formatSize）；字符串 → 维持现状
- ai_tool_call.params 仍存原始 params（content 全文），留痕口径不变；确认卡只展示摘要

### 15.7 模板库

```
apps/api/assets/site-templates/{id}/
├── index.html / style.css / app.js / README.txt   # 四件套（纪律同 P4a：相对路径 ./api/*、可 CDN、textContent 防 XSS）
└── template.json  # { "name": "...", "description": "...", "version": 1, "preview": null }
```

- `GET /api/site/templates`（site:site:manage）：`fs.readdir('assets/site-templates')` → 逐目录读 template.json → `[{ id, name, description }]`；目录无 template.json 或 JSON 解析失败 → 跳过并记运行日志；**启动不缓存**（模板由部署侧维护，低频接口实时读）
- `POST /api/site/mine/apply-template`（site:site:manage，@OperationLog）：
  1. getMySiteInfo → null 40101；templateId 匹配目录（拒 `..`/分隔符，防穿越）→ 不存在 40116
  2. 遍历模板目录文件（**排除 template.json**）：读资产文件 → 经 `SiteFacade.writeFiles` 写入站点根（同名软删 + 新建，D23/R20；白名单/路径校验天然通过——模板自身必须是合法文本文件）
  3. media/ 不动；站点根下模板外文件不动
  4. invalidateSitePaths（涉及路径）；返回 `[{ path, action, size }]`
- 建站流程（manage.create）模板源改读 `site-templates/default/`；迁移完成后删除旧 `assets/site-template/`；**回滚逻辑 discardSiteDraft 不变**
- template.json 的 `preview` 字段本期恒 null（预览图预留，PRD 不做）

### 15.8 README 契约与 PLATFORM-GUIDE 分工（D26/R22）

- 三套模板的 README.txt 内容一致（站点契约部分）+ 各自一句主题说明；契约段必须覆盖：站点 URL 形态与目录语义（尾斜杠/index.html/301 补斜杠）、七端点字段级契约（以 `./api/...` 相对路径视角）、三条纪律（相对路径 fetch；CSP sandbox 无 localStorage/凭证、allow-modals 下 alert/confirm 可用；用户内容 textContent 注入）
- **R22 维护纪律**：开放 API 变更必须同任务同步三套 README（T45 验收第 10 条核对）
- PLATFORM-GUIDE.md「个人网站」章节追加 ≤120 字摘要（2000 字总上限不变，T23 口径）；工具 description 写明"README 不存在时按 PLATFORM-GUIDE 摘要保守操作"（兼容 P4a 旧 README 站点）

### 15.9 前端集成（CodeMirror 6，D20 批准清单）

- 依赖（web，devDep/dep 按现状归类）：`codemirror`、`@codemirror/lang-html`、`@codemirror/lang-css`、`@codemirror/lang-javascript`、`@codemirror/lang-json`、`@codemirror/lang-markdown`——**除此之外零新增**；不引主题包（默认亮主题）、不引 lint/autocomplete 增强包
- FileEditorDialog.vue：全屏 el-dialog；`@codemirror/basic-setup` 经 codemirror 元包 + 按 ext 懒加载 language（动态 import，不阻塞云盘首屏）；只读模式复用给无权限场景不需要（按钮直接不显示）
- 扩展名 → language 映射：html/htm→lang-html；css→lang-css；js/mjs→lang-javascript；json→lang-json；md→lang-markdown；txt/svg/xml/yml/yaml/csv→纯文本（无 language）
- 云盘页操作列「编辑」显示条件：`!row.isDir && TEXT_EXTS.includes(row.ext) && row.size <= 1048576` + `v-permission="'cloud:file:upload'"`；加载走既有 preview 接口取文本
- 走查 W2 同步改：file.list 的 isPublic 按三态渲染——`1`→「公开」绿标、`2`→「已阻断」橙标、`0`→无标签；「设为公开/取消公开」按钮逻辑不变（契约仍二元）

### 15.10 错误码（新增，P4b）

| code  | 含义                                                 | 触发点                             |
| ----- | ---------------------------------------------------- | ---------------------------------- |
| 40113 | 站点文件路径非法（越出站点根/含 `..`/绝对路径/空段） | writeTextFile / readTextFileByPath |
| 40114 | 文件类型不允许（非文本白名单）                       | 同上 + read_site_file              |
| 40115 | 内容超限（AI 写 >256KB / 单次 >10 个 / 读 >64KB）    | 三件套                             |
| 40116 | 模板不存在                                           | apply-template                     |
| 30012 | 该文件类型不支持在线编辑                             | PUT file/:id/content               |
| 30013 | 内容超出在线编辑上限（1MB）                          | 同上                               |

> 「标签不存在」维持 40400（走查 W5 备案），不占码。

### 15.11 seed 变更

**零变更**：工具 perms 复用 site:site:manage（菜单级，common 已授）；编辑器复用 cloud:file:upload；模板接口复用 site:site:manage。无新菜单、无新权限标识。（T45 验收第 12 条据此核对。）

### 15.12 环境变量

无新增。本期常量（写死代码 + 文档，不进配置组——不常调，避免配置膨胀）：

| 常量                | 值                                                   | 位置                                                                                                       |
| ------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| SITE_FILE_TEXT_EXTS | html/htm/css/js/mjs/txt/md/json/svg/xml/yml/yaml/csv | site 域常量（SiteFacade 校验用；编辑器前端另维护同集显示条件，两边以本文档为准对齐）                       |
| AI 写单文件上限     | 256KB                                                | write-site-files.tool.ts                                                                                   |
| AI 单次文件数上限   | 10                                                   | 同上                                                                                                       |
| AI 读文件上限       | 64KB                                                 | read-site-file.tool.ts（**同时是上下文护栏**：工具结果占用模型 max_context 预算，见 §12.2 轮次与截取口径） |
| 编辑器内容上限      | 1MB                                                  | cloud file service + 前端按钮显示条件                                                                      |

### 15.13 资产表增补（T45 回写 §9）

| 名称                           | 位置                           | 用途                                                           | 状态        |
| ------------------------------ | ------------------------------ | -------------------------------------------------------------- | ----------- |
| SiteFacade 扩展                | api/src/modules/site/facade    | getMySiteInfo / invalidateSitePaths                            | 已建（T41） |
| CloudFacade 扩展（P4b）        | api/src/modules/cloud/facade   | listSubtree / readTextFileByPath / writeTextFile（管理侧语义） | 已建（T41） |
| FileService.replaceFileContent | api/src/modules/cloud          | 行内更新文件内容（overwrite 上传与在线保存共用）               | 已建（T43） |
| FileEditorDialog               | web/src/views/cloud/components | CodeMirror 6 在线编辑弹窗                                      | 已建（T43） |
| AiTool.summarize               | api/src/modules/ai/tool        | write 工具确认卡结构化摘要钩子                                 | 已建（T42） |
| 站点模板库                     | apps/api/assets/site-templates | 三套预置模板（default/portfolio/card）                         | 已建（T44） |

### 15.14 与 P4a 走查修复的关系

- 走查 W1/W3~W10 文档补丁：T41 开工前套完（见《P4a-走查报告.md》）
- 走查 W2 代码修复（file.list 三态 int）：并入 T43，R23 为验收口径
- P4b 自身不再引入新的"待并入"缺口：T45 并入时本文档全部章节一次性入主文档

### 15.15 演进预留（本期不做，架构不堵路）

| 项                | 触发条件             | 预留设计                                                            |
| ----------------- | -------------------- | ------------------------------------------------------------------- |
| AI 文章/栏目工具  | P4c 产品语义明确     | AiTool 框架原位加工具，perms 用 site:article:* 等既有标识           |
| 模板预览图        | 模板数量 >5          | template.json.preview 字段已预留；GET templates 原样透传            |
| 模板/功能分享市场 | 用户愿景落地期       | 模板即目录，导出=打包 assets 子目录，导入=解压 + template.json 校验 |
| 站点多版本历史    | 回滚诉求超回收站语义 | SiteFacade.writeFiles 已集中写入点，加版本快照表即可                |
| 用户自建表/接口   | 平台化愿景           | 开放层已证明"@Public + 独立限流 + 40400 防探测"模式可复制           |
