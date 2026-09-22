# ARCHITECTURE-P10-增补（AI 对话附件上传·文本类）

> 2026-09-19 ｜ Kimi ｜ 与 PRD-P10-AI-ATTACHMENT.md 配套（编号 D82~~D86 / R82~~R87 / T96~T99）
> 并入主文档时建议作为 **§26**；§14.6/§22.5（回退链）、§20（AI 工具）、§21（手册与预算）相关处加指针。

## 26.1 数据模型（T96）

```sql
ALTER TABLE ai_message ADD COLUMN attachments JSON NULL
  COMMENT '附件元信息 [{fileId,name,ext,size,chars,mode,path}]，mode=inject|listed；仅存元信息不存内容';
```

- 迁移手写 SQL + `prisma migrate deploy`，同既有口径；纯加列无回填，零风险；
- **不冗余附件内容**：历史轮次重组装时按 fileId 重读云盘（D82）；源文件被删/无权 → 该附件在组装时标注「（附件已失效）」占位，不报错不阻断（验收 6）。

## 26.2 附件解析链（T96，ai 域）

新增 `modules/ai/chat/attachment-resolver.ts`（纯函数 + 门面注入，零 Nest 依赖优先）：

```
resolveAttachments(userId, attachmentInputs: [{fileId}])
  → 逐附件校验（R82）：CloudFacade 取行 → 本人/未删/非目录/白名单(D86)/≤2MB
  → CloudFacade.readTextFileById（P8 门面，白名单与上限由本域传入）
  → 编码探测（复用 P8：UTF-8 剥 BOM 优先，替换字符多则 GBK 回取）
  → 产出 { meta, text } 数组
```

- 域边界：ai 域不直接读盘，全经 CloudFacade（铁律 6）；编码探测属「文本语义」留 ai 域侧调用方，与 P8 §24.5 同口径；
- 附件上传（本地上传路）复用云盘 upload 链路落 `/ai-attachments/`（D84）：前端先调既有上传接口（自动建目录、配额记账、同名 (1) 全白拿），再把返回 fileId 放进 chat body——**后端零新端点**。

## 26.3 双模式分流与注入组装（T96，D83/R83/R84）

消息组装（`toOpenAIMessages` 前置）新增 attachments 阶段，顺序：system（手册+能力清单+**可读清单**）→ attachments 注入 → history → 当前 user：

1. **inject**：该条 user 消息前部插 `【附件 {name}】\n```\n{text}\n```` 块；多附件按用户选择顺序排列；
2. **截断**：单文件 >30,000 字符时，若本条 inject 累计帽（60,000）内仍有空间 → 截断注入 + 尾部标注（R83），同时进清单；
3. **listed**：不注入正文，仅登记；**会话级清单** = 本会话所有消息附件的并集（去重、失效标注、上限 20），随每轮 system 动态追加（R84 文案），不计手册 2000 字帽。

## 26.4 预算扣减（T96，D85）

P5 预算动态化扩一项：实测 system + tools 后，**再扣 attachments 实算字符**（inject 全文 + 清单文案），剩余为 history 预算；下限保护 2000 不变；`DEBUG_AI=1` 日志加 `attachmentsBudget` 字段。attachments 本身无下限保护——附件超限场景由 D83 分流在注入前消化，不走预算硬切。

## 26.5 read_cloud_file 分页（T97，R85）

- 工具 parameters 加 `offsetChars`（默认 0）/ `maxChars`（默认 20000，上限 50000）；返回加 `totalChars / truncated / nextOffset`；
- 实现：SiteFacade/CloudFacade 读取链不动，工具层切片（文本已 ≤2MB 入内存，切片零成本）；description 补「大文件请分段读取，先读开头判断结构」；
- KEYWORD_TO_GROUPS 不变（cloud 组既有）；能力清单文案同步；**check:ai + smoke:ai 双跑**（T95 触发条件：工具定义变更）。

## 26.6 前端（T98，R86/R87）

- 输入区：回形针按钮 → 菜单「从云盘选择（FilePicker）/ 上传本地文件」；待发附件 chips 行（图标 + 名称 + 大小 + ×移除）；本地文件暂存内存 `File` 对象，**发送时**先上传留档再发消息（失败则整条不发出，附件 chips 保留可重试）；
- 气泡：用户气泡底部附件行（图标 + 名称 + `AI 按需读取` 标签 for listed）；历史渲染同源；失效附件置灰 + 「源文件已删除」；
- 上传组件复用：`FilePicker`（P8）、`uploadFile`（P3，timeout:0 已修）；不新造组件。

## 26.7 SSE 与确认链兼容

- chat SSE 事件流格式不变；附件仅影响**组装**，不影响流式输出与工具确认回路；
- 工具确认后重发（confirm 链）重组装历史时附件重读——内容可能已变化（用户编辑过），可接受（语义 = 「以最新文件内容继续」）；失效降级同 26.1。

## 26.8 演进方向（登记不实施）

- 二期图片：厂商模型表加 vision 能力标记 → 组装层对 vision 模型产 content 数组（text + image_url/base64）、非 vision 模型拒收图片附件并提示；前端图片预览；
- RAG / 摘要接力：若清单自读实测效果差再议；
- 附件用量分析：ai_message.attachments 已有元信息，后续统计零成本。
