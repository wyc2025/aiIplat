# API-P6-增补（AI 能力手册与体验打磨 · 作者回复评论 · 文章封面）

> **【已并入 API.md §13（T82 收口，2026-09-15）】本文件保留为历史细节参考；与 API.md 冲突时以 API.md 为准。**
> 并入时的口径修订：§13.6 分组常量表按其 §21.1 实现口径改写（原表含未注册工具）；§13.1 错误码改为实际码（40110/40119/40001）；§13.4 评论工具参数以实现为准（status 字符串枚举、pageSize ≤20）。
>
> 对应 **API.md 新增 §13**。本期新增接口很少（核心在 AI 侧与前端体验）：
>
> - 新增：作者回复评论接口（§13.1）；3 个评论管理 AI 工具（§13.4）
> - 修改：开放 API 评论条目携带回复字段（§13.2）；模板列表携带预览图（§13.3）；发文/改文工具加 coverPath（§13.5）
> - 不变：AI 路由与手册注入为后端内部行为，无 HTTP 契约变化（§13.6）
>
> 编号续接：决策 D67~~D72、需求 R69~~R74、任务 T77~T82。本期**无新增错误码**（复用 30019/40105/40107/40119 等）。

---

## 13.1 作者回复评论（新增）

| 方法 | 路径                          | 权限                 | 说明                          |
| ---- | ----------------------------- | -------------------- | ----------------------------- |
| PUT  | `/api/site/comment/:id/reply` | `site:comment:audit` | 设置/更新/清除作者回复（R70） |

请求体：

```json
{ "content": "感谢反馈，已修复" }
```

| 字段    | 约束                                                                                    |
| ------- | --------------------------------------------------------------------------------------- |
| content | string，trim 后 ≤500 字；**空字符串/null = 清除回复**（reply_content/reply_at 置 NULL） |

返回 `{ "ok": true }`。

错误码：

| 码    | 触发                             |
| ----- | -------------------------------- |
| 40119 | 评论不存在或不属于当前用户的站点 |
| 40107 | content 超 500 字                |
| 40101 | 无 `site:comment:audit` 权限     |

幂等：重复 PUT 同内容 = 覆盖更新 reply_at；无版本冲突概念。

---

## 13.2 开放 API：评论条目携带回复（修改既有）

`GET /api/open/site/:slug/comments`（API.md §7.4）与文章评论接口的返回条目**新增两个字段**：

```json
{
  "id": 12,
  "articleId": 5,
  "nickname": "访客甲",
  "content": "…",
  "likeCount": 2,
  "createdAt": "…",
  "replyContent": "感谢反馈，已修复",
  "replyAt": "2026-09-15T10:00:00.000Z"
}
```

规则：

- **仅当评论审核通过（audit_status=1）且 reply_content 非空时返回**；未回复条目两字段为 null（字段保留，前端判空渲染）。
- 未过审评论本就不可见，其回复自然不可见（D69：回复不单独审核）。
- 回复无独立点赞/再回复（一级模型）。

---

## 13.3 模板列表携带预览图（修改既有）

`GET /api/site/templates` 返回条目新增：

```json
{
  "id": "tech-doc",
  "name": "技术文档",
  "engine": "vitepress",
  "description": "…",
  "previewUrl": "/templates/tech-doc/preview.png"
}
```

- previewUrl 为静态资源相对路径（构建期随模板打包，`assets/templates/<id>/preview.png` → 发布目录 `/templates/<id>/preview.png`）。
- 某模板预览图缺失时字段为 null，前端渲染占位块（不裂图）。

---

## 13.4 评论管理 AI 工具（新增 3 个，工具总数 25 → 28）

挂载 `site` 组（create 组已改名 site 组，见 §13.6）。均需 `site:comment:audit` 权限。

### 13.4.1 list_site_comments（R70）

```json
{
  "name": "list_site_comments",
  "description": "列出站点评论（默认待审核）。可按文章筛选。",
  "parameters": {
    "type": "object",
    "properties": {
      "articleId": { "type": "number", "description": "可选，按文章筛选" },
      "status": {
        "type": "string",
        "enum": ["pending", "approved", "rejected", "all"],
        "default": "pending"
      },
      "page": { "type": "number", "default": 1 },
      "pageSize": { "type": "number", "default": 20, "maximum": 50 }
    }
  },
  "perms": ["site:comment:audit"],
  "risk": "low"
}
```

返回 items 每条含 `{id, articleId, articleTitle, nickname, content, auditStatus, replyContent, replyAt, createdAt}`；summarize：「待审核评论 N 条：#12 访客甲「…前30字」、#15 …」。

### 13.4.2 audit_site_comments（R70）

```json
{
  "name": "audit_site_comments",
  "description": "批量审核评论（通过/拒绝）。",
  "parameters": {
    "type": "object",
    "properties": {
      "ids": { "type": "array", "items": { "type": "number" }, "minItems": 1, "maxItems": 20 },
      "action": { "type": "string", "enum": ["approve", "reject"] }
    },
    "required": ["ids", "action"]
  },
  "perms": ["site:comment:audit"],
  "risk": "medium"
}
```

逐条处理、汇总报告（沿用 P5 批次模式）；summarize：「评论审核完成：通过 3 条（#12、#13、#14）」。

### 13.4.3 reply_site_comment（R70）

```json
{
  "name": "reply_site_comment",
  "description": "以作者身份回复评论；content 为空字符串表示清除已有回复。",
  "parameters": {
    "type": "object",
    "properties": {
      "id": { "type": "number", "description": "评论 ID" },
      "content": { "type": "string", "maxLength": 500, "description": "回复内容；空串 = 清除回复" }
    },
    "required": ["id", "content"]
  },
  "perms": ["site:comment:audit"],
  "risk": "medium"
}
```

错误：评论不存在/不属当前站点 → 40119；content 超 500 → 40107。
summarize：「已回复评论 #12（访客甲）：「…前30字」」；清除时：「已清除评论 #12 的回复」。

> **评论归属校验**：三个工具均校验评论属于解析出的当前站点（跨站评论操作 = 40119）。

---

## 13.5 发文/改文工具新增 coverPath（修改既有，R71）

`create_article` / `update_article` parameters 新增可选字段：

```json
"coverPath": { "type": "string", "description": "封面图：站点云盘 media/ 下的已有图片路径，如 media/covers/a.png。必须先上传。" }
```

校验链（任一失败 → 40105 文本反馈，附该站 media/ 下可用图片清单）：

1. 以 `media/` 前缀开头；
2. 解析到该站云盘存在对应 cloud_file 行（文件非目录）；
3. 扩展名 ∈ {.png, .jpg, .jpeg, .webp, .gif}。

update_article 传 `coverPath: ""` = 清除封面。列表/详情/开放 API 的 cover 字段既有契约不变（值仍为封面图片的 URL/路径字符串）。

---

## 13.6 AI 路由与手册注入（无 HTTP 契约变化，行为说明）

R69 的注入逻辑全部发生在后端 AiChatService 内部，对前端/调用方透明：

- **手册**：system 消息 = 通用版（身份/铁律/安全边界/输出格式）+ 按用户权限拼接的能力清单（有 `site:comment:audit` 才出现评论段）。总预算 ≤2000 字符。
- **工具**：请求进入时按用户消息关键词命中 KEYWORD_TO_GROUPS 预筛工具组；common 组必带；无命中 = 全量 28 工具回退。响应契约不变（SSE 事件流格式不动）。
- 观测日志：`[AI] tools injected: groups=site,cloud count=14/28`（info 级，DEBUG_AI=1 时输出命中关键词明细）。

**分组常量（实现口径，供前端/测试参考）**：

| 组     | 工具                                                                                                                                                                                                                     |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| common | navigate_page、get_current_page、search_articles、list_sites、get_site_status                                                                                                                                            |
| site   | publish_site、unpublish_site、create_site、delete_site、create_article、update_article、delete_article、publish_article、unpublish_article、set_article_top、list_site_comments、audit_site_comments、reply_site_comment |
| cloud  | list_files、read_file、write_file、delete_file、share_file                                                                                                                                                               |
| admin  | list_users、create_user、reset_user_password、list_admins、create_admin、change_admin_password、list_models、create_model、update_model、delete_model、test_model                                                        |

> 工具改名说明：P5 文档中的 create 组自本期起称 **site 组**（收纳评论工具后名实相符）；关键词表同步扩充评论词根。

---

## 13.7 体验类改动（前端行为，无接口变化）

| 项         | 说明                                                             |
| ---------- | ---------------------------------------------------------------- |
| 模板预览图 | TemplatePicker 卡片展示 previewUrl，缺图占位（R72）              |
| 预览 diff  | 会话内版本切换接 @codemirror/merge 双栏对比；组件异步加载（R72） |
| 格式按钮   | 预览工具栏：复制 Markdown / 下载 .md（R72）                      |
| 回收站过滤 | 头像行（parent_id=-1）不再出现在回收站列表（D72）                |
| 确认弹窗   | 统一 confirmDialog 封装（内置 try/catch，取消静默）（D72）       |

---

## 13.8 编号登记

| 系列    | 本期使用   | 说明                                                           |
| ------- | ---------- | -------------------------------------------------------------- |
| 决策    | D67~D72    | 见 PRD-P6 §3                                                   |
| 需求    | R69~R74    | 见 PRD-P6 §4                                                   |
| 任务    | T77~T82    | 见 PRD-P6 §6                                                   |
| 错误码  | **无新增** | 复用 30019（站根保护，既有）/40101/40105/40107/40119           |
| AI 工具 | 25 → 28    | +list_site_comments / audit_site_comments / reply_site_comment |
