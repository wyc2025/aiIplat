# iplat —— 接口契约（API.md）

> 本文档是前后端接口的唯一事实来源。与代码冲突时以本文档为准并修正代码。
> 通用约定（统一响应、错误码、分页、bigint→string、时间格式）见 ARCHITECTURE.md 4.3 节，此处不再重复。
> 当前覆盖：P2a（ai 域 + system 域在线用户增量）、P2b（AI 工具调用）、P3（cloud 域 + 头像上传）、P4a（site 域 + 开放层 + cloud 公开机制增量）、P4b（AI 站点工具 + 在线编辑 + 模板库）、P4c（云盘公开链接 + /api/pub/ 公开访问端点 + 在线解压，T46~~T49，见 §8；批量上传为纯前端，后端零改动）、**P4d（移动/打包下载/分享升级/公开语义分流，T52~~T56，见 §9；剪切粘贴、多选批量与语义分流为前端能力，后端仅 §9 所列增量）**、**P4e（多站点/删站/AI 多站语义/sid 脱敏，T59~~T65，见 §10）\**、**P4F（配额对账两端点，T68，见 §11；回收站自动清理为纯 cron 行为，无 HTTP 端点）**、\**P5（AI 工具 11→25 + 预算动态化，T71~~T75，见 §12；零新 HTTP 端点、零新错误码、零新依赖——工具契约与配置增量）**、**P6（按需注入 + 评论代审代回 + 封面通道 + 体验三件套，T77~~T81，见 §13；新增 1 个 HTTP 端点、工具 25→28、零新错误码、新依赖 1 个 `@codemirror/merge`）**。system 域既有接口以代码与 Swagger 为准。

## ai 域错误码（20xxx）

| code  | 含义                            | 前端处理               |
| ----- | ------------------------------- | ---------------------- |
| 20001 | 未开通套餐或套餐已失效          | 引导跳开通套餐页       |
| 20002 | 积分不足                        | 提示 + 去开通链接      |
| 20003 | 模型不可用 / 已停用             | 提示重新选择模型       |
| 20004 | 会话不存在或无权访问            | 刷新会话列表           |
| 20005 | 上游模型调用失败                | 消息失败态 + 重试      |
| 20006 | 内容超出模型上下文长度          | 提示缩短内容           |
| 20007 | 上一段对话进行中（并发流限制）  | 提示等待或停止当前生成 |
| 20008 | 套餐下有生效订阅，不可删除      | 提示先处理订阅         |
| 20009 | 套餐标识已存在                  | 提示更换标识           |
| 20010 | 厂商标识已存在                  | 提示更换标识           |
| 20011 | 厂商下有模型，不可删除          | 提示先删除模型         |
| 20012 | 厂商内 API 模型名已存在         | 提示更换模型名         |
| 20013 | 模型存在会话/用量引用，不可删除 | 提示停用而非删除       |

---

## 1. 用户侧接口（登录即可，聊天类接口额外做套餐校验，不挂 @RequirePermission）

### 1.1 可用模型列表

`GET /api/ai/models`

返回 `data`：`[{ id, displayName, model, providerCode, providerName, maxContext, inputPrice, outputPrice }]`
（仅 status=1 且所属厂商 status=1 的模型；价格字段用于展示，敏感性低。**本接口不校验套餐**，未开通用户也可拉取，便于对话页渲染"去开通"空态；套餐校验仅发生在 /api/ai/chat）

### 1.2 会话管理

| 方法   | 路径                              | 说明                                                                                                                                                                                                                                                                                                                            |
| ------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | /api/ai/conversation              | 会话分页列表。入参 pageNo/pageSize，按 updatedAt 倒序，item 含 `{ id, title, modelId, modelDisplayName, updatedAt }`                                                                                                                                                                                                            |
| PUT    | /api/ai/conversation/:id          | 重命名 / 切换模型。入参 `{ title?, modelId? }`（title 1~50 字；modelId 作用于该会话后续消息）                                                                                                                                                                                                                                   |
| DELETE | /api/ai/conversation/:id          | 删除会话（软删，消息级联软删）                                                                                                                                                                                                                                                                                                  |
| GET    | /api/ai/conversation/:id/messages | 消息列表。**不分页**，返回最近 50 条、按 createdAt 正序；item `{ id, role, content, tokensInput, tokensOutput, credits, modelDisplayName, status, createdAt }`；**P2b 起** item 增加 `toolCalls` 数组（`{ toolCallId, toolName, title, summary, params, status }`，无工具调用则为空数组），用于刷新后恢复确认卡片与工具标签状态 |

**会话为懒创建**：不设"新建会话"接口。前端点"新建会话"仅置本地态，首条消息经 `POST /api/ai/chat`（不带 conversationId、带 modelId）时由后端建会话，meta 事件回传 conversationId；done 事件后前端刷新会话列表获取自动生成的标题。

权限：只能操作本人的会话，否则 20004。

### 1.3 发送消息（SSE 流式，核心接口）

`POST /api/ai/chat`
Content-Type: application/json
Accept: text/event-stream

入参：

```json
{ "conversationId": "123", "modelId": "10", "content": "用户消息文本" }
```

- conversationId 为空 = 新会话首条消息，此时 **modelId 必填**（后端建会话并绑定模型）；conversationId 非空时忽略 modelId，使用会话当前绑定模型（切换模型走 PUT /ai/conversation/:id）
- 限流：20 次/分/用户；同一用户存在进行中的流时拒绝（**20007**）
- 调上游时必须携带 `stream_options: { include_usage: true }` 以获取流式 usage；若上游最终未返回 usage，按字符数保守估算（口径见 ARCHITECTURE §11）并在 ai_usage_log 标记 estimated=1

**前置校验**（任一失败走统一 JSON 错误响应，不进入流式）：
登录 → 套餐生效且剩余积分 > 0 → 模型启用 → 会话归属 → 内容非空且未超模型上下文长度

**进入流式后**，`Content-Type: text/event-stream`，事件序列为：

```
data: {"type":"meta","conversationId":"123","userMessageId":"456","assistantMessageId":"457"}

data: {"type":"delta","content":"你"}

data: {"type":"delta","content":"好"}

data: {"type":"done","usage":{"inputTokens":12,"outputTokens":350,"credits":3,"remainingCredits":9997}}

```

- 心跳：流式期间每 15s 无 delta 则发送注释行 `: ping`（防代理/网关静默断连，前端解析时忽略）
- 上游失败/中断：`data: {"type":"error","code":20005,"message":"..."}`
- 客户端主动断开（停止生成/关页）：后端中断上游请求，已产生 tokens 照常结算
- 结算在 `done` 前完成落库（ai_message 更新 + ai_usage_log + 额度扣减），`done` 里的 remainingCredits 是结算后的真实值

**实现约束（后端）**：本接口是统一响应格式的**唯一例外**——Controller 使用 `@Res() res` 原生写流，需在方法上标记使 TransformInterceptor / OperationLogInterceptor 跳过（OperationLog 用自定义日志替代：记录 userId/conversationId/模型/tokens）。

### 1.4 套餐与用量

| 方法 | 路径                   | 说明                                                                                                                                                     |
| ---- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET  | /api/ai/plan/list      | 启用中的套餐列表（卡片展示用）：`[{ id, name, code, monthlyCredits, price, description }]`                                                               |
| GET  | /api/ai/plan/mine      | 我的套餐：`{ plan: {...} \| null, cycleStart, cycleEnd, totalCredits, usedCredits, remainingCredits }`                                                   |
| POST | /api/ai/plan/subscribe | 开通/切换。入参 `{ planId }`；立即生效，按新套餐重置额度与周期（本期无支付，见 PRD-P2A D1）                                                              |
| GET  | /api/ai/usage/mine     | 我的用量明细分页。入参 pageNo/pageSize + 可选 modelId；item `{ id, modelDisplayName, tokensInput, tokensOutput, credits, conversationTitle, createdAt }` |

---

## 2. 管理端接口（挂 @RequirePermission，见各接口标注）

### 2.1 厂商管理（ai:provider:*）

| 方法   | 路径                       | 权限               | 说明                                                         |
| ------ | -------------------------- | ------------------ | ------------------------------------------------------------ |
| GET    | /api/ai/admin/provider     | ai:provider:list   | 分页列表；**apiKey 掩码返回**（`sk-****` + 后 4 位）         |
| POST   | /api/ai/admin/provider     | ai:provider:create | 入参 `{ name, code, baseUrl, apiKey, status, sort, remark }` |
| PUT    | /api/ai/admin/provider/:id | ai:provider:update | 同上；apiKey 传空串表示不修改                                |
| DELETE | /api/ai/admin/provider/:id | ai:provider:delete | 下有模型时禁止删除                                           |

### 2.2 模型管理（ai:model:*）

| 方法   | 路径                            | 权限            | 说明                                                                                                 |
| ------ | ------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------- |
| GET    | /api/ai/admin/model?providerId= | ai:model:list   | 按厂商查模型列表（不分页）                                                                           |
| POST   | /api/ai/admin/model             | ai:model:create | `{ providerId, displayName, model, inputPrice, outputPrice, maxContext, supportTool, status, sort }` |
| PUT    | /api/ai/admin/model/:id         | ai:model:update | 同上                                                                                                 |
| DELETE | /api/ai/admin/model/:id         | ai:model:delete | 存在引用（会话/用量记录）时禁止删除，仅可停用                                                        |

### 2.3 套餐管理（ai:plan:*）

| 方法   | 路径                      | 权限           | 说明                                                                          |
| ------ | ------------------------- | -------------- | ----------------------------------------------------------------------------- |
| GET    | /api/ai/admin/plan        | ai:plan:list   | 分页列表，item 附加 `activeSubscribers`（生效订阅数）                         |
| POST   | /api/ai/admin/plan        | ai:plan:create | `{ name, code, monthlyCredits, price, description, status, sort }`            |
| PUT    | /api/ai/admin/plan/:id    | ai:plan:update | 同上                                                                          |
| DELETE | /api/ai/admin/plan/:id    | ai:plan:delete | 有生效订阅时禁止删除                                                          |
| POST   | /api/ai/admin/plan/assign | ai:plan:assign | `{ userId, planId }`，立即对该用户生效（同 subscribe 规则），挂 @OperationLog |

### 2.4 用量明细（ai:usage:list）

`GET /api/ai/admin/usage`：分页。入参 pageNo/pageSize + username（模糊）+ modelId + startTime/endTime；返回 item 同 1.4 加 `username`；响应 data 附加 `summary: { totalTokensInput, totalTokensOutput, totalCredits }`（按当前筛选条件聚合）。

---

## 3. system 域增量：在线用户

### 3.1 在线用户列表

`GET /api/system/online`（权限 `system:online:list`）

返回 `data`：`[{ userId, username, nickname, ip, loginAt, lastActiveAt }]`，按 lastActiveAt 倒序，不分页（数据来源 Redis，量级小）。

### 3.2 踢下线

`DELETE /api/system/online/:userId`（权限 `system:online:kick`，挂 @OperationLog）

- 实现：写 `user:pwd:changed:{userId}` = 当前时间戳（复用 T10 机制，该用户全部已签发 token 即刻失效）+ SCAN 删除其全部 refresh token + 删除 `user:perms:{userId}` + 删除 `online:{userId}`
- admin 用户不可踢（返回 10202 同款超管保护）
- 不能踢自己

---

## 4. P2b 增补：AI 工具调用

### 4.1 错误码新增（续 20xxx 段；20008~20013 已被 P2a 套餐/厂商/模型占用）

| code  | 含义                 | 前端处理                            |
| ----- | -------------------- | ----------------------------------- |
| 20014 | 工具不存在或未启用   | 提示该能力暂不可用                  |
| 20015 | 无权限使用该工具     | AI 消息内自然语言提示（由模型转述） |
| 20016 | 确认单不存在或已过期 | 卡片置灰显示"已过期"                |
| 20017 | 工具执行失败         | AI 消息失败态 + 重试                |

### 4.2 POST /api/ai/chat 行为变化

- 模型 `support_tool=1` 且当前用户有可用工具时，后端请求上游携带 tools（按用户权限过滤的子集）
- SSE 事件序列在 meta / delta / done / error 基础上**新增两种事件**：

```
data: {"type":"tool_result","toolCallId":"789","toolName":"get_online_users","status":"executed","summary":"已查询在线用户"}

data: {"type":"tool_confirm","toolCallId":"790","toolName":"kick_user","title":"踢用户下线","summary":"将用户 tester（ID: 12）强制下线","params":{"username":"tester"}}

```

- `tool_result`：read 工具自动执行后的结果通知（折叠标签展示）
- `tool_confirm`：write 工具待确认通知，收到后本轮流结束（done 照常下发并结算本轮；该 assistant 消息 content 允许为空，仅承载卡片）；前端渲染确认卡片
- 工具回喂引发的多次上游调用，tokens 累加进同一 assistant 消息统一结算；工具调用轮次上限 3

### 4.3 工具确认（SSE）

`POST /api/ai/tool/confirm`
Content-Type: application/json　Accept: text/event-stream

入参：

```json
{ "toolCallId": "790", "approved": true }
```

- 前置校验（失败走统一 JSON 错误码）：登录 → 套餐/积分预检（20001/20002）→ 并发流锁（与 /ai/chat 共用 ai:chatting，冲突返回 20007）→ 确认单存在且未过期（20016）→ 确认单归属当前用户 → 工具权限二次校验（20015）
- `approved=true`：执行工具 → 结果回喂上游 → **本接口以 SSE 流式返回**模型的后续总结（事件序列同 /ai/chat：meta / delta / done / error，含 15s 心跳）；**总结持久化为新的 assistant 消息并独立结算**，meta 事件携带新的 assistantMessageId，前端追加新气泡（不续接到卡片所在消息）
- `approved=false`：ai_tool_call 置 rejected，回喂"用户已取消"，同样 SSE 返回模型的回应
- 确认单为一次性：确认/取消后立即失效，重复提交返回 20016

---

## 5. P3 增补：云盘（cloud 域）

### 5.1 错误码新增（30xxx 段）

| code  | 含义                                                   | 前端处理                   |
| ----- | ------------------------------------------------------ | -------------------------- |
| 30001 | 文件/文件夹不存在或无权访问                            | 刷新当前目录列表           |
| 30002 | 同目录下已存在同名项                                   | 提示更换名称               |
| 30003 | 存储配额不足                                           | 提示用量与配额             |
| 30004 | 文件超出大小限制                                       | 提示上限值                 |
| 30005 | 该类型不支持预览                                       | 提示"请下载查看"           |
| 30006 | 超出目录限制（深度>10 / 单目录>500 项 / 名称>64 字符） | 提示具体限制               |
| 30007 | 回收站记录不存在                                       | 刷新回收站列表             |
| 30008 | 分享链接无效（不存在/已停止/已过期/文件已删/未过审）   | 访客页提示失效             |
| 30009 | 文件夹暂不支持创建分享链接                             | 提示                       |
| 30010 | 文件未通过内容审核，禁止分享                           | 提示（开关开启后生效）     |
| 30011 | 用户仍有云盘文件，禁止删除（R10 删用户预检）           | 提示                       |
| 30021 | 文件被应用数据引用，禁止删除（P11 D96）                | 提示先删除应用中的引用数据 |

> **段位续接（P11 走查 W1 收齐）**：30012~~30013 见 §7.1、30014~~30016 见 §8.1、30017~30020 见 §9.1 / §10.1、**30021 见 §18.3**（P11 D96）。
> **50xxx 段（应用平台 P11）**：段位起点 **50001**（50000 为通用内部错误），10 码全表见 §18.3（同表含 30021）。

通用约定不变：bigint ID 序列化为字符串；文件大小字段（size/quota/used）为数字字节数，前端负责格式化展示。

### 5.2 我的文件（均要求登录；数据按当前用户隔离）

| 方法   | 路径                       | 权限              | 说明                                                                                                                                                                                                 |
| ------ | -------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | /api/cloud/file/list       | cloud:file:list   | 目录内容。入参 `parentId`（缺省 0=根）。返回 `{ list, quota, used }`；list **不分页**：文件夹在前（按名称升序），文件在后（按修改时间倒序）；item `{ id, name, isDir, size, ext, mime, updateTime }` |
| GET    | /api/cloud/file/path       | cloud:file:list   | 面包屑链。入参 `id`；返回 `[{ id, name }]` 从根到当前（根目录返回 `[]`）                                                                                                                             |
| POST   | /api/cloud/file/mkdir      | cloud:file:mkdir  | 入参 `{ parentId, name }`；同名冲突自动"(1)"；深度/数量/名称限制（30006）                                                                                                                            |
| POST   | /api/cloud/file/rename     | cloud:file:rename | 入参 `{ id, name }`；同名冲突**阻止**（30002）                                                                                                                                                       |
| DELETE | /api/cloud/file/:id        | cloud:file:delete | 软删入回收站（R2：只标自身），挂 @OperationLog                                                                                                                                                       |
| GET    | /api/cloud/file/quota      | cloud:file:list   | 我的配额 `{ quota, used }`（cloud_usage 懒创建）                                                                                                                                                     |
| GET    | /api/cloud/file/avatar/:id | cloud:file:list   | 头像预览流（@SkipTransform）：仅当前用户自己的头像记录（parentId=-1）可读，流式返回图片                                                                                                              |

### 5.3 上传 / 预览 / 下载（流式）

| 方法 | 路径                         | 权限              | 说明                                                                                                                                                          |
| ---- | ---------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST | /api/cloud/file/upload       | cloud:file:upload | multipart，字段名 `file`，query 带 `parentId`；单文件 ≤100MB（30004）；配额校验（30003）；同名自动"(1)"；多文件 = 前端逐文件调用（并发 ≤3）。挂 @OperationLog |
| GET  | /api/cloud/file/preview/:id  | cloud:file:list   | 流式预览：白名单类型 inline + 真实 mime，**支持 Range**；非白名单返回 30005；文本 >2MB 返回 30005                                                             |
| GET  | /api/cloud/file/download/:id | cloud:file:list   | 流式下载（attachment + 原文件名），支持 Range                                                                                                                 |
| GET  | /api/cloud/file/ticket/:id   | cloud:file:list   | 签发预览/下载直链票据（W7）：校验归属后返回 `{ previewUrl, downloadUrl, expiresIn }`（2h、单文件、HMAC，无状态）                                              |
| GET  | /api/cloud/file/stream/:id   | 免登录（@Public） | 票据直链流：query `ticket` + `uid` + `exp` + `mode=inline\|attachment`；校验签名与过期后复用 preview/download 输出链（Range 生效）；独立限流 600 次/分/IP     |

前两者校验数据归属当前用户（30001）。

**票据直链（W7）**：签名素材 `fileId.userId.exp`，HMAC-SHA256（secret 复用 `jwt.accessSecret`）；票据失效统一返回 30001「预览链接已失效」。前端把 `previewUrl` 交给 `<img>/<video>/<iframe>`、`downloadUrl` 交给浏览器原生下载 —— Range 秒开、可拖动进度、断点续传、零内存驻留。在线编辑器读文本原文仍走 `preview/:id`（Blob，文本 ≤2MB）。

### 5.4 回收站

| 方法   | 路径                       | 权限                  | 说明                                                                                                                              |
| ------ | -------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| GET    | /api/cloud/recycle/list    | cloud:recycle:list    | 无 parentId → **顶层被删项**；带 `parentId` → 只读浏览该被删文件夹内容（前置校验目标处于已删子树）。item 同 5.2，附加 `deletedAt` |
| GET    | /api/cloud/recycle/path    | cloud:recycle:list    | 被删文件夹内浏览的面包屑链（根固定为"回收站"）                                                                                    |
| POST   | /api/cloud/recycle/restore | cloud:recycle:restore | 入参 `{ id }`；R5：父目录可用还原原位、否则落根目录；同名自动"(1)"；响应 message 说明还原位置                                     |
| DELETE | /api/cloud/recycle/:id     | cloud:recycle:delete  | 彻底删除：递归整棵子树 + 物理删文件 + 连带删分享 + used 回扣，挂 @OperationLog                                                    |
| DELETE | /api/cloud/recycle/clear   | cloud:recycle:delete  | 清空回收站（全部顶层被删项同上处理），挂 @OperationLog                                                                            |

### 5.5 分享链接

> 术语口径（W2 统一）：P3 语境「分享链接」= cloud_share 表（有效期 + 计次 + 可停止）；P4c 语境「公开链接」= cloud_file.public_token（长期 + 文件自身属性）。二者是两个独立实体。

管理侧（登录）：

| 方法 | 路径                    | 权限               | 说明                                                                                                                                                                                    |
| ---- | ----------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST | /api/cloud/share/create | cloud:share:create | 入参 `{ fileId, expireDays }`（1/7/30/0，0=永久，缺省 7）；仅文件（30009）；审核门禁（R9，30010）；返回 `{ token, url, expireAt }`；同一文件重复创建 → 直接返回现存有效链接，不重复建行 |
| GET  | /api/cloud/share/list   | cloud:share:list   | 我的分享（**不分页**，创建时间倒序）：`[{ id, fileId, fileName, size, token, visitCount, expireAt, status, createTime }]`；status 由后端计算返回：1 有效 / 0 已停止 / 2 已过期          |
| POST | /api/cloud/share/stop   | cloud:share:stop   | 入参 `{ id }`，挂 @OperationLog                                                                                                                                                         |
| POST | /api/cloud/share/extend | cloud:share:stop   | 入参 `{ id, expireDays }`（档位同上）；从 max(now, expireAt) 续期；已停止的链接不可延长（30008）                                                                                        |

访客侧（**@Public 免登录**，独立限流 30 次/分/IP）：

| 方法 | 路径                             | 说明                                                                |
| ---- | -------------------------------- | ------------------------------------------------------------------- |
| GET  | /api/cloud/share/:token          | 链接信息 `{ fileName, size, expireAt, visitCount }`；无效统一 30008 |
| GET  | /api/cloud/share/:token/download | 流式下载（attachment），成功 visit_count+1；无效统一 30008          |

### 5.6 配额管理（admin）

| 方法 | 路径                   | 权限              | 说明                                                                                                                                                                       |
| ---- | ---------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PUT  | /api/cloud/admin/quota | cloud:admin:quota | 入参 `{ userId, quotaLimit, quotaUsed? }`（字节）；quotaLimit 下限 = 该用户当前 used（低于则 30001）；quotaUsed 选填（缺省不改动）；upsert（懒创建兼容），挂 @OperationLog |
| GET  | /api/cloud/admin/quota | cloud:admin:quota | 入参 `userId`；返回 `{ userId, quotaLimit, quotaUsed }`，供前端弹窗展示已用容量（下限）提示                                                                                |
| GET  | /api/cloud/admin/stats | cloud:admin:quota | 全局统计 `{ fileCount, totalUsed, activeUsers }`                                                                                                                           |

### 5.7 个人中心头像上传（P1 遗留补做，system 域）

| 方法 | 路径                            | 权限     | 说明                                                                                                                                                                                                                                                                                             |
| ---- | ------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST | /api/system/user/profile/avatar | 登录即可 | multipart，字段名 `file`；图片类型（jpg/jpeg/png/gif/webp/bmp/svg），≤5MB；落 StorageService.moveToStorage 后登记 cloud_file（头像记录，used 同步）→ 写回 sys_user.avatar；返回 `{ avatar }`（可访问 URL，前端 img 直接可用）；GET /api/auth/userinfo 的 user 对象同步携带 `avatar` 字段（已含） |

---

## 6. P4a 增补：个人网站（site 域 + 开放层）

### 6.1 错误码新增（40xxx 段，40101 起）

| code  | 含义                                                       | 前端处理           |
| ----- | ---------------------------------------------------------- | ------------------ |
| 40101 | 站点不存在或未开通                                         | 引导创建站点       |
| 40102 | slug 已被占用                                              | 提示更换           |
| 40103 | slug 格式非法或命中保留字                                  | 提示规则           |
| 40104 | 站点已停用                                                 | 后台提示           |
| 40105 | 站点根目录不可用（被删或已取消公开）/ 封面不在 media/ 前缀 | 提示去云盘检查目录 |
| 40106 | 栏目不存在                                                 | 刷新栏目列表       |
| 40107 | 栏目下存在子栏目或文章，不可删除                           | 提示先清空         |
| 40108 | 标签已存在                                                 | 提示更换名称       |
| 40109 | 文章不存在                                                 | 刷新文章列表       |
| 40110 | 评论不存在                                                 | 刷新评论列表       |
| 40111 | 评论提交过于频繁                                           | 提示稍后再试       |
| 40112 | 用户已开通个人网站，禁止删除（删用户预检）                 | 提示先删除站点     |

> 注：标签不存在（tag PUT/DELETE、文章 tagIds 含不存在项）复用通用 40400，不设细分码（T37 偏差登记，T40 备案）。

通用约定不变：bigint ID 序列化为字符串；时间为 ISO 字符串。**开放层（6.3）资源类失败（站点/文章/栏目不存在、站点停用、路径不存在）统一返回 40400 防探测**，不返回上表细分码；**三个例外**：参数校验失败 40001、限流 42900、评论间隔 40111（PRD-P4A 验收第 15 条明文）。

### 6.2 管理侧接口（/api/site，登录 + @RequirePermission，数据按当前用户隔离）

> 站点 CRUD 自 P4e 起迁至 §10.2（`/api/site/manage/*`）；本节仅保留栏目 / 标签 / 文章 / 评论等站点内容接口（内容端点自 P4e 起按 `siteId` 作用域化，见 §10.3）。

**栏目（site:column:\*）**

| 方法   | 路径                  | 权限               | 说明                                                                                            |
| ------ | --------------------- | ------------------ | ----------------------------------------------------------------------------------------------- |
| GET    | /api/site/column/list | site:column:list   | 平铺裸数组（前端组树，沿用平台惯例）：`[{ id, parentId, name, sort, articleCount, createdAt }]` |
| POST   | /api/site/column      | site:column:create | `{ parentId, name, sort? }`；≤3 级（R6），挂 @OperationLog                                      |
| PUT    | /api/site/column/:id  | site:column:update | `{ name?, sort?, parentId? }`；换父级禁止自身/后代且不得超 3 级，挂 @OperationLog               |
| DELETE | /api/site/column/:id  | site:column:delete | 有子栏目或文章 → 40107，挂 @OperationLog                                                        |

**标签（site:tag:\*）**

| 方法   | 路径               | 权限            | 说明                                             |
| ------ | ------------------ | --------------- | ------------------------------------------------ |
| GET    | /api/site/tag/list | site:tag:list   | 裸数组 `[{ id, name, articleCount, createdAt }]` |
| POST   | /api/site/tag      | site:tag:create | `{ name }`；重复 40108                           |
| PUT    | /api/site/tag/:id  | site:tag:update | `{ name }`，挂 @OperationLog                     |
| DELETE | /api/site/tag/:id  | site:tag:delete | 连带删 site_article_tag 关联，挂 @OperationLog   |

**文章（site:article:\*）**

| 方法   | 路径                         | 权限                 | 说明                                                                                                                                                                                                                  |
| ------ | ---------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | /api/site/article            | site:article:list    | 分页（PageResultDto）。筛选：columnId / tagId / status / keyword（标题模糊）；item `{ id, columnId, columnName, title, summary, coverPath, tagIds, wordCount, viewCount, status, publishedAt, createdAt, updatedAt }` |
| GET    | /api/site/article/:id        | site:article:list    | 详情，附加 `contentMd`                                                                                                                                                                                                |
| POST   | /api/site/article            | site:article:create  | `{ columnId, title, summary?, tagIds?, coverPath?, contentMd, status }`；summary 空自动取正文前 100 字；coverPath 必须 media/ 前缀（40105 口径校验）；字数后端统计落库（R14）。挂 @OperationLog                       |
| PUT    | /api/site/article/:id        | site:article:update  | 同 POST；挂 @OperationLog                                                                                                                                                                                             |
| PUT    | /api/site/article/:id/status | site:article:publish | `{ status }`（0 下架 / 1 发布）；首次发布写 published_at。挂 @OperationLog                                                                                                                                            |
| DELETE | /api/site/article/:id        | site:article:delete  | **物理删除**，连带标签关联与全部评论（R7）。挂 @OperationLog                                                                                                                                                          |

封面/正文配图上传：**复用** `POST /api/cloud/file/upload?parentId={mediaFolderId}&overwrite=1`（mediaFolderId 取自站点详情，见 §10.2 `GET /api/site/manage/:id`），无新接口；上传成功后公开 URL = `/api/open/{slug}/media/{文件名}`。

**评论（site:comment:\*）**

| 方法   | 路径                        | 权限                | 说明                                                                                                                                                              |
| ------ | --------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | /api/site/comment           | site:comment:list   | 分页（PageResultDto）。筛选：auditStatus / articleId / keyword（昵称模糊）；item `{ id, articleId, articleTitle, nickname, content, ip, auditStatus, createdAt }` |
| PUT    | /api/site/comment/:id/audit | site:comment:audit  | `{ auditStatus }`（1 通过 / 2 驳回）。挂 @OperationLog                                                                                                            |
| DELETE | /api/site/comment/:id       | site:comment:delete | 物理删除。挂 @OperationLog                                                                                                                                        |

### 6.3 开放层接口（/api/open，@Public 免登录，独立限流，CORS `*` + CORP cross-origin）

> 契约纪律：**v1 只增不改**（用户站点代码依赖这些接口）；除评论提交外全部只读；资源类失败统一 40400（例外同 §6.1 末行）；
> 数据接口限流 60 次/分/IP，静态限流 120 次/分/IP，评论提交 10 次/分/IP + 同文章同 IP 60 秒 1 条（40111）；
> 仅返回已发布文章与已过审评论；站点停用/不存在一律 40400。

| 方法 | 路径                                      | 说明                                                                                                                                                                                                                                                                                                 |
| ---- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET  | /api/open/:slug/api/site                  | 站点信息 `{ title, description }`                                                                                                                                                                                                                                                                    |
| GET  | /api/open/:slug/api/columns               | 栏目**嵌套树**（例外于平铺惯例，见 ARCHITECTURE.md §14.6）：`[{ id, name, sort, children: [...] }]`                                                                                                                                                                                                  |
| GET  | /api/open/:slug/api/tags                  | `[{ id, name }]`                                                                                                                                                                                                                                                                                     |
| GET  | /api/open/:slug/api/articles              | 分页。入参 columnId? / tagId? / keyword? / pageNo / pageSize（≤50）；返回 `{ list, total, pageNo, pageSize }`，item `{ id, title, summary, coverUrl, columnId, columnName, tags: [{ id, name }], wordCount, viewCount, publishedAt }`；coverUrl 为完整公开路径（无封面为 null）；按 publishedAt 倒序 |
| GET  | /api/open/:slug/api/articles/:id          | 详情：上项字段 + `contentMd`（markdown 原文，渲染由站点代码负责）；触发查看数（R8 窗口去重）                                                                                                                                                                                                         |
| GET  | /api/open/:slug/api/articles/:id/comments | 分页，仅已过审：`{ list: [{ id, nickname, content, createdAt }], total, pageNo, pageSize }`，按时间正序                                                                                                                                                                                              |
| POST | /api/open/:slug/api/articles/:id/comments | 提交评论。入参 `{ nickname(1~32), content(1~500) }`；落库待审（站点关审核则直过审）；成功返回统一提示文案"已提交，审核后展示"                                                                                                                                                                        |
| GET  | /api/open/:slug                           | 站点入口（= 根目录 index.html）                                                                                                                                                                                                                                                                      |
| GET  | /api/open/:slug/{*path}                   | 静态文件（nginx 语义，路径即 URL）：MIME 白名单 + CSP 沙箱 + ETag/304 + Range，规则见 ARCHITECTURE.md §14.4/§14.5                                                                                                                                                                                    |

### 6.4 cloud 域增量（公开机制，登录 + 权限）

| 方法 | 路径                               | 权限              | 说明                                                                                                                                                                                                                                                                                                       |
| ---- | ---------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST | /api/cloud/file/set-public         | cloud:file:public | 入参 `{ id, isPublic }`（1=设为公开 / 0=取消公开）；仅标自身不级联写。落库三态（R2 修订）：1→`1` 显式公开；0→`2` 显式阻断（**不是回到继承态**——公开目录下"取消公开"的语义即"此项目录内阻断"，祖先公开也不再继承）；新建文件默认 `0`=继承父目录。访问时上溯判定：遇第一个非继承节点定生死。挂 @OperationLog |
| POST | /api/cloud/file/upload?overwrite=1 | cloud:file:upload | 新增可选 query `overwrite`：=1 且同目录存在同名未删文件 → 物理替换（更新 size/mime/ext/storage_name/update_time，used 按差额调整，旧物理文件直接删除，不可恢复）；缺省维持自动"(1)"                                                                                                                        |
| GET  | /api/cloud/file/list               | cloud:file:list   | item `isPublic` 返回**原始三态 int**（0=继承 / 1=显式公开 / 2=显式阻断）；前端标签：1→「公开」、2→「已阻断」、0→无标签。有效公开性（祖先链裁决）不在列表逐行计算，以开放层访问结果为准                                                                                                                     |

### 6.5 system 域增量（删用户预检扩展）

`UserService.remove` 预检链扩展：`cloud.hasFiles`（30011）→ `site.hasSite`（40112）依次询问，任一命中阻止删除。无新接口。

---

## 7. P4b 增补：AI 站点工具 + 在线编辑 + 模板库

### 7.1 错误码新增

**site 段（续 40113~40119；40117 为 P4c 开放层码，见 §8.1）**

| code  | 含义                                                       | 前端处理                  |
| ----- | ---------------------------------------------------------- | ------------------------- |
| 40113 | 站点文件路径非法（越出站点根 / 含 `..` / 绝对路径 / 空段） | AI 工具回喂，无需前端处理 |
| 40114 | 文件类型不允许（非文本白名单扩展名）                       | AI 工具回喂               |
| 40115 | 内容超限（AI 写单文件 >256KB / 单次 >10 个 / 读 >64KB）    | AI 工具回喂               |
| 40116 | 模板不存在                                                 | 刷新模板列表              |
| 40118 | 站点数量已达上限（P4e R47，message 带 limit/used）         | 提示联系管理员调配额      |
| 40119 | 站点不存在或非属主（P4e）                                  | 刷新站点列表 / 切当前站   |

> 40118/40119 编号顺延说明见 §10.1（PRD 名义 40117/40118，40117 已被 P4c `CloudListingDisabled` 占用）。

**cloud 段（续 30012~30013）**

| code  | 含义                                     | 前端处理           |
| ----- | ---------------------------------------- | ------------------ |
| 30012 | 该文件类型不支持在线编辑（非文本白名单） | 提示"请下载后编辑" |
| 30013 | 内容超出在线编辑上限（1MB）              | 提示"请下载后编辑" |

> 备案（P4a 走查 W5）：标签不存在维持通用 40400，不设细分码。

### 7.2 site 域新增：模板库（site:site:manage）

| 方法 | 路径                | 说明                                                                                                            |
| ---- | ------------------- | --------------------------------------------------------------------------------------------------------------- |
| GET  | /api/site/templates | 模板列表 `[{ id, name, description }]`（id = 模板目录名，读 assets/site-templates/*/template.json，实时不缓存） |

> 应用模板已随 P4e 命名空间收敛迁至 **`POST /api/site/manage/:id/apply-template`**（路径参数站点化，契约见 §10.3；原 `/api/site/mine/apply-template` 已废弃，见 §10.1）。

### 7.3 cloud 域增量（在线编辑 + 走查 W2 口径修订）

| 方法 | 路径                        | 权限              | 说明                                                                                                                                                                                                                |
| ---- | --------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PUT  | /api/cloud/file/:id/content | cloud:file:upload | 在线编辑保存。入参 `{ content }`；仅文本白名单扩展名（30012）、内容 ≤1MB（30013）；**更新行语义**（fileId/URL 不变，used 差额记账，旧物理文件删除不可回滚；开放层立即生效）。挂 @OperationLog                       |
| GET  | /api/cloud/file/list        | cloud:file:list   | **口径修订（走查 W2，T43 生效）**：item 的 `isPublic` 由布尔改为**原始三态 int**（0=继承 / 1=显式公开 / 2=显式阻断）；前端 1→「公开」、2→「已阻断」、0→无标签。有效公开性以开放层访问时上溯判定为准，列表不逐行算链 |

### 7.4 AI 工具增量（非 HTTP 接口，入册备查；调用机制见 §4 P2b）

| name             | risk  | perms            | 说明                                                                                                                                                                             |
| ---------------- | ----- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| list_site_files  | read  | site:site:manage | 列我的站点文件树（无参数；深度 ≤10、上限 500 条、不含回收站）；未开通站点回喂 40101 引导文案                                                                                     |
| read_site_file   | read  | site:site:manage | 读站点文本文件（白名单扩展名、≤64KB）                                                                                                                                            |
| write_site_files | write | site:site:manage | 批量写站点文件（1~10 个 / 单文件 ≤256KB / 白名单扩展名）；同路径软删旧版 + 新建（回收站可回滚）；中间目录 mkdir -p 逐段复用；写完精确失效 site:path 缓存；部分成功返回逐文件明细 |

**工具框架扩展（§4 增补）**：AiTool 新增可选 `summarize?: (params, ctx) => any`——write 工具的确认卡结构化摘要（write_site_files 返回 `[{ path, action, size }]`，卡片渲染为文件清单，action 为预判、以执行时实际为准；ctx 供按当前用户查数据）；缺省维持 P2b 字符串摘要，既有工具零改动。summary 存确认单与 tool_confirm 事件，ai_tool_call.params 仍存原始 params；恢复链路对 pending write 按 params 重算。

### 7.5 开放层响应头修订（D28，对 §6.3 的修订）

开放静态资源 Cache-Control 由「html no-cache、白名单 public max-age=3600」**统一改为 `no-cache`**（ETag/304 协商保留不变）。理由：AI/编辑器高频迭代要求改完立即可见；未变资源仅 304 头部零字节体，个人站点量级成本可接受。CSP sandbox / nosniff / CORS / CORP 均不变。

## 8. P4c：云盘公开链接 + 公开访问端点 + 在线解压

### 8.1 错误码新增

| code  | 含义                   | 前端处理       |
| ----- | ---------------------- | -------------- |
| 40117 | 该文件夹未开放列表浏览 | 提示不开放浏览 |

> 40400（公开资源类统一防探测码）与 42900（限流）复用既有通用码，无新增。

### 8.2 cloud 域管理侧增量（T46，均 `cloud:file:public` 权限 + @OperationLog）

| 方法   | 路径                       | 说明                                                                                                                                                                                                                                                                                                                                                  |
| ------ | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | /api/cloud/file/:id/public | 设为公开并获取公开链接。body 仅文件夹可传 `{ allowListing }`（缺省 true；仅文件夹有意义）；**幂等**（已公开且已有 token 返回既有 token，allowListing 参数仍生效）；审核门禁照 R9 口径（开关开启且未过审 → 30010）。响应 `{ publicToken, viewUrl, allowListing }`：文件 viewUrl=`/view/f/{token}`、allowListing=null；文件夹 viewUrl=`/view/d/{token}` |
| DELETE | /api/cloud/file/:id/public | 取消公开（R27：public_token 置空 + is_public 归 0=继承；旧链接立即 40400，重新公开生成**新** token）。响应 `data: null`                                                                                                                                                                                                                               |
| GET    | /api/cloud/file/list       | **口径扩展（T46）**：item 新增 `publicToken`（string\|null，仅 isPublic=1 时有值）、`allowListing`（0\|1，仅文件夹有意义）                                                                                                                                                                                                                            |

> 既有 `POST /api/cloud/file/set-public`（P4a 语义：isPublic 二元入参、0→显式阻断）**保留不动**，站点公开目录机制依赖。
> 软删轮换（D30）：带 token 的行进回收站时 token 同步置空（isPublic 不动，保护站点根锚点）——旧链接 40400，还原后仍 40400，重新公开得新 token。

### 8.3 公开访问端点（免登录，前缀 /api/pub，@Public）

统一纪律：独立限流桶（raw/download **静态 120 次/分/IP**，info/list **数据 60 次/分/IP**，超限 42900——限流是 40400 防探测口径的唯一例外，与站点开放层一致）；资源类失败统一 **40400**（HTTP 200 + 统一体 code，不区分原因防探测）；`Cache-Control: no-cache` + ETag（304）；raw/download 为流式响应（@SkipTransform，不走统一响应体），支持 Range（bytes=start-end / start- / -N → 206 + Content-Range；语法非法回 200 全量；越界 416）。

| 方法 | 路径                              | 说明                                                                                                                                                                                                               |
| ---- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET  | /api/pub/f/{token}/info           | 公开文件元信息 `{ name, size, mime, ext, updatedAt }`                                                                                                                                                              |
| GET  | /api/pub/f/{token}/raw            | 文件流（inline）。R26 MIME：文本类强制 `text/plain; charset=utf-8`；html/htm/svg 强制 attachment（octet-stream）；图片/音视频（R7 扩展 webm/ogg/wav/m4a）/PDF inline 真实 MIME；白名单外 octet-stream + attachment |
| GET  | /api/pub/f/{token}/download       | 文件流（attachment + `filename*=UTF-8''` 原名 + ASCII 兜底）                                                                                                                                                       |
| GET  | /api/pub/d/{token}/list?path=     | 公开文件夹**单层**列表 `{ path, items: [{ name, isDir, size, ext, updatedAt }] }`（文件夹在前、名称字典序）；`allow_listing=0` → **40117**                                                                         |
| GET  | /api/pub/d/{token}/info?path=     | 文件夹内子文件元信息（path 指向目录或缺省 → 40400）                                                                                                                                                                |
| GET  | /api/pub/d/{token}/raw?path=      | 子文件流（inline 口径同 f raw）                                                                                                                                                                                    |
| GET  | /api/pub/d/{token}/download?path= | 子文件流（attachment）                                                                                                                                                                                             |

> **判定链**（每端点统一）：token 查 cloud_file（`deletedAt null` 且 `is_public=1`）→ 祖先上溯（任一祖先 `is_public=2`，或祖先行缺失/已删 → 40400，R25）→ path 逐段下行（任一段不存在或 `is_public=2`（阻断不继承）→ 40400；有界 ≤10 层，拒 `..`/反斜杠/非法编码）。allow_listing 校验仅作用于 list 端点（关闭列表后知道完整路径的子文件仍可达，D32）。
> 前缀 `/api/pub/` 与 `/api/open/` 并列（D31 零歧义）；main.ts 开放层 CORP 改写与 CORS 反射已同步覆盖 `/api/pub`。

### 8.4 在线解压（cloud:file:upload 权限 + @OperationLog('云盘','在线解压')）

| 方法 | 路径                      | 说明                                                                                                                                                                                                                                                                                                                           |
| ---- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST | /api/cloud/file/:id/unzip | 在线解压（无请求体，同步执行，前端 timeout 0）。校验：目标为 zip 且 size ≤ CLOUD_MAX_FILE_SIZE（30014）→ 包名文件夹深度/父目录子项数（30006）→ 逐条解压（Zip Slip 30016 / 条目数与累计总大小 30015 / 配额 30003）。响应 `{ folderId, folderName, fileCount, totalSize }`。解压目标 = 同目录下包名文件夹（R31，同名自动 "(1)"） |

> 安全四件套（R29）与 tmp 中转事务（D36/R30）见 ARCHITECTURE.md §16.4。批量拖拽上传（T48）为纯前端能力（并发 3 调既有单文件上传接口，D34），无新接口。

## 9. P4d：移动 + 打包下载 + 分享升级 + 公开语义分流

> 移动的剪切/粘贴/拖拽、多选批量（批量删除/批量移动）、公开语义分流（按钮组按 `inSite`）均为**前端能力**，后端只提供本节所列接口与字段。
> 章节号接 §8；增补文档 `docs/P4D/API-P4D-增补.md` 已并入（保留为历史参考，冲突以本文为准）。

### 9.1 错误码新增（30xxx 段，续接 30016 之后；30020 为 P4e R52 追加）

| code  | 含义                                                         | 前端处理     |
| ----- | ------------------------------------------------------------ | ------------ |
| 30017 | 该分享需要提取码（未验证或凭证过期）                         | 跳密码门禁页 |
| 30018 | 提取码错误（含连续 5 次锁 10 分钟，message 带剩余次数/秒数） | 门禁页提示   |
| 30019 | 非法移动目标（移入自身子树 / 站点根 / 回收站）               | 提示         |
| 30020 | 站点根目录禁止直接删除（须先删除站点，P4e R52）              | 提示先删站   |

### 9.2 移动（登录态，`cloud:file:upload` + @OperationLog('云盘','移动')）

`POST /api/cloud/file/:id/move`

请求：

```json
{ "targetParentId": "1234567890", "confirmPublic": false }
```

响应：

```json
{
  "code": 0,
  "message": "success",
  "data": { "id": "...", "name": "文档.md", "finalName": "文档(1).md", "targetPublic": true }
}
```

- `targetPublic: true` 且未带 `confirmPublic` → **不执行移动**，仅返回标记（前端弹 R39 公开继承警告）；带 `confirmPublic: true` 重发才执行
- 「已执行」的判定：`targetPublic === false` 或请求带了 `confirmPublic: true`
- 目标可为根目录（`targetParentId: "0"`）；同父目录移动 → 幂等返回（不改名不写库）
- 批量移动 = 前端队列逐条调用（D42）；批量遇公开目标**整批一次确认**
- 失败码：30001（不存在/无权/目标非目录）、30019（自身子树 / 站点根 / 回收站项 / 回收站目标）、30006（目标目录 500 项上限 / 目标深度+源子树高度 >10）
- 移动不改 used；公开性按新父目录上溯重新判定；`public_token` 挂 fileId 不受影响（D30）

### 9.3 打包下载（登录态，`cloud:file:list`，@SkipTransform 流式）

`POST /api/cloud/file/pack-download`

请求：`{ "ids": ["id1", "id2", ...] }`（1~100 项，文件/文件夹混合）

- 响应：`application/zip` 流式（yazl，零落盘）；`Content-Disposition: attachment; filename="iplat-pack-yyyyMMdd-HHmm.zip"; filename*=UTF-8''…`；`Cache-Control: no-store`
- zip 内保持目录结构（目录递归展开，有界 ≤10 层），条目名由 yazl 统一置 UTF-8 flag（Windows 解压不乱码）；条目总数超 5000 截断并记运行日志
- 回收站项 / 不存在项 / 超 `CLOUD_MAX_FILE_SIZE` 的条目跳过，响应头 `X-Pack-Skipped: n` 计数；无有效条目 → 30001（不下载空包）
- 管理侧视角：打包自有文件**不查三态**（自己的文件自己的包）
- 前端：多选工具栏「打包下载」触发，经 axios Blob 下载（自动带 token + 401 静默刷新）

### 9.4 file.list 响应扩展

`GET /api/cloud/file/list` 行内新增：

| 字段         | 类型    | 说明                                                                     |
| ------------ | ------- | ------------------------------------------------------------------------ |
| `inSite`     | boolean | 是否位于站点子树内（含站点根本身）；R46/D49：前端据此分流公开/私有按钮组 |
| `isSiteRoot` | boolean | 是否站点根目录；R45：站点根恒公开锚点，无「设为私有」                    |

`shared` 口径扩展（D48）：文件夹亦可分享，目录与文件一并统计有效分享。

### 9.5 分享升级

#### 管理侧（登录态，既有接口扩展）

| 方法 | 路径                          | 说明                                                                                                                                                         |
| ---- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST | /api/cloud/share/create       | body 加 `password?: string`（4~8 位，留空 = 无密码）；`fileId` 可为**文件夹**（D48）；响应加 `hasPassword: boolean`                                          |
| GET  | /api/cloud/share/list         | item 加 `itemType: 'file'\|'folder'`、`hasPassword: boolean`、`password: string\|null`（**仅本人列表回显明文**；密文解不开时 null）；`status` 缺省排除已停止 |
| POST | /api/cloud/share/:id/password | 修改 / 移除提取码（body `{ password: string\|null }`，null 或空 = 移除）；响应 `{ id, hasPassword, password }`；变更后旧访问凭证失效                         |

> W5（提取码可见）：`list` 的 `password` 由 `cloud_share.password_enc` 用 AES-256-GCM 解密得到（密钥由 `jwt.accessSecret` 派生），只对分享创建者本人返回；历史数据/密钥轮换后为 `null`，前端按「已设置（不可回显）」展示。访客校验链路仍走 `password_hash`（bcrypt），不受影响。

> 权限：`:id/password` 复用 `cloud:share:create`（分享内容的创建/编辑一体），不新增权限标识与菜单。
> 注：P3 的 30009「文件夹暂不支持创建分享链接」自 P4d 起不再触发（D48 支持文件夹分享），常量保留备用。

#### 访客侧（@Public，独立限流 30 次/分/IP 沿用）

| 方法 | 路径                               | 说明                                                                                                                                                                                                                                                        |
| ---- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST | /api/cloud/share/:token/verify     | body `{ password }` → 签发短期凭证；无密码分享直通；响应 `{ sid, expiresIn, needPassword }`；错误 30018（连续 5 次锁 10 分钟）                                                                                                                              |
| GET  | /api/cloud/share/:token            | info：`fileName/itemType/size/mime/ext/updatedAt/expireAt/visitCount/needPassword`；`path` 可选 = 文件夹内子项；未过密码门 → 30017                                                                                                                          |
| GET  | /api/cloud/share/:token/raw        | 文件流 inline + Range；MIME 口径 R44 同 R26（html/htm/svg 强制 attachment）；`path` 可选                                                                                                                                                                    |
| GET  | /api/cloud/share/:token/list?path= | 文件夹分享单层列表（动态子树 R43：新增即见/删除即消失；`is_public=2` 项过滤不可见）；响应 `{ path, items: [{ name, isDir, size, ext, updatedAt }] }`                                                                                                        |
| GET  | /api/cloud/share/:token/download   | 文件 attachment + Range（既有，扩展 `path`）；成功 `visit_count+1`（raw 不计次）                                                                                                                                                                            |
| GET  | /api/cloud/share/:token/pack       | 文件夹整包 zip（流式；访客视角过滤阻断项与子树）；`Content-Disposition: attachment; filename="<ASCII 兜底>.zip"; filename*=UTF-8''<源文件夹名>.zip`；**前端经 fetch + Blob 下载**（可带请求头凭证、显示加载态、错误转提示，避免服务端错误被导航渲染成白页） |

- 凭证携带：请求头 `X-Share-Sid`；**媒体类原生子资源（video/img/iframe/a download）无法带自定义头，故等价接受 `?sid=` 查询参数**
- sid 有效期：Redis `share:pass:{token}:{sid}`，TTL = min(2h, 分享剩余有效期)
- 失效口径沿用：过期/停止/源删除 → 30008；限流 → 42900；未过密码门 → 30017
- 文件夹分享为**动态子树**语义：分享后向内新增内容访客即可见，删除即消失（`is_public=2` 显式阻断项及其子树对外不可见，R43）

### 9.6 公开语义分流（D49/R45，无新接口）

- 前端按 `file.list` 的 `inSite` 切换按钮组：站点子树内 = 「设为私有 / 取消私有」（站点根无按钮），站点外 = 「设为公开 / 复制公开链接 / 取消公开」
- 旧 `POST /api/cloud/file/set-public` **保留**（站点机制与开放层依赖），前端仅站点子树内调用（语义 = 设为私有，落库 is_public=2）；「取消私有」走 `DELETE /api/cloud/file/:id/public`（is_public 归 0=继承）

## 10. P4e：多站点（配额化）+ 删站 + AI 多站语义 + sid 脱敏

> 决策 D51~~D57 / 规则 R47~~R57，见 PRD-P4E-SITE.md。增补文档 `docs/P4E/API-P4E-增补.md` 已并入（保留为历史参考，冲突以本文为准）。
> **错误码实际编号**：PRD 名义为 40117（配额满）/40118（不存在或非属主），但 40117 已被 P4c `CloudListingDisabled` 占用，故实际取 **40118（配额满）/ 40119（站点不存在或非属主）**；30020 为 R52 新增。40101 收窄为仅「未开通站点」。
> **路径口径**：站点 CRUD 收在命名空间 **`/api/site/manage/*`**（非 `/api/site/list` 与 `/api/site/:id`）——顶层参数段会吞掉 `/api/site/article`、`/api/site/comment`、`/api/site/templates` 等同层静态路由，详见 10.2 注。

### 10.1 变更总览

- **废弃**：`GET/POST/PUT /api/site/mine`、`POST /api/site/mine/apply-template`（D52 无兼容期，前端同期切换）
- **替代**：站点集合端点（10.2）；内容端点全部 siteId 作用域化（10.3）
- **新增**：删站、admin 配额（10.2 / 10.4）、AI `create_site` 工具（10.7）

### 10.2 站点 CRUD（登录态，`site:site:manage`；写操作挂 `@OperationLog('个人网站', xxx)`）

> **命名空间 `/api/site/manage/*`**：站点级资源（集合与单体）全部收在此前缀下，`/api/site/*` 顶层只保留静态段（templates / column / tag / article / comment / admin）。
> 这样 `GET/PUT/DELETE /api/site/manage/:id` 三态对称，且不会有参数段吞掉静态段的问题（详见本节末说明）。

| 方法   | 路径                                | 说明                                                                                                                                                                                                                                                                                   |
| ------ | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | /api/site/manage/list               | 我的站点列表（不分页，上限即配额）：`{ list: [{ id, slug, title, description, status, commentAudit, siteUrl, rootFolderId, mediaFolderId, articleCount, createdAt }], limit, used }`；按创建时间升序（第一站语义稳定）                                                                 |
| GET    | /api/site/templates                 | 模板列表（既有端点，P4b；读取 `assets/site-templates`，实时不缓存）                                                                                                                                                                                                                    |
| POST   | /api/site/manage                    | 建站：`{ slug, title, description? }`；slug 规则 `^[a-z0-9][a-z0-9-]{2,31}$` + 保留字黑名单（40103）+ 全局唯一（40102）；**配额满 40118**（R47）；创建链同 §6（cloud 建根目录——**根目录名 = slug**（D57）——+ `media/` 子目录 + 模板四件套 + 落库；任一步失败 `discardSiteDraft` 回滚） |
| GET    | /api/site/manage/:id                | 站点详情（字段同 list item，含 `articleCount`）；非属主 40119                                                                                                                                                                                                                          |
| PUT    | /api/site/manage/:id                | 编辑 `{ title?, description?, slug?, status?, commentAudit? }`；改 slug 同规则校验 + `DEL site:resolve:{旧slug}` + `scanDel site:data:{siteId}:*`；status=0 停用即开放层全 40400                                                                                                       |
| DELETE | /api/site/manage/:id                | **删站**（R50/R53/R55）：site 域六表数据物理删 + 站点根连同子树软删进回收站（used 不动，可还原为普通文件夹）+ 缓存三族清理 + slug 立即释放；响应 `{ deletedArticles, recycledRoot: true }` 供前端结果提示                                                                              |
| POST   | /api/site/manage/:id/apply-template | 应用模板（body `{ templateId }`；温和覆盖 R20 不变）                                                                                                                                                                                                                                   |
| GET    | /api/site/admin/quota?userId=       | 见 10.4                                                                                                                                                                                                                                                                                |
| PUT    | /api/site/admin/quota               | 见 10.4                                                                                                                                                                                                                                                                                |

> **为什么不用 `GET/PUT/DELETE /api/site/:id`**（T65 实测发现、T65 后调整）：Express 按注册顺序匹配，`/site/` 顶层的参数段 `:id` 会命中 `/api/site/article`（文章列表）、`/api/site/comment`（评论列表）、`/api/site/templates`（模板列表）并因 `ParseIntPipe` 直接 400；这些控制器分属不同模块、注册顺序不可控，无法靠调顺序稳定解决。收敛到 `/api/site/manage/*` 后，顶层静态段永久安全，**后续新增 `/api/site/<静态段>` 路由也不会再踩坑**。
> **顶层已无任何参数段**：应用模板原为 `POST /api/site/:id/apply-template`，已随本次调整收进 `POST /api/site/manage/:id/apply-template`（2026-09-13）。现在 `/api/site/*` 顶层只有：平台级模板库 `templates`、内容子资源 `column|tag|article|comment`、管理员能力 `admin/quota`。

### 10.3 内容端点 siteId 作用域化（T61）

> 通用约定：list/create 类以请求 siteId 为准（属主校验 40119）；update/delete 按实体 id 反查所属站点再校验属主，**不信任**请求里的 siteId。

| 端点                                                    | 变更                                                                                             |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| GET /api/site/column/list                               | 必带 `?siteId=`（缺失 40001，非属主 40119）                                                      |
| POST /api/site/column                                   | body 加 `siteId`                                                                                 |
| PUT/DELETE /api/site/column/:id                         | 不变（实体反查属主）                                                                             |
| GET /api/site/tag/list                                  | 必带 `?siteId=`                                                                                  |
| POST /api/site/tag                                      | body 加 `siteId`                                                                                 |
| PUT/DELETE /api/site/tag/:id                            | 不变（实体反查）                                                                                 |
| GET /api/site/article（分页）                           | 必带 `?siteId=`；筛选 `columnId/tagId/status/keyword` 不变                                       |
| GET /api/site/article/:id                               | 不变（实体反查）                                                                                 |
| POST /api/site/article                                  | body 加 `siteId`                                                                                 |
| PUT /api/site/article/:id、PUT /:id/status、DELETE /:id | 不变（实体反查）                                                                                 |
| GET /api/site/comment（分页）                           | 必带 `?siteId=`；筛选 `auditStatus/articleId/keyword` 不变                                       |
| PUT /api/site/comment/:id/audit、DELETE /:id            | 不变（实体反查）                                                                                 |
| POST /api/site/manage/:id/apply-template                | 路径参数站点化（替代原 `/mine/apply-template`）；模板规则 R20 不变（T65 后收进 manage 命名空间） |

封面上传不变：复用 `POST /api/cloud/file/upload?parentId={mediaFolderId}&overwrite=1`，`mediaFolderId` 取自**当前站点**（前端由 `useSiteStore.currentSite` 提供）。

### 10.4 admin 配额（`site:admin:quota`，超管 `*` 自动覆盖，common 不授）

| 方法 | 路径                          | 说明                                                                                                                      |
| ---- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| GET  | /api/site/admin/quota?userId= | `{ userId, limit, used }`（used = 当前站点数）                                                                            |
| PUT  | /api/site/admin/quota         | `{ userId, limit }`；**下限 = used**（R48，低于下限 40001）；懒创建 upsert；挂 `@OperationLog('个人网站','调整站点配额')` |

### 10.5 cloud 域既有端点的行为变化（无新端点）

- `file.list` 响应的 `inSite/isSiteRoot` 扩展为**任一**站点子树/根语义（R51，前端无感）
- `POST /cloud/file/:id/move`：目标或源为任一站点根 → 30019（既有码，判定范围扩大）
- `DELETE /cloud/file/:id` 及批量删除/回收站入口：命中任一站点根 → **30020**（R52 新增拦截，提示先到站点列表删站）
- `POST /cloud/share` 等分享端点：不变（分享语义与站点公开本就解耦，P4d D49）

### 10.6 开放层（无变化）

`/api/open/{slug}/...` 与 `/api/pub/...` 契约不变；多站仅意味着更多合法 slug。`site:resolve` 缓存键天然按 slug 隔离。

### 10.7 AI 工具参数契约（供 ToolRegistry 注册，非 HTTP 端点）

| 工具                                                | parameters                      | 回喂要点                                                                                                                                                                                               |
| --------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| list_site_files / read_site_file / write_site_files | 加 `slug?: string`              | 省略：0 站 → `{ ok:false, errorCode:40101, message: 引导建站 }`；1 站 → 直通；多站 → `{ needSitePick:true, sites:[{slug,title}], message }`。指定：查无 → `{ ok:false, errorCode:40119, sites:[...] }` |
| create_site（新，write 确认卡）                     | `{ slug, title, description? }` | 成功 `{ ok:true, site:{ slug, title, siteUrl } }`；失败 `{ ok:false, errorCode:40118\|40102\|40103, message, limit?, used? }` 不抛栈（R57）；`summarize` = 「创建站点 {slug}（{title}）」              |

> `write_site_files` 的确认卡摘要每项携带 `{ site: { slug, title } }`，前端 `ToolConfirmCard` 渲染「目标站点」行（验收 8）。

### 10.8 sid 日志脱敏（D56，非接口变更）

日志中的 URL 统一经 `maskSensitiveQuery`（`sid`/`password` → `***`）：落点为全局异常日志与操作日志落库 `url`；Nginx 侧口径见 `deploy/nginx.conf`（不使用含 `$args` 的 log_format）与 README。

## 11. P4F：配额对账 + 回收站自动清理

> 决策 D58~~D61 / 规则 R58~~R62，见 PRD-P4F-CLOUD.md。增补文档 `docs/P4F/API-P4F-增补.md` 已并入（保留为历史参考，冲突以本文为准）。**本期零新错误码**（参数错误复用 40001 / 不存在复用 40400，权限复用 `cloud:admin:quota`）。

### 11.1 变更总览

- **新增**：配额对账诊断 + 修正两端点（管理侧，11.2）
- **行为变化（无接口变更）**：回收站超 N 天行每日 03:30 自动物理清除（默认 30 天；`CLOUD_RECYCLE_RETENTION_DAYS` / `CLOUD_RECYCLE_CLEAN_ENABLED`，见 11.3）
- **前端行为修复（无接口变更）**：ElMessageBox 中文化（全局 locale）、`download(row)` Blob 回收口径统一走 `saveBlob`、guard.ts 调试日志收敛、云盘「配额」按钮对 admin 行放开（R62）

### 11.2 配额对账（登录态，`cloud:admin:quota`）

| 方法 | 路径                                     | 说明                                                                                                                                                                                                                                                                                                                                                      |
| ---- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET  | /api/cloud/admin/usage-reconcile?userId= | 诊断（只读）。`userId` 缺省 = 全用户。单用户响应：`{ userId, stored, expected, diff, parts: { active: {count,bytes}, recycled: {count,bytes}, revertedAvatars: {count,bytes} } }`；全用户 = 上述对象的数组。`expected = active.bytes + recycled.bytes − revertedAvatars.bytes`（R60），`diff = expected − stored`；三段均为 SQL 聚合（COUNT/SUM），不拉行 |
| PUT  | /api/cloud/admin/usage-reconcile         | 修正。body `{ userId }`；服务端重算后写 `cloud_usage.used = expected`（行不存在懒创建，quota 取默认配额）；响应 `{ userId, oldUsed, newUsed, diff }`；挂 @OperationLog('云盘','配额对账修正')（R61）；只写 used 一个字段，不动任何文件行                                                                                                                  |

口径要点：

- **「已回退头像行」识别口径**（R60，以实现为准）：`parent_id = -1` 且 `deleted_at` 非空——换头像时 `CloudFacade.saveAvatar` 已回退其 used，故这些字节不在 used 内，须从公式中扣除
- `userId` 不存在 → 40400（「目标用户不存在」）；全用户模式返回 `cloud_usage` 行 ∪ 文件行 的属主集合（含"无 usage 行但留了文件"的历史用户）
- 前端入口：用户管理「调整配额」弹窗内嵌一行（打开弹窗并行拉诊断；`diff ≠ 0` 出「按公式值修正」按钮 + 二次确认，`diff = 0` 显示「一致」），不新开页面（D59）

### 11.3 回收站自动清理（无 HTTP 端点）

- 纯 cron 行为（每日 03:30，`modules/cloud/recycle/recycle-clean.task.ts`），规则 R58/R59
- 保留天数 `CLOUD_RECYCLE_RETENTION_DAYS`（默认 30）；总开关 `CLOUD_RECYCLE_CLEAN_ENABLED`（默认开，关闭时空跑只记一条日志）
- 用户可感知口径进 PLATFORM-GUIDE：「回收站内容删除满 30 天自动彻底清除」
- 验收复现路径：DB 改 `deleted_at` 构造超期行 + 手动触发 task 方法（或临时调短 N），勿等真实隔天

## 12. P5：AI 能力扩展（工具 11→25 + 预算动态化）

> 决策 D62~~D66 / 规则 R63~~R68，见 `docs/P5/PRD-P5-AI.md`。增补文档 `docs/P5/API-P5-增补.md` 已并入（保留为历史参考，冲突以本文为准）。
> **本期零新 HTTP 端点、零新错误码**：AI 工具经既有 SSE 通道（`/api/ai/chat` + `/api/ai/tool/confirm`，机制见 §4）交互，回喂复用各域既有码（30001/30003/30006/30012/30013/30019/30020/40001/40101/40102/40103/40106/40109/40119/20014~20016 等）。

### 12.1 配置增量（ai 配置组，`apps/api/src/config/ai.config.ts`）

| 配置               | env                  | 默认         | 说明                                                                                                 |
| ------------------ | -------------------- | ------------ | ---------------------------------------------------------------------------------------------------- |
| `ai.maxToolRounds` | `AI_MAX_TOOL_ROUNDS` | 3（上限 10） | 单轮用户消息的工具调用轮次上限（D65，替代 chat.service 原硬编码常量）；越界/非法回退默认值，每次现读 |

**P11 增补：app 配置组**（`apps/api/src/config/app.config.ts`，env 前缀 `APP_*`，均可不配；见 §18.5 与 ARCHITECTURE §27.8）：
`app.maxAppsPerUser=10` / `app.maxDraftsPerUser=3` / `app.maxTablesPerApp=20` / `app.maxRowsPerTable=50000` /
`app.maxPagesPerApp=50` / `app.maxAttachmentSize=10MB` / `app.maxImportSize=5MB` / `app.hotIndexFieldsPerTable=5` /
`app.queryTimeoutMs=2000` / `app.draftTtlDays=7`。

### 12.2 工具参数契约（供 ToolRegistry 注册，非 HTTP 端点）

通用约定：write 类全走确认卡（`summarize` 结构化摘要，中文标签）；失败回喂 `{ ok:false, errorCode, message }` 不抛栈；
带 `slug?` 的站点工具经 `resolveSiteForTool` 四分支解析（0 站 40101 引导 / 1 站直通 / 多站 needSitePick / 查无 40119+站点列表，R56）。

**云盘（perms 复用对应管理端点标识；基点 = 用户云盘根）**

| 工具               | risk / perms              | parameters                         | 成功返回要点                                                                                                                        |
| ------------------ | ------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| list_cloud_files   | read / cloud:file:list    | `{ path?, recursive? }`            | `{ path, items:[{ name, path, isDir, size, ext, updatedAt, inSite }], truncated, quota:{ used, limit } }`                           |
| read_cloud_file    | read / cloud:file:list    | `{ path }`                         | `{ path, size, content }`（文本白名单 ≤64KB）                                                                                       |
| write_cloud_file   | write / cloud:file:upload | `{ path, content }`                | `{ path, action: created\|overwritten, size }`；摘要复用「文件清单」表格（path/action/size）                                        |
| move_cloud_files   | write / cloud:file:upload | `{ moves:[{ from, to }] }`（1~20） | 逐条 `{ from, to, finalPath, ok, error?, targetPublic? }`（部分成功语义，照 write_site_files 先例；`to` = 目标目录，自动 mkdir -p） |
| delete_cloud_files | write / cloud:file:delete | `{ paths:[] }`（1~20）             | 逐条 `{ path, ok, error? }`；摘要明示「进回收站，可还原」                                                                           |

**站点 CMS**

| 工具                 | risk / perms                 | parameters                                                                         | 要点                                                                                                                                                                                                                                                                        |
| -------------------- | ---------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| list_site_articles   | read / site:article:list     | `{ slug?, columnId?, status?, keyword?, page? }`                                   | `{ site, total, pageNo, pageSize, articles:[...] }`（摘要不含 contentMd，pageSize ≤20）                                                                                                                                                                                     |
| read_site_article    | read / site:article:list     | `{ slug?, id }`                                                                    | `{ site, article }`（含 contentMd；超 64KB → truncated=true；slug 与文章实际站点不符 → 40109）                                                                                                                                                                              |
| create_site_article  | write / site:article:create  | `{ slug?, columnId?, title, contentMd, summary?, tagNames?, status?, coverPath? }` | status 缺省 0 草稿（D63）；status=1 摘要带「发布即公开可见」警示行；columnId 缺省时本站唯一栏目直达、多栏目回喂 40001+栏目清单、无栏目提示先 ensure；coverPath 见 §13.5（P6）；返回 `{ ok, site, id, title, columnId, columnName, tagNames, coverPath, status, wordCount }` |
| update_site_article  | write / site:article:update  | `{ slug?, id, title?, contentMd?, columnId?, tagNames?, summary?, coverPath? }`    | 部分更新；`tagNames` 提供即整体替换（**显式空数组 = 清空全部标签**）；coverPath 提供空串 = 清除封面（P6 §13.5）；无字段 → 40001                                                                                                                                             |
| publish_site_article | write / site:article:publish | `{ slug?, id, status }`                                                            | 上下架；上架摘要带公开警示；published_at 口径沿用（首次发布写）                                                                                                                                                                                                             |
| ensure_site_column   | write / site:column:create   | `{ slug?, name, parentId? }`                                                       | 幂等：同名同父命中即返回现有 `{ ok, site, id, name, created:false }`                                                                                                                                                                                                        |
| ensure_site_tags     | write / site:tag:create      | `{ slug?, names:[] }`                                                              | 批量幂等 → `{ ok, site, tags:[{ id, name, created }] }`                                                                                                                                                                                                                     |

**站点生命周期**

| 工具        | risk / perms             | parameters                                                         | 要点                                                                                                                                              |
| ----------- | ------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| update_site | write / site:site:manage | `{ slug, title?, description?, newSlug?, status?, commentAudit? }` | slug 必传；newSlug 校验同建站（40102/40103 回喂）；无字段 → 40001；摘要明示改 slug/停用的影响                                                     |
| delete_site | write / site:site:manage | `{ slug }`                                                         | 摘要 = R66 三段影响 + 文章/栏目/标签/评论数；执行返回 `{ ok, slug, deletedArticles, deletedColumns, deletedTags, deletedComments, recycledRoot }` |

### 12.3 引擎行为变化（无契约变更）

- 上下文预算（R67）：`toolsBudget` 与 `systemBudget` 实测扣减，`historyBudget = max_context − 输出预留 25% − system 实测 − tools 实测 − 当前消息`，
  低于 2000 字符保底并告警；历史从最早丢弃，system 与 tools 恒完整；每轮记 debug 日志（实算值）
- usage 兜底估算（R68）：结算基数扩展覆盖 messages + tools schema + tool 往返消息（1 token ≈ 1 字符）
- 轮次上限：`ai.maxToolRounds` 生效，超限截断提示（口径不变，仅阈值可配）

### 12.4 手册（PLATFORM-GUIDE）

压缩改写 ≤2000 字（UTF-8 字符口径），覆盖：AI 可管云盘（读/写文本/移动/删到回收站）、可发文章（默认草稿、明示才发布、不可删文章）、可改/删站点（删站确认卡列影响）。README.txt（站点模板契约）不动。

> P6 起手册改**两段式**（通用版 + 按权限动态注入的能力清单），本小节的「全文注入 ≤2000 字」口径由 §13.6 取代。

## 13. P6：按需注入 + 评论代审代回 + 封面通道 + 体验三件套

> 决策 D67~~D72 / 规则 R69~~R74，见 `docs/P6/PRD-P6-AI-UX.md`。增补文档 `docs/P6/API-P6-增补.md` 已并入（保留为历史参考，**冲突以本文为准**——§13.6 分组表与 §13.1/§13.4 错误码已按实现改写）。
> **新增 HTTP 端点 1 个**（作者回复评论，§13.1）；**错误码零新增**（复用 40001/40105/40110/40119 与既有权限码）；工具总数 **25 → 28**。

### 13.1 作者回复评论（新增）

| 方法 | 路径                          | 权限                 | 说明                                                    |
| ---- | ----------------------------- | -------------------- | ------------------------------------------------------- |
| PUT  | `/api/site/comment/:id/reply` | `site:comment:audit` | 设置/更新/清除作者回复（一级回复，D69/R71）；挂操作日志 |

请求体：

```json
{ "content": "感谢反馈，已修复" }
```

| 字段    | 约束                                                                                    |
| ------- | --------------------------------------------------------------------------------------- |
| content | string，trim 后 ≤500 字；**空字符串/null = 清除回复**（reply_content/reply_at 置 NULL） |

返回（实现超集，前端不依赖）：

```json
{
  "ok": true,
  "id": "12",
  "nickname": "访客甲",
  "content": "…",
  "replyContent": "感谢反馈，已修复",
  "replyAt": "2026-09-15T10:00:00.000Z"
}
```

错误码（实际口径）：

| 码    | 触发                                                                                                                          |
| ----- | ----------------------------------------------------------------------------------------------------------------------------- |
| 40110 | 评论不存在                                                                                                                    |
| 40119 | 评论存在但站点非属主（「不存在」与「无权限」同口径，不暴露存在性）                                                            |
| 40001 | content 超 500 字（DTO `@Length(0,500)` + service 兜底；HISTORICAL 注：API-P6 增补写的 40107 实为 `SiteColumnInUse`，不适用） |
| —     | 无 `site:comment:audit` → 全局权限守卫码（与所有 `@RequirePermission` 端点一致）                                              |

幂等：重复 PUT 同内容 = 覆盖更新 `reply_at`；无版本冲突概念。列表接口 `GET /api/site/comment` 条目同步增 `replyContent/replyAt`。

### 13.2 开放 API：评论条目携带回复（修改既有）

`GET /api/open/{slug}/api/articles/{id}/comments`（§7.4）返回条目**新增两个字段**：

```json
{
  "id": 12,
  "nickname": "访客甲",
  "content": "…",
  "createdAt": "…",
  "replyContent": "感谢反馈，已修复",
  "replyAt": "2026-09-15T10:00:00.000Z"
}
```

- **仅当评论审核通过（`audit_status=1`）且 `reply_content` 非空时返回内容**；未回复条目两字段为 `null`（字段保留，前端判空渲染）
- 未过审评论本就不可见，其回复自然不可见（D69：回复不单独审核）
- 回复无独立点赞/再回复（一级模型）；写回复后失效既有 `site:data:{siteId}:*` 缓存

### 13.3 模板列表携带预览图（修改既有）

`GET /api/site/templates` 条目新增 `previewUrl`：

```json
{
  "id": "default",
  "name": "默认博客",
  "description": "…",
  "previewUrl": "/templates/default/preview.png"
}
```

- `previewUrl` 为**前端静态资源路径**（Vite 构建产物直出：`apps/web/public/templates/{id}/preview.png`）；模板未配置 `template.json#preview` 时为 `null`（前端渲染占位块，不裂图）
- 实现偏差登记：ARCHITECTURE-P6 增补写 `assets/site-templates/*/preview.png`（服务端资产），实现落在 web 侧以避免新增静态端点与二进制双份，见 ARCHITECTURE §21.4/§21.7

### 13.4 评论管理 AI 工具（新增 3 个，工具总数 25 → 28）

均挂 `site:comment:audit`，均校验评论属于解析出的当前站点（跨站/非属主 = 40119）。

### 13.4.1 list_site_comments（read）

```json
{
  "name": "list_site_comments",
  "description": "列出站点评论（默认待审核）。可按文章筛选。",
  "parameters": {
    "type": "object",
    "properties": {
      "slug": { "type": "string" },
      "status": {
        "type": "string",
        "enum": ["pending", "approved", "rejected", "all"],
        "default": "pending"
      },
      "articleId": { "type": "integer" },
      "page": { "type": "integer", "default": 1 },
      "pageSize": { "type": "integer", "default": 10, "maximum": 20 }
    }
  },
  "perms": ["site:comment:audit"],
  "risk": "read"
}
```

返回 `{ site, filter, total, pageNo, pageSize, comments:[{ id, articleId, articleTitle, nickname, content（超 60 字截断 + contentTruncated）, auditStatus, auditStatusText, replyContent, replyAt, createdAt }] }`。

### 13.4.2 audit_site_comments（write）

```json
{
  "name": "audit_site_comments",
  "parameters": {
    "type": "object",
    "properties": {
      "slug": { "type": "string" },
      "ids": { "type": "array", "items": { "type": "integer" }, "minItems": 1, "maxItems": 20 },
      "action": { "type": "string", "enum": ["approve", "reject"] }
    },
    "required": ["ids", "action"]
  },
  "perms": ["site:comment:audit"],
  "risk": "write"
}
```

确认卡摘要：`批量通过/驳回评论：N 条（#id…）` + 公开影响 + 目标站点；执行逐条独立成败 → `{ ok, site, action, total, succeeded:[], failed:[{ id, message }] }`；ids 为空或 >20 → 40001。

### 13.4.3 reply_site_comment（write）

```json
{
  "name": "reply_site_comment",
  "parameters": {
    "type": "object",
    "properties": {
      "slug": { "type": "string" },
      "id": { "type": "integer" },
      "content": { "type": "string", "maxLength": 500, "description": "回复内容；空串 = 清除回复" }
    },
    "required": ["id", "content"]
  },
  "perms": ["site:comment:audit"],
  "risk": "write"
}
```

确认卡摘要（R71）= 原评论昵称 + 内容截断 30 字 + 现有回复（若有）+ 新回复内容 + 目标站点；执行返回 `{ ok, site, id, nickname, content, replyContent, replyAt, cleared }`；
content 超 500 → 40001；评论不存在 → 40110；跨站/非属主 → 40119。

### 13.5 发文/改文工具新增 coverPath（修改既有，D70/R72）

`create_site_article` / `update_site_article` parameters 新增可选字段：

```json
"coverPath": { "type": "string", "description": "封面图：站点云盘 media/ 下的已有图片路径，如 media/covers/a.png。必须先上传。" }
```

校验链（`SiteFacade.resolveCoverPath`，任一失败 → 回喂 `{ ok:false, errorCode:40105, message, availableImages, hint }`，不抛栈）：

1. 以 `media/` 前缀开头；
2. 解析到该站云盘存在对应 file 行（属主 + 未删除 + 非目录 + **当前可公开访问**，站点页面加载得到）；
3. 扩展名 ∈ `{ .png, .jpg, .jpeg, .webp, .gif }`。

失败时 `availableImages` = 该站 `media/` 下已有图片路径（有界遍历前 10 条），引导模型换图；`update_site_article` 传 `coverPath: ""` = 清除封面。
列表/详情/开放 API 的 cover 字段既有契约不变（`coverPath` 相对站点根，开放层 `coverUrl` 为完整公开地址）。

### 13.6 手册注入与工具路由（无 HTTP 契约变化，行为说明）

- **手册两段式**（D67/R69）：system prompt = 助手设定 + 通用版（`docs/PLATFORM-GUIDE.md`，静态 ≤1000 字）+ **能力清单**（`capability.manifest.ts`，按用户权限逐项注入 ≤1200 字）+ 用户上下文；合注 ≤2000 字。
  实测：admin（17 项能力）prompt 1691 字符，无角色用户（1 项能力）prompt 1097 字符——后者不含任何站点/云盘/系统能力行
- **工具确定性路由**（D68/R70）：请求进入时按**当前用户消息**关键词命中 `KEYWORD_TO_GROUPS` 预筛工具组；common 组恒下发；**无命中 = 全量 28 工具兜底**；
  确认回填链路按该会话最近一条 user 消息路由；SSE 事件流格式不变
- 观测日志：`[AI] tools injected: groups=siteCms,common count=13/28`（info 级）；`DEBUG_AI=1` 时 debug 级输出命中关键字与权限内工具数

**分组常量（实现口径，§21.1 为准）**：

| 组             | 工具（28 个，与注册表逐一对应）                                                                                   |
| -------------- | ----------------------------------------------------------------------------------------------------------------- |
| common（恒发） | get_my_profile / update_my_profile / get_my_credits                                                               |
| system         | get_online_users / kick_user / search_users / list_roles                                                          |
| siteFile       | list_site_files / read_site_file / write_site_files                                                               |
| siteCms        | list/read/create/update/publish_site_article、ensure_site_column、ensure_site_tags、list/audit/reply_site_comment |
| siteLifecycle  | create_site / update_site / delete_site                                                                           |
| cloud          | list_cloud_files / read_cloud_file / write_cloud_file / move_cloud_files / delete_cloud_files                     |

> 工具改名说明：P5 文档中的 create 组自本期起称 **siteCms / siteLifecycle / siteFile**；API-P6 增补 §13.6 原表（含 navigate_page、list_users 等未注册工具）已作废，以本表为准。

### 13.7 体验类改动（前端行为，无接口变化）

| 项          | 说明                                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 模板预览图  | 模板卡片显示 `previewUrl`（`<el-image>`）；缺图/加载失败降级为占位块                                                                       |
| 编辑器 diff | `FileEditorDialog`「对比改动」（所有文本文件）= 打开时快照 ↔ 当前编辑内容 的**只读双栏**对比（`@codemirror/merge` 异步加载；不做合并编辑） |
| 格式按钮    | markdown 面（文件编辑器 .md / 文章正文工具栏）快捷插入：粗体 `**`、斜体 `*`、链接 `[](url)`（选区包裹，零依赖）                            |
| 回收站      | 头像旧行（`parent_id = -1`）不再出现在回收站顶层列表                                                                                       |
| 确认弹窗    | 全仓统一 `confirmDialog` 封装（内置 try/catch，取消静默；`ElMessageBox.confirm` 仅存在于封装内部）                                         |

### 13.8 编号登记

| 系列      | 本期使用   | 说明                                                           |
| --------- | ---------- | -------------------------------------------------------------- |
| 决策      | D67~~D72   | 见 PRD-P6 §2                                                   |
| 需求      | R69~~R74   | 见 PRD-P6 §3                                                   |
| 任务      | T77~T82    | 见 PRD-P6 §5                                                   |
| 错误码    | **无新增** | 复用 40001（超长/批量超限）/40105（封面口径）/40110/40119      |
| AI 工具   | 25 → 28    | +list_site_comments / audit_site_comments / reply_site_comment |
| HTTP 端点 | +1         | `PUT /api/site/comment/:id/reply`                              |
| 前端依赖  | +1         | `@codemirror/merge`（D71 特批，按需异步加载）                  |

## 15. P8：文章创作增强（文件导入 + 一键排版）

> 两个接口均**只解析/排版、不落库**，因此不挂 `@OperationLog`；落库仍走既有 create/update（权限与校验链不变）。

| 方法 | 路径                     | 权限                | 入参                                                                                                | 出参                                                                                                                                                                                                          |
| ---- | ------------------------ | ------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST | /api/site/article/import | site:article:create | `{ fileId: string }`（云盘文件 id；须本人、未删、`md/markdown/txt`、≤2MB）                          | `{ fileId, filename, title, contentMd, summary, wordCount, matchedTags: [{id,name}], unmatchedTags: string[], warnings: string[], meta: { ext, size, encoding: 'utf8'\|'gbk', format: 'markdown'\|'text' } }` |
| POST | /api/site/article/format | site:article:update | `{ contentMd: string(≤20万), options?: { structure?, punctuation?, cjkSpacing? } }`（缺省三档全开） | `{ contentMd, changed, stats: { rules: string[], lines, charsBefore, charsAfter } }`                                                                                                                          |

**错误口径**

- 导入：类型不支持 30012；超过 2MB 30013；文件不存在/无权 30001；解析失败（编码/二进制/空内容）40001（message 为可读原因）。
- 排版：正文超过 20 万字符 40001（与文章正文同口径）。

**解析口径**（与 ARCHITECTURE §24.2 同源）：标题优先 front-matter → 首个 H1 → 文件名；标签只匹配已有、不自动创建；`warnings` 逐条回传供前端提示。
**排版口径**（与 ARCHITECTURE §24.3 同源）：保护区机制（代码/URL 不被改写）+ 三档规则 + 幂等；`stats.rules` 用于前端提示"改了哪些地方"。

## 16. P9：收尾小包（走查清账 + AI 导入/排版接线 + 排版快照 + 站点 SPA 开关）

> 决策 D79~~D81 / 规则 R79~~R81 / 任务 T91~~T94，见 `docs/P8P9/PRD-P9-收尾小包.md`；技术口径见 ARCHITECTURE §25。
> **零新 HTTP 端点、零新错误码、零新依赖、零 DB 变更**；AI 工具 28 → **30**（两个 read 级）。

### 16.1 站点 SPA 回退开关（修改既有端点与响应，D81/R81）

| 方法 | 路径                  | 权限             | 变更                                                                                          |
| ---- | --------------------- | ---------------- | --------------------------------------------------------------------------------------------- |
| PUT  | /api/site/manage/:id  | site:site:manage | body 加 `spaFallback?: 'index.html' \| null`（**只允许这两个值**，其他 → 40001）；NULL = 关闭 |
| GET  | /api/site/manage/list | site:site:manage | 站点视图新增 `spaFallback: string \| null` 字段（供设置页开关回显）                           |
| GET  | /api/site/manage/:id  | site:site:manage | 同上（详情同样回显）                                                                          |

- 变更后失效 `site:resolve:{slug}` 缓存（该缓存内含 `spaFallback`），**无需重启即生效**；
- 关闭（NULL）= 与 P7 前行为完全一致（不变量）；开启后**仍只对无扩展名路径**生效，带扩展名严格 40400（§14.6 不变）；
- 旧 hash 路由模板即使开启也需用户显式「重新应用模板」才生效，后端不做任何自动覆盖。

### 16.2 AI 工具契约（新增 2 个，R79）

| 工具                  | perms                 | 风险 | 入参                                      | 出参                                                            |
| --------------------- | --------------------- | ---- | ----------------------------------------- | --------------------------------------------------------------- |
| `import_site_article` | `site:article:create` | read | `{ path?, fileId? }`（二选一，path 优先） | 同 §15 import 出参（解析结果，**不落库**）                      |
| `format_site_article` | `site:article:update` | read | `{ contentMd, options? }`                 | 同 §15 format 出参（`contentMd / changed / stats`，**不落库**） |

> `import_site_article` 的 `path` 口径（P9 实测修订）：云盘相对路径（如 `products/README.txt`），由 `list_cloud_files` 取得——
> 该工具按 P5 设计只回 `path` 不回 `id`，故 AI 链路以 **path 为主**；`fileId` 保留与 REST 一致（**REST 契约无变化**）。
> 两条寻址共用同一解析链（导入白名单 / ≤2MB / 编码探测 / 标签只匹配不创建 / 错误码 30001·30012·30013·40001）。

- 归组 `siteCms`；关键词表补 `导入｜排版｜format`；能力清单挂既有能力行 `site.article.create` / `site.article.update`（perms 与工具一致，R69）；
- `format_site_article` **不提供 diff 视图**：模型须自行核对或向用户复述 `stats.rules`，不得声称有可视化对比；两工具均说明「是否采用由用户确认后再走 create/update 落库」；
- 工具内**零业务复写**（经 `SiteFacade` 复用 REST 同一实现）。

### 16.3 编号登记

| 系列      | 本期使用 | 说明                                        |
| --------- | -------- | ------------------------------------------- |
| 决策      | D79~~D81 | 见 `docs/P8P9/PRD-P9-收尾小包.md`           |
| 需求      | R79~~R81 | 同上                                        |
| 任务      | T91~~T94 | 见 PROGRESS「P9 任务拆解」                  |
| 错误码    | +0       | 复用 40001 / 30001 / 30012 / 30013 / 40400  |
| HTTP 端点 | +0       | 仅 `PUT /api/site/manage/:id` 加请求字段    |
| AI 工具   | 28 → 30  | 新增两个 read 级工具（导入解析 / 一键排版） |

## 14. P7：站点内容池化（内容归用户 + 多站发表 + 路径美化）

> 决策 D73~~D78 / 规则 R75~~R78，见 `docs/P7/PRD-P7-CONTENT-POOL.md`。增补文档 `docs/P7/API-P7-增补.md` 已并入（保留为历史参考，冲突以本文为准）。
> **新增 HTTP 端点 2 个**（14.2）；**新增错误码 1 个**：40120（删除用户仍有站点）；AI 工具总数维持 28；前端依赖零新增。
> 数据模型变更见 ARCHITECTURE §22.2；迁移文件 `20260916100000_p7_content_pool`（执行前必须备份）。

### 14.1 内容端点改用户级（修改既有）

| 方法 | 路径                  | 变化                                                                                                                                                  |
| ---- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET  | /api/site/article     | **不再接受 `siteId`**（用户级）。保留可选 `siteId` 作**筛选**（不传 = 内容池全部；传 = 只出已发表到该站的）。列表项带 `sites: [{id,name,slug,isTop}]` |
| GET  | /api/site/article/:id | 详情带 `sites`（含每站 `isTop`）；不再有 `siteId` 字段                                                                                                |
| POST | /api/site/article     | body 去掉 `siteId`，新增 `siteIds?: number[]`（提供即替换发表集合；不传 = 仅入内容池，不发表到任何站）                                                |
| PUT  | /api/site/article/:id | 新增 `siteIds?: number[]`（提供即替换；**空数组 = 全站下架**，文章本体保留）                                                                          |
| GET  | /api/site/column/list | **不再接受 `siteId`**（用户级）；列表项带 `sites: [{id,name,slug,sort}]`（展示站点）                                                                  |
| POST | /api/site/column      | body 去掉 `siteId`，新增 `siteIds?: number[]`（不传 = 该用户全部站点可见）                                                                            |
| GET  | /api/site/tag/list    | **不再接受 `siteId`**（用户级）。标签**跟随文章**出现在站点，无需单独挂载                                                                             |
| POST | /api/site/tag         | body 去掉 `siteId`（`name` 用户级唯一，重名复用既有标签）                                                                                             |
| GET  | /api/site/manage/list | 站点项 `articleCount` 改为「已发表到本站的文章数」                                                                                                    |

> 兼容说明：前端三页面已同步（列表不再传 `siteId`，筛选走新增下拉；参见 ARCHITECTURE §22.8）。后端对仍传 `siteId` 的历史请求按「未知参数」处理（ValidationPipe 口径）。

### 14.2 发表 / 显隐关联端点（新增）

| 方法 | 路径                        | 权限                  | body                                               | 响应                                          |
| ---- | --------------------------- | --------------------- | -------------------------------------------------- | --------------------------------------------- |
| PUT  | /api/site/article/:id/sites | `site:article:update` | `{ sites: [{ siteId: number, isTop?: boolean }] }` | `{ ok: true, sites: [{id,name,slug,isTop}] }` |
| PUT  | /api/site/column/:id/sites  | `site:column:update`  | `{ sites: [{ siteId: number, sort?: number }] }`   | `{ ok: true, sites: [{id,name,slug,sort}] }`  |

- **替换式**：每次调用以传入集合为最终结果；空数组 = 文章从全部站点下架 / 栏目在所有站点不展示（本体保留在内容池）。
- **置顶按站独立**：`isTop` 只影响该站内的排序，不影响其他站点。
- 站点 id 不存在或不属于当前用户 → **40119**（文章/栏目不存在或非属主 → **40400**）。
- 发表/下架后清理该站的开放层缓存（`site:data:{siteId}:*`）。

### 14.3 建站与删站（修改既有）

| 方法   | 路径                 | 变化                                                                                                                                                                    |
| ------ | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | /api/site/manage     | body 新增 `publishArticleIds?: 'all'                                                                                                                                    | number[]`（缺省 = `'all'`：把内容池里已发布文章发表到新站；`[]`= 先建空站）。**新`site_site.spa_fallback`** 由模板 `template.json#spaFallback` 读入 |
| DELETE | /api/site/manage/:id | 级联修订：物理删该站评论 + 删该站展示关联；**文章/栏目/标签本体保留**。响应改为 `{ unpublishedArticles, deletedComments, recycledRoot }`（原 `deletedArticles` 已废弃） |

### 14.4 删除用户预检（修改既有）

- `system` 域删用户前预检链（P9 T91-H1 澄清）：云盘 `30011` → **有站点 → 40112** → **无站点但有内容（文章/栏目/标签）→ 40120**。两码语义不重叠、均活跃；此前把 40120 描述成「仍有站点」是文档口径错误，已按代码更正（错误码表注见 ARCHITECTURE §5）。

### 14.5 开放层（`/api/open/{slug}/**`，D76/R76）

| 方法 | 路径                          | 口径                                                                                              |
| ---- | ----------------------------- | ------------------------------------------------------------------------------------------------- |
| GET  | /api/open/{slug}/api/articles | 只出 `site_article_publish` 中本站 + `status=1` 的文章；排序 **`is_top desc, published_at desc`** |
| GET  | /api/open/{slug}/api/columns  | 只出 `site_column_display` 中本站的栏目；`articleCount` 只计**已发表到本站**的文章                |
| GET  | /api/open/{slug}/api/tags     | 跟随文章：只出现在本站已有文章引用到的标签（无标签文章 → 空数组，属正常）                         |

- **评论读与写同口径**（P9 T91-C2）：`POST /api/open/{slug}/api/articles/:id/comments` 先过本站发表校验（`site_article_publish` 内连接 + `status=1`）——**未发表到本站 / 草稿 / 文章不存在一律 40400**，与 `GET .../comments`、`GET .../articles/:id` 完全一致（不区分原因，防探测）。

### 14.6 静态资源回退链（`/api/open/{slug}/**`，D77/R78）

- **无扩展名路径**才回退：`真实文件 → 补 .html → 目录 index.html → 站点 spa_fallback`（全部未命中 → **40400**）。
- **带扩展名路径严格 404**：如 `/not-exist.png` → 40400（不回退，避免静态资源缺失被 index 吞掉）。
- `spa_fallback` 为 NULL（存量站点）→ 不启用回退，行为与 P7 前完全一致；回退命中**不写 `site:path` 负缓存**（新发表文章必须立即可见）；P9 T94 起支持按站开关（`PUT /api/site/manage/:id` 的 `spaFallback`，见 §16）。
- **目录语义优先于回退链**（P9 T91-C1）：真实目录仍是 R4 的 301 语义——`/{dir}`（无斜杠）→ 301 到 `/{dir}/`、`/{dir}/` → 直出 `index.html`、目录存在但无 `index.html` → 40400；回退链的「目录语义」一级只兜**非真实目录**的虚拟路径，故不影响 MPA 模板的相对资源基址。

### 14.7 AI 工具契约变化（R77，工具总数 28 不变）

| 工具                                  | parameters 变化         | 语义变化                                                                                                |
| ------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------- |
| create_site_article                   | 加 `siteIds?: number[]` | status=0 可免选站（仅入内容池）；status=1 必须能确定发表站点（slug 或 siteIds），否则回喂站点清单 40101 |
| update_site_article                   | 加 `siteIds?: number[]` | siteIds 提供即整体替换（空数组 = 全站下架）；slug 由必选降为可选（传了才校验「已发表到该站」）          |
| publish_site_article                  | slug 降为可选           | 上架且零发表站时，确认卡与返回值带警示行（「上架后任何站点都看不到它」）                                |
| list_site_articles                    | 站点降为筛选            | 列表为用户内容池口径，返回项带 `sites`                                                                  |
| read_site_article                     | slug 降为可选           | 校验由「属于该站」改为「已发表到该站」（未发表 → 40400 并提示）                                         |
| ensure_site_column / ensure_site_tags | 去站点参数              | 栏目/标签用户级                                                                                         |
| delete_site                           | 无                      | 确认卡改口径：「下架 N 篇 + 删评论 M 条」，返回 `{ unpublishedArticles, deletedComments, ... }`         |

### 14.8 编号登记

| 系列      | 本期使用   | 说明                                                                |
| --------- | ---------- | ------------------------------------------------------------------- |
| 决策      | D73~~D78   | 见 `docs/P7/PRD-P7-CONTENT-POOL.md`                                 |
| 需求      | R75~~R78   | 同上                                                                |
| 任务      | T83~~T87   | 见 PROGRESS「P7 任务拆解」                                          |
| 错误码    | +1         | **40120**（删除用户仍有站点）；复用 40001/40101/40105/40119/40400   |
| HTTP 端点 | +2         | `PUT /api/site/article/:id/sites`、`PUT /api/site/column/:id/sites` |
| AI 工具   | 28（不变） | 7 个 CMS 工具签名调整；`pnpm check:ai` 16/16                        |

## 17. P10：AI 对话附件上传（文本类）

> 决策 D82~~D86 / 规则 R82~~R87 / 任务 T96~~T99，见 `docs/P10/PRD-P10-AI-ATTACHMENT.md`；技术口径见 ARCHITECTURE §26。
> **零新 HTTP 端点、零新错误码、零新依赖**；AI 工具 **30 不变**（1 个签名变更）；**DB +1 列**（`ai_message.attachments` JSON NULL）。

### 17.1 对话端点变更（修改既有）

#### POST /api/ai/chat

请求体加可选字段：

```json
"attachments": [
  { "fileId": "string（云盘文件 id；本地上传先走既有 upload 接口落 /ai-attachments/ 再取 id）" }
]
```

| 约束   | 口径                                                                                                                           |
| ------ | ------------------------------------------------------------------------------------------------------------------------------ |
| 数量   | ≤5 个/条消息，超出 → **40001**（DTO `@ArrayMaxSize` + service 双校验）                                                         |
| 单文件 | 本人 + 未删除 + 非目录 + 白名单扩展名（D86，32 项）+ ≤2MB；无权/不存在 → **30001**，类型不支持 → **30012**，超 2MB → **30013** |
| 消费   | 由后端按 D83 分流 inject / listed，**上游组装细节对前端透明**                                                                  |

SSE 事件流：**事件类型与既有字段不变**；`meta` 事件**兼容扩展** `attachments` 字段（本次消息的附件元信息数组，含 `mode`），供前端渲染气泡模式标签（ARCHITECTURE §26.9-1）。

#### GET /api/ai/conversation/:id/messages（既有，响应扩展）

消息项加：

```json
"attachments": [{ "fileId": "", "name": "", "ext": "", "size": 0, "chars": 0, "mode": "inject|listed", "path": "", "invalid": false }]
```

`invalid=true` = 源文件已删除（前端置灰渲染「源文件已删除」，R87）；无附件恒为 `[]`。

### 17.2 AI 工具契约变更（1 个签名变更，工具总数 30 不变）

#### read_cloud_file（修改既有，cloud 组，read 级）

| 项          | 变更                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------ |
| parameters  | 加 `offsetChars?: number`（默认 0）、`maxChars?: number`（默认 20000，上限 50000）               |
| 返回        | 加 `totalChars` / `truncated` / `nextOffset?`（truncated=true 时给出），并回显实际 `offsetChars` |
| description | 补「大文件请分段读取：先读开头判断结构，truncated=true 时用 nextOffset 续读，不得假定已读全文」  |

- **体积上限**：AI 云盘读上限由 64KB 放宽到 **2MB**（`AI_CLOUD_READ_MAX_BYTES`）——`read_cloud_file` 是附件清单自读的唯一通道，附件单文件上限即 2MB（D83），上限若仍是 64KB 则大附件列清单后永远读不到（ARCHITECTURE §26.9-9）；`read_site_file` 仍维持 64KB（40115，本期未动站点读口径）；
- 旧调用（不传分页参数）行为兼容：等价于 `offsetChars=0, maxChars=20000`——**注意这是行为变化点**（原返回全文 ≤64KB，现默认截到 2 万字符并带 `truncated`），description 与手册均已写清，避免模型误以为读到全文；
- 变更触发 T95 口径：**必跑 `pnpm smoke:ai`**（工具定义变更），本期新增 J/K 两用例覆盖附件链（ARCHITECTURE §26.9）。

### 17.3 会话可读清单（无 HTTP 契约变化，行为说明）

system 动态追加（不计手册 2000 字帽，上限 20 条，R84）：

```
用户本会话附带文件（可用 read_cloud_file 按路径分段读取，单次 ≤2 万字符；未读前不得猜测文件内容）：
- {path}（{name}，{chars} 字符）
- ...（源文件已删除的条目追加「，已失效」）
```

### 17.4 错误口径汇总（零新增，全复用）

| 码    | 场景                                     |
| ----- | ---------------------------------------- |
| 30001 | 附件文件不存在/无权/已删除（发送时校验） |
| 30012 | 附件类型不在白名单（含疑似二进制内容）   |
| 30013 | 附件 >2MB                                |
| 40001 | 附件数量 >5 / fileId 非法 / 其他参数错误 |

附件失效（历史轮次重读时源文件被删）**不走错误码**——降级标注，对话不阻断（D82）。

### 17.5 编号登记

| 系列      | 本期使用   | 说明                                                        |
| --------- | ---------- | ----------------------------------------------------------- |
| 决策      | D82~~D86   | 见 `docs/P10/PRD-P10-AI-ATTACHMENT.md` §2                   |
| 规则      | R82~~R87   | 见 PRD-P10 §3                                               |
| 任务      | T96~~T99   | 见 PROGRESS「P10 任务拆解」                                 |
| 错误码    | +0         | 复用 30001 / 30012 / 30013 / 40001                          |
| HTTP 端点 | +0         | `POST /api/ai/chat` 加请求字段；消息列表响应加字段          |
| AI 工具   | 30（不变） | `read_cloud_file` 签名变更（加分页）；`pnpm check:ai` 16/16 |
| DB        | +1 列      | `ai_message.attachments` JSON NULL                          |
| 前端依赖  | +0         | `FilePicker` / `uploadFile` 全复用                          |

---

## 18. P11：应用平台 · 数据应用 A 全链（增补并入）

> 全端点登录态（`@CurrentUser`），属主校验统一 **50001**；**无 @RequirePermission**（属主自服务口径，同云盘）；
> 写操作挂 `@OperationLog`。编号 D92~~D96 / R88~~R99 / T100~T107（见 ARCHITECTURE §27 与 PROGRESS）。

### 18.1 端点族 `/api/app/**`（+18）

**18.1.1 应用管理**

| 方法   | 路径                     | 说明                                                                                                                                                                                    |
| ------ | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/app`               | 创建。body `{ name, description?, mode: 'blank'\|'draft' }`；blank=直接 active（占额度），draft=AI 草稿（限 3）。返回 `{ appCode, pubCode, status }`；code 冲突自动 "(1)"；超配额 50002 |
| GET    | `/api/app`               | 我的应用列表（不分页）：`[{ appCode, pubCode, name, description, status, tableCount, rowCount, pageCount, updatedAt }]`；`?status=draft` 只看草稿                                       |
| GET    | `/api/app/:code`         | 应用详情（含统计数字）；无权/不存在 50001                                                                                                                                               |
| PUT    | `/api/app/:code`         | 改名称/描述                                                                                                                                                                             |
| DELETE | `/api/app/:code`         | 软删（级联软删表/字段/页/关系；数据保留 30 天后物理清理——软删后立即 50001）                                                                                                             |
| POST   | `/api/app/:code/confirm` | draft → active（查配额）；草稿过期/非草稿 50008                                                                                                                                         |

**18.1.2 结构管理**

| 方法   | 路径                                | 说明                                                                                                                             |
| ------ | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/app/:code/schema`             | 全量打包（def+tables+fields+rels+pages，含 isSystem 标注）；Redis 缓存                                                           |
| POST   | `/api/app/:code/tables`             | 建表 `{ name, label, fields:[{name,label,type,required?,default?,enumOptions?,refTable?}] }`；超 20 表 50002；字段类型非法 50005 |
| PUT    | `/api/app/:code/tables/:tid`        | 改 label（v1 禁止改表名）                                                                                                        |
| DELETE | `/api/app/:code/tables/:tid`        | 软删；系统表 50001 语义；被引用阻断 50003 并列出引用方                                                                           |
| POST   | `/api/app/:code/tables/:tid/fields` | 加字段（表内唯一）                                                                                                               |
| PUT    | `/api/app/:code/fields/:fid`        | 改 label/必填/默认值/枚举选项                                                                                                    |
| DELETE | `/api/app/:code/fields/:fid`        | 软删（is_deleted=1，数据保留）                                                                                                   |
| POST   | `/api/app/:code/fields/:fid/shrink` | 类型收窄（text/number→enum）：先跑存量校验，不合规 50003（message 带前 10 个 rowId）                                             |
| POST   | `/api/app/:code/relations`          | 建 n:n `{ fromTable, fromField, toTable }` → 自动生成中间表（isSystem）；幂等                                                    |

**18.1.3 功能页**

| 方法   | 路径                        | 说明                                                                                     |
| ------ | --------------------------- | ---------------------------------------------------------------------------------------- |
| GET    | `/api/app/:code/pages`      | 列表（code/name/route/genBy/sort）                                                       |
| POST   | `/api/app/:code/pages`      | 新建 `{ name, route, schema, genBy }`；schema 校验失败 50004（带路径）；route 重复 50007 |
| PUT    | `/api/app/:code/pages/:pid` | 更新 schema/name/sort                                                                    |
| DELETE | `/api/app/:code/pages/:pid` | 软删                                                                                     |

**18.1.4 沙箱数据**

| 方法 | 路径                   | 说明                                                                                                             |
| ---- | ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| POST | `/api/app/data/query`  | 查询 DSL（**必带 appCode**；op/filter/sort/page/size/expand）；越权表 50001；超护栏 50009                        |
| POST | `/api/app/data/action` | body `{ appCode, pageCode, action, params }`；多步 `$transaction`，任一步失败整体回滚 50005；action 未声明 50010 |
| GET  | `/api/app/data/record` | `?appCode=&table=&rowId=` 单行（get 语义糖）                                                                     |

**18.1.5 导入导出与附件**

| 方法 | 路径                                    | 说明                                                                                                                                         |
| ---- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| POST | `/api/app/:code/import?table=`          | multipart（CSV ≤5MB）→ 解析 + 自动映射 → `{ taskId, mapping, previewRows[5], total }` 待确认；不合规 50006                                   |
| POST | `/api/app/:code/import/:taskId/confirm` | 确认映射 `{ mapping? }` → 异步导入                                                                                                           |
| GET  | `/api/app/import/:taskId`               | 进度 `{ status, total, done, errors[{row,reason}] }`                                                                                         |
| GET  | `/api/app/:code/export?table=`          | 流式 CSV（≤5 万行，超出截断并在尾注释说明）                                                                                                  |
| POST | `/api/app/:code/attachment`             | multipart 附件上传：服务端强制落 `/app-attachments/{appCode}/` + 云盘配额记账；返回 `{ fileId, path, name, ext, size }`；超 10MB → **30004** |

### 18.2 userinfo 菜单动态段（修改既有）

`GET /api/auth/userinfo` 的 `menus` 树：「应用中心」节（seed）children 由后端**实时拼装**追加（不落 sys_menu）：

```
应用中心(/app-center) ── 我的应用(app-center/center，seed)
                     └─ {应用名}(/app-center/app/{appCode})     id 前缀 dyn-app-
                         └─ {功能页名}(/app-center/app/{appCode}/p/{pageCode})
```

前端静态注册通配路由 `/app-center/app/:appCode/p/:pageCode → function-page/index.vue`（单组件按参数拉 schema 渲染），
菜单只驱动跳转；动态节点 `component=null`，`dynamic.ts` 跳过空 component 不产生重复路由。应用删除 → 下次拉 userinfo 即消失（R96）。

### 18.3 错误码（50xxx 新段 10 个 + cloud 段 1 个）

| 码    | 文案                         | 场景                                                                       |
| ----- | ---------------------------- | -------------------------------------------------------------------------- |
| 50001 | 应用不存在或无权             | 统一属主校验；含系统表操作、越权表                                         |
| 50002 | 超出配额（message 带项）     | 应用数/草稿数/表数/页数/附件/导入大小                                      |
| 50003 | 结构变更未通过数据校验       | 类型收窄遇存量违规（带 rowId 清单）；删表被引用阻断（带引用方）            |
| 50004 | 页面模式校验失败（带路径）   | schema 结构校验失败                                                        |
| 50005 | 数据校验失败                 | 字段规则/动作步骤失败（事务回滚）；字段类型白名单外                        |
| 50006 | 导入文件不合规               | 非 CSV/超 5MB/空文件/首行无列名                                            |
| 50007 | 功能页路由冲突               | 同应用内 route 重复                                                        |
| 50008 | 草稿已过期或不存在           | confirm 时草稿失效                                                         |
| 50009 | 查询超出护栏                 | >2s 或非索引过滤 >1 万行                                                   |
| 50010 | 动作与页面定义不符           | action 未在 schema 声明                                                    |
| 30021 | 文件被应用数据引用，禁止删除 | **cloud 段**（软删/彻底删除/清空/超期清理预检；复用于 app_attachment_ref） |

### 18.4 AI 工具（新增 app 组 7 个，工具总数 30 → 37）

| 工具             | parameters                                                                               | 成功返回要点                                  | risk  |
| ---------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------- | ----- |
| create_data_app  | `{ name, description? }`                                                                 | `{ ok, appCode, status:'draft' }`             | write |
| add_table        | `{ appCode, table, label, fields:[{name,label,type,required?,enumOptions?,refTable?}] }` | `{ ok, table, created:[] }`                   | write |
| add_fields       | `{ appCode, table, fields:[同上] }`                                                      | `{ ok, table, created:[] }`                   | write |
| set_relation     | `{ appCode, fromTable, fromField, toTable }`                                             | `{ ok, relation:'nm', throughTable }`（幂等） | write |
| gen_admin_page   | `{ appCode, name, purpose }`                                                             | `{ ok, pageCode, route, blocks }`             | write |
| adjust_page      | `{ appCode, pageCode, instruction }`                                                     | `{ ok, changed }`                             | write |
| confirm_data_app | `{ appCode }`                                                                            | `{ ok, status:'active', menuHint }`           | write |

- 全部 write 级（走确认卡）；**perms 留空**（属主自服务，handler 内 assertOwned 由 app 域完成）；关键词入 `KEYWORD_TO_GROUPS` 的 `app` 组。
- `gen_admin_page` 的「AI 选表」落为**确定性关键词匹配**（purpose → 表名/显示名）；`adjust_page` 本期为**按当前表结构重建区块**
  （精细调整走前端功能页编辑器，R97）；两者实现口径见 ARCHITECTURE §27.5。
- 冒烟新增 **L 用例**（R98）：提示词建「读书笔记」数据应用 → 逐张确认卡自动批准 → 断言 `ai_tool_call` 出现
  create_data_app/add_table/gen_admin_page 且 `app_def`(active) 与 `app_table` 落库。
- **P12-PATCH2 T116 追加（工具总数 37 → 38，见 docs/P12/PRD-P12-PATCH2-AI公开面闭环.md）**：

| 工具             | parameters   | 成功返回要点                                                                                                                                            | risk |
| ---------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `list_data_apps` | `{}`（零参） | `{ ok, apps: [{ appCode, name, status, isPublic, pubCode, pubUrl, missing[] }] }`；`missing` = R103 发布缺项（与 `GET /app/:code/pub-config` 同源逻辑） | read |

· **只读、零写副作用、perms 留空**；**不代发布**——`missing` 非空时模型输出「去应用中心 → 公开」引导语（写工具 `publish_data_app` / `expose_data_app` 按 **D106 归 P13**，随市场状态机一并设计）；
· 数据经 **AppFacade.listDataApps** 取（铁律 6：AI 域不直读 app 表）；关键词入 `KEYWORD_TO_GROUPS` 的 `app` 组，**只用复合词**（公开应用/公开链接/公开凭证/对外展示/展示页/发布应用 等），不抢 siteCms 的泛词；
· 能力清单新增 `app.pub` 行（≤50 字）；站点契约 README（三种模板）新增「六、数据应用公开接口」节（前置条件 / 五端点清单 / fetch 示例 / 错误口径 / 只读边界，含「绝对路径是相对路径纪律的唯一例外」说明）；
· 冒烟新增 **M 用例**（只读）：问「我有哪些数据应用？哪些已公开？」→ 断言 `ai_tool_call` 出现 `list_data_apps` 且返回含 `pubCode`/`isPublic`/`missing`；`pnpm check:ai` 由 16 项增至 **17 项**（新增路由样例断言）。

### 18.5 配置登记（API §12.1 ai 表旁新增 app 配置组，详见 ARCHITECTURE §27.8）

`app.maxAppsPerUser=10` / `app.maxDraftsPerUser=3` / `app.maxTablesPerApp=20` / `app.maxRowsPerTable=50000` /
`app.maxPagesPerApp=50` / `app.maxAttachmentSize=10MB` / `app.maxImportSize=5MB` / `app.hotIndexFieldsPerTable=5` /
`app.queryTimeoutMs=2000` / `app.draftTtlDays=7`（env 前缀 `APP_*`，均可不配）。

### 18.6 编号登记

| 系列      | 本期使用                                | 说明                                           |
| --------- | --------------------------------------- | ---------------------------------------------- |
| 决策      | D92~D96                                 | 见 PRD-P11 §2（D87~D91 既有沿用）              |
| 规则      | R88~R99                                 | 见 PRD-P11 §3                                  |
| 任务      | T100~T107                               | 见 PROGRESS「P11 任务拆解」                    |
| HTTP 端点 | +18                                     | §18.1；userinfo 响应扩展（§18.2）              |
| 错误码    | 50xxx 段 10 + 30021（cloud 段续 30020） | §18.3                                          |
| AI 工具   | 30 → 37（app 组 7）                     | §18.4；`pnpm check:ai` 16/16                   |
| DB        | +7 表                                   | ARCHITECTURE §27.2                             |
| 前端依赖  | +0                                      | 复用 ProTable/FormDialog/uploadFile 等既有资产 |

## 19. P12：数据应用 B 侧（公开与展示）（增补并入）——⚠ 公开面五端点已退役

> ⚠ **P14 退役标注（2026-09-30）**：本节 `GET /api/pub/app/{pubCode}/**` 五端点（manifest / 页 schema /
> 数据列表 / 数据详情 / 附件流）已随匿名公开面**整体退役**（P14 D115），访问即 404（不存在路由）。
> 替代：站点开放层 **`/api/open/:slug/api/app/:appCode/**`** 四数据端点（授权取数面，见 §21.1-8~~11）；
> `app_page.kind=display` 展示页与前端 `PublicRenderer` 一并废弃（D113）。本节保留作历史基线。
> 来源：`docs/P12/API-P12-增补.md`。上游 §18（P11，+18 端点）已闭环。
> 编号：D97~~D105 / R100~~R113 / T108~~T115。**HTTP 端点 +10（管理侧 5 + 公开侧 5）；错误码 +1（50012）；零新 AI 工具（37 不变）；零新依赖**。

> 管理侧：登录态 + 属主校验（50001），写挂 `@OperationLog`（同 §18 口径）。
> 公开侧：免登录 `@Public` + `@SkipTransform`，独立限流 60 次/分/IP（42900），**资源类失败统一 40400 防探测**（参数校验 40001 为例外）——开放层 §6/§8 同款结构。

### 19.1 管理侧端点（+5）

| 方法 | 路径                                | 说明                                                                                                                                                                                                |
| ---- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PUT  | `/api/app/:code/publish`            | body `{ isPublic: 0\|1 }`（照 `PUT /api/site/article/:id/status` 先例）。置 1 走 R103 校验，未过 **50012**（message 带缺项清单）；成功返 `{ pubCode, pubUrl }`；置 0 即时失效公开端（缓存同步 DEL） |
| GET  | `/api/app/:code/pub-config`         | 公开总览 `{ isPublic, pubCode, pubUrl, exposedTables[], publicPages[], missing[] }`（missing = 当前发布缺项，供前端引导）                                                                           |
| PUT  | `/api/app/:code/tables/:tid/expose` | body `{ isExposed }`；表级暴露开关（R100）                                                                                                                                                          |
| PUT  | `/api/app/:code/fields/:fid/expose` | body `{ isExposed }`；字段级暴露开关                                                                                                                                                                |
| PUT  | `/api/app/:code/pages/:pid/publish` | body `{ isPublic }`；**仅 kind=display**（admin 页 → 50004）；置 1 不单独校验暴露（发布时统一 R103）                                                                                                |

### 19.2 公开端点（+5，前缀 `/api/pub/app`）

| 方法 | 路径                                             | 说明                                                                                                                                                                                                                                                                                                                        |
| ---- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET  | `/api/pub/app/{pubCode}`                         | manifest `{ name, description, pages: [{ code, name }] }`（仅公开 display 页，按 sort）；应用不存在/未公开/已删 → 40400                                                                                                                                                                                                     |
| GET  | `/api/pub/app/{pubCode}/pages/{pageCode}/schema` | display 页 schema（发布时已 R103 校验，原样输出）；页不存在/未公开 → 40400                                                                                                                                                                                                                                                  |
| GET  | `/api/pub/app/{pubCode}/data/{table}`            | 公开列表。参数：`page` `size`（≤50 默认 20）`sort=字段:asc\|desc`（≤2 组，重复参数）`filter=字段:eq\|contains:值`（≤3 组，值 URL 编码）`expand=refField[:f1,f2]`（≤1 层）。返回 `{ list, total, pageNo, pageSize }`；item 仅暴露字段 + rowId/createdAt/updatedAt；expand 结果放 `expanded[field]`；n:n 多值回填为 `rowId[]` |
| GET  | `/api/pub/app/{pubCode}/data/{table}/{rowId}`    | 单行（暴露字段投影）；行不存在 → 40400                                                                                                                                                                                                                                                                                      |
| GET  | `/api/pub/app/{pubCode}/file/{fileId}`           | 附件流。inline，MIME 口径 R26（文本强制 plain、html/svg attachment、图片/音视频/PDF inline）；`?download=1` → attachment + `filename*=UTF-8''` 原名；无引用 / 未暴露 → 40400                                                                                                                                                |

**参数口径（R104）**：可排序字段 = 暴露字段 + rowId/createdAt/updatedAt；filter 的 contains 限 text/enum；expand 限 ref 字段且目标表已暴露，请求字段子集仍按白名单裁剪；任一越界 → 40001。
**路由安全**：`/api/pub` 顶层无参数段（cloud 的 f/d 为静态段，app 亦为静态段），零冲突（P4e 遗留 14 教训）。
**缓存（R105）**：manifest/schema TTL 600s、data TTL 60s；页动作事务提交后与 CSV 导入完成后按 appId DEL data 键（`AdminService.invalidatePubCache`）；发布/取消/暴露开关/页公开即 DEL 对应键。
**护栏复用**：公开查询与 A 侧同护栏——>2s 或内存路径 >1 万行 → 50009。

### 19.3 错误码

| 码                                            | 文案                           | 场景                                          |
| --------------------------------------------- | ------------------------------ | --------------------------------------------- |
| **50012**                                     | 发布校验未过（message 带缺项） | R103                                          |
| 40400 / 40001 / 42900 / 50009 / 50001 / 50004 | 复用                           | 防探测 / 参数 / 限流 / 护栏 / 属主 / 页面校验 |

50xxx 段用至 50012（**P13 续用 50013~~50015，见 §20.3；P14 续用 50016~~50018，见 §21.2**）；30xxx（30021 封顶）、40xxx（40120 封顶）零新增。

### 19.4 配置登记（§18.5 app 配置组追加）

`app.pubListMaxSize=50` / `app.pubFilterMaxGroups=3` / `app.pubSortMaxFields=2` /
`app.pubDataCacheTtlSeconds=60` / `app.pubManifestCacheTtlSeconds=600` / `app.pubRateLimitPerMinute=60`

### 19.5 编号登记

| 系列      | 本期使用               | 说明                                                                                 |
| --------- | ---------------------- | ------------------------------------------------------------------------------------ |
| 决策      | D97~D105               | PRD-P12 §2 + PATCH1（D105）                                                          |
| 规则      | R100~R113              | PRD-P12 §3 + PATCH1（R109~R113）                                                     |
| 任务      | T108~T115              | 见 PROGRESS「P12 任务拆解」                                                          |
| HTTP 端点 | +10（管理 5 + 公开 5） | §19.1 / §19.2                                                                        |
| 错误码    | +1（50012）            | §19.3                                                                                |
| DB        | +0 表 +4 列            | ARCHITECTURE §28.2                                                                   |
| AI 工具   | 0 新增（37 不变）      | `pnpm check:ai` 16/16 已复验；**P12-PATCH2 T116 后增只读 1 个 → 38**（§18.4 追加行） |
| 前端依赖  | +0                     | PublicRenderer 复用 app-renderer 既有资产                                            |

---

## 20. P13：应用市场（快照式发布 / 审核 / 复制）

> 来源：`docs/P13/API-P13-增补.md`（并入本节）。编号：D107~~D111 / R117~~R123 / T117~~T123。
> 增量：**HTTP 端点 +7 / 错误码 +3（50013~~50015）/ AI 工具 38→41 / 零新依赖 / +1 表**。
> 提交/浏览/复制 = 登录态（同云盘属主口径）；审核 = `market:review` 权限 + @OperationLog；**无匿名端点**（D111）。

### 20.1 端点（+7）

**用户侧（`/api/market`，登录态，无 @RequirePermission）**

| 方法 | 路径                      | 说明                                                                                                                                                                               |
| ---- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST | `/api/market/submissions` | body `{ appCode, withDemoData? }`；提交即物化结构快照（R117/R118）；重复活跃条目 **50013**；演示数据超限 **50015**；成功 `{ ok, listingCode, status: 'pending' }`                  |
| GET  | `/api/market/mine`        | 我的提交（含 pending/approved/rejected/delisted 全状态，时间倒序；含 `appCode` 回填 + 快照摘要 + `reviewNote`）                                                                    |
| GET  | `/api/market/list`        | 市场列表：approved 且未 delisted，分页（`page` / `pageSize` ≤50，默认 12），item `{ code, name, description, publisherName, tableCount, pageCount, hasDemo, copyCount, listedAt }` |
| GET  | `/api/market/:code`       | 条目详情（元数据卡片 + 结构摘要 `tables[]`/`pages[]`）；不存在/未上架 → **50014**                                                                                                  |
| POST | `/api/market/:code/copy`  | 复制：物化为接收方新应用（R119）；条目不可复制 **50014**；配额满 **50002**；成功 `{ appCode, tableCount, pageCount, rowCount, skippedRows }`                                       |

**审核侧（`/api/market/review`，`market:review` + @OperationLog）**

| 方法 | 路径                      | 说明                                                                                                                                                           |
| ---- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET  | `/api/market/review/list` | 审核列表（含快照摘要：表/页清单）。`?status=pending`（默认，FIFO 待审）/ `approved`（在架，供下架）；item 含 `id`（审核动作用）                                |
| POST | `/api/market/review/:id`  | body `{ action: 'approve'\|'reject'\|'delist', note? }`；reject 必填 note（缺 → 40001）；approve 写 `listed_at`；delist 写 `delisted_at`；状态不可执行 → 40001 |

### 20.2 AI 工具（+3，write 级，工具总数 38 → 41）

| 工具                | parameters                                                       | 成功返回要点                                                                                                               | risk  |
| ------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----- |
| `publish_data_app`  | `{ appCode, isPublic }`                                          | `{ ok, isPublic, pubCode?, pubUrl?, missing? }`（开启未过 R103 → **ok:false + missing[]**，不抛错，供模型按缺项补 expose） | write |
| `expose_data_app`   | `{ appCode, target: 'table'\|'field'\|'page', name, isExposed }` | `{ ok, target, name, isExposed }`（field 支持 `表.字段` 或应用内唯一字段名；page 非 display → 50004）                      | write |
| `submit_market_app` | `{ appCode, withDemoData? }`                                     | `{ ok, listingCode, status: 'pending' }`（50013/50015）                                                                    | write |

- 三工具 handler 全经 Facade（AppFacade / MarketFacade），perms 空（属主自服务），关键词 app 组**精准复合词**（应用市场/市场审核/提交市场/发布到市场/上架应用/市场条目/公开发布/暴露，不抢 siteCms）。
- **模型闭环**：`list_data_apps`（读状态与缺项）→ `expose_data_app` 补齐 → `publish_data_app` → `submit_market_app`；`collectPublishMissing` 文案带可操作清单（表名 / 展示页 `名称(code)`）使闭环可自走通。
- `check:ai` 断言 17→18 项（「应用市场」路由样例）；`smoke:ai` 新增 **N 用例**（expose → publish → submit 顺序断言 + `market_listing` 落 pending）。
- 手册：能力清单 +3 行（`app.expose`/`app.publish`/`app.market`）；**合注按 R123 腾挪**（精简既有能力行与手册枚举后落地 1987/2000，通用版 982/1000、能力清单 954/1200）。

### 20.3 错误码（+3）

| 码    | 文案                     | 场景                                     |
| ----- | ------------------------ | ---------------------------------------- |
| 50013 | 该应用已有待审或在架条目 | 重复提交（message 带已有条目编号与状态） |
| 50014 | 市场条目不存在或未上架   | 详情/复制防探测（未登录另行 401）        |
| 50015 | 提交内容不合规           | 演示数据超 100 行/表、快照超限/结构非法  |

复用：50001（属主）/ 50002（配额）/ 50004（页面校验）/ 50012（发布缺项）。50xxx 用至 50015；30xxx / 40xxx 零新增。

### 20.4 配置登记（新增 market 组，`src/config/market.config.ts`，env 前缀 `MARKET_*`）

`market.demoMaxRowsPerTable=100` / `market.snapshotMaxBytes=262144`

### 20.5 编号登记

| 系列      | 本期使用                | 说明                                                  |
| --------- | ----------------------- | ----------------------------------------------------- |
| 决策      | D107~D111               | PRD-P13 §2                                            |
| 规则      | R117~R123               | PRD-P13 §3                                            |
| 任务      | T117~T123               | 见 PROGRESS「P13 任务拆解」（含 T122 = P12 尾巴收尾） |
| HTTP 端点 | +7                      | §20.1                                                 |
| 错误码    | +3（50013~50015）       | §20.3                                                 |
| DB        | +1 表（market_listing） | ARCHITECTURE §29.2                                    |
| AI 工具   | +3（38→41）             | §20.2；`check:ai` 18/18 + smoke N 用例                |
| 前端依赖  | +0                      | 复用卡片流/抽屉/表单既有资产                          |

---

## 21. P14：展示应用与数据授权（模型修订期）

> 来源：`docs/P14/API-P14-增补.md`（并入本节）。编号：D112~~D118 / R124~~R129 / T124~~T131。
> 本期 **+11 端点、+3 错误码（50016~~50018）、AI 工具 41→43**；退役 §19 公开面五端点（见 §19 顶部标注）；+2 表（§21 对应 ARCHITECTURE §30）。

### 21.1 端点总览（+11）

**后管（登录态，display 域自服务，无 `@RequirePermission`）：**

| #   | 方法与路径                                | 说明                                                                     | 错误码            |
| --- | ----------------------------------------- | ------------------------------------------------------------------------ | ----------------- |
| 1   | `POST /api/display`                       | 创建展示应用 `{name, siteSlug?}`；无 siteSlug → 云盘暂存区               | 50018 重名、40001 |
| 2   | `GET /api/display`                        | 我的展示应用列表（含挂靠站点名、开放层入口与授权清单）                   | —                 |
| 3   | `PUT /api/display/:id/affiliate`          | 挂靠 / 换挂靠 / 取消挂靠 `{siteSlug}`（目录移动 + 关系更新；中断全回滚） | 50016、40001      |
| 4   | `DELETE /api/display/:id`                 | 软删（清授权；目录保留于云盘由用户处置）                                 | 50016             |
| 5   | `POST /api/display/:id/grants`            | 授权 `{appCode}`（is_public=0 的应用给出提示但仍可授权）                 | 50001、50017      |
| 6   | `DELETE /api/display/:id/grants/:appCode` | 撤权                                                                     | 50016、50017      |

**开放层（匿名可达，R125 校验链）：**

| #   | 方法与路径                                                          | 说明                                                       | 错误码            |
| --- | ------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------- |
| 7   | `GET /api/open/:slug/disp/:id/**`                                   | 展示页静态文件（挂靠校验、index/SPA 回退、R26 MIME）       | 40400             |
| 8   | `GET /api/open/:slug/api/app/:appCode/schema`                       | 暴露后表结构                                               | 40400/40001/42900 |
| 9   | `GET /api/open/:slug/api/app/:appCode/tables/:table/records`        | 列表（R104 固定口径：size≤50、sort≤2、filter≤3、expand≤1） | 同上              |
| 10  | `GET /api/open/:slug/api/app/:appCode/tables/:table/records/:rowId` | 详情                                                       | 同上              |
| 11  | `GET /api/open/:slug/api/app/:appCode/files/:fileId/stream`         | 附件流（`?download=1` → attachment + 原名）                | 同上              |

**退役（§19 已标注）**：`/api/pub/app/:pubCode/**` 五端点整体下线，访问一律 404（不存在路由）；`pub_code` 停止签发与消费。
`/api/open/:slug/api/**` 与既有 `/api/open/:slug/` 站点开放能力同前缀、零歧义（D31 口径）；路由注册顺序：取数/展示控制器先于静态通配。

> **P15 变更（D123/R137）**：上表第 8~~11 项取数路径已**收窄为展示应用级** —— 现为 `GET /api/open/:slug/disp/:id/api/app/:appCode/**`；旧 `:slug/api/app/:appCode/**` 已退役（无控制器，请求落到站点静态通配后由「首段 api」双保险统一 40400）。详见 §22.4。

### 21.2 错误码（+3）

| 码    | 含义                             | 场景                                         |
| ----- | -------------------------------- | -------------------------------------------- |
| 50016 | 展示应用不存在或已删除           | 后管（属主校验）/ 开放层（对外仍统一 40400） |
| 50017 | 授权关系已存在 / 不存在          | grant / revoke                               |
| 50018 | 展示应用名称冲突（owner 内唯一） | 创建（市场物化重名自动 `(2)` 递增，不触发）  |

开放层未授权（未授权/未公开/未挂靠/未暴露）**统一 40400**，不区分原因（R125，防探测口径沿用）。

### 21.3 请求/响应要点

- **创建展示应用**：`POST /api/display` → `{id, name, siteId|null, siteSlug, siteTitle, folderPath, writePath, urlPreview, grantCount, grants, createdAt}`；`writePath` = 写页面文件的云盘路径（挂靠 = `{slug}/disp/{id}`，未挂靠 = 暂存区路径）；`urlPreview` = 挂靠后开放层入口 `/api/open/{slug}/disp/{id}/`（未挂靠为 null）。
- **列表追加「云盘目录定位」两字段（P16）**：`GET /api/display` 响应补 `folderId` 与 `siteRootFolderId`，供「我的应用 ▸ 展示应用」卡片的**打开云盘目录**按钮直达：
  - `folderId`：展示应用云盘目录节点 id（即 `{slug}/disp/{id}` 的 `cloud_file.id`）；**未挂靠**或**目录尚未创建**（挂靠本身不建目录，写文件时才 `mkdir -p`）为 `null`；
  - `siteRootFolderId`：挂靠站点根目录 id（未挂靠 `null`）——`folderId` 为 `null` 时前端退回跳站点根。
    两者**仅列表接口**返回（创建/编辑/授权等单条响应为 `null`）；前端跳转范式 `/cloud/file?dir={folderId}`。
    另：站点被删后（`disp_display.site_id` 为逻辑外键、删站不清理该关系），该展示应用按**未挂靠**返回（`siteId` / `siteSlug` / `folderId` / `siteRootFolderId` 均 `null`），其目录已随站点文件进回收站。
- **列表追加「访客可见性」字段（P21 T179）**：`GET /api/display` 响应补 `published: boolean`——挂靠且内容已聚合进站点**当前发布快照**（manifest 含 `disp/{id}/` 条目，与开放层快照轨同口径）为 `true`；未挂靠 / 挂靠后未发布为 `false`（访客此时打不开 `urlPreview`，需「发布到站点」/全量发布后生效）。仅列表接口返回；未发布站点（无 activeReleaseId）恒 `false`。
- **换挂靠**：`PUT /api/display/:id/affiliate` → 事务内完成目录移动 + site_id 更新；响应附 `moved`；中断全回滚（R127）。
- **授权/撤权**：`POST /api/display/:id/grants` / `DELETE .../grants/:appCode`；授权变更立即触发该 app 取数面缓存 DEL（写后失效沿用）。
- **取数面响应**：结构 = §19 公开面对应端点响应体（`schema` 为 `{app:{name,description}, tables:[{name,label,fields:[…]}]}`；列表 `{list,total,pageNo,pageSize}`、单行 `{op:'get',row}`）。
- **市场 bundle**：`POST /api/market/submissions` 请求扩展 `withDisplayApps?: boolean`（默认 true——存在出边授权闭包时随快照打包），响应扩展 `displays: [{name, fileCount}]` 与 `skippedDisplays[]`；`POST /api/market/:code/copy` 响应扩展 `displays: [{id, name, siteId|null}]` 与 `skippedDisplays[]`（快照含 bundle 时）。

### 21.4 配置（新增 display 组，`src/config/display.config.ts`，env 前缀 `DISPLAY_*`）

| 键                          | 默认           | 说明                                                        |
| --------------------------- | -------------- | ----------------------------------------------------------- |
| `display.stagingPath`       | `disp-staging` | 暂存区根目录（云盘内；未挂靠展示应用目录的父目录）          |
| `display.copyNameSuffixMax` | `20`           | 市场物化重名递增上限 `(2)…(20)`，超出记为 `skippedDisplays` |

另：站点开放层取数面限流键 `site.siteOpenAppDataRateLimit`（默认 60 次/分/IP → 42900，与静态桶分离）。

### 21.5 AI 工具（41→43）

| #   | 工具                 | 类型            | parameters                        | 成功返回要点                                                   |
| --- | -------------------- | --------------- | --------------------------------- | -------------------------------------------------------------- |
| 42  | `create_display_app` | write（确认卡） | `{name, siteSlug?}`               | `{ok, id, name, siteSlug, writePath, urlPreview, nextSteps[]}` |
| 43  | `authorize_data_app` | write（确认卡） | `{appCode, displayId, isGranted}` | `{ok, appCode, displayId, isGranted}`（未发布应用附 `hint`）   |

既有修订：`list_data_apps` → 授权口径（`apps[].grantedDisplays` + 顶层 `displayApps[]`）；`submit_market_app` 确认卡扩展 bundle；`publish_data_app` / `expose_data_app` 文案同步。
`check:ai` **19/19**；`smoke:ai` 新增 **O 场景（bundle 复制全链）**、M 场景改授权口径；手册三版（通用版 959/1000、能力清单 978/1200、合注 1988/2000，R129 腾挪后落地）。

### 21.6 冒烟与回归

- `smoke:ai` O 场景全过（提交含授权展示应用 → 审核通过 → 复制三副本 + 授权重建 + 副本进暂存区）；M 场景按新口径全过。
- 开放层五端点（7~11）回归：授权正例 200 + 负例全 40400（未授权/未公开/未挂靠/未暴露各一）；42900 独立限流复测。
- 退役检查：`/api/pub/app/*` 任意路径 404（非 401/403，避免探测差异）。

### 21.7 编号登记

| 系列      | 本期使用                           | 说明                                           |
| --------- | ---------------------------------- | ---------------------------------------------- |
| 决策      | D112~D118                          | PRD-P14 §3/§4（六项拍板）                      |
| 规则      | R124~R129                          | PRD-P14 §5                                     |
| 任务      | T124~T131                          | 见 PROGRESS「P14 任务拆解」                    |
| HTTP 端点 | +11（退役 −5）                     | §21.1                                          |
| 错误码    | +3（50016~50018）                  | §21.2                                          |
| DB        | +2 表（disp_display / disp_grant） | ARCHITECTURE §30.2                             |
| AI 工具   | +2（41→43）                        | §21.5；`check:ai` 19/19 + smoke O 用例         |
| 前端依赖  | +0                                 | 复用卡片流/抽屉/表单既有资产（新增展示应用页） |

---

## 22. P15：对外开放接入层（地基收敛 + 外部系统接入）

> 来源：`docs/P15/API-P15-增补.md`（并入本节）。编号：D119~~D128（+D129/D130 下期预登记）/ R130~~R141 / T132~~T138。
> 本期 **+11 端点（管理侧 7 + 对外 4）**、开放层取数 4 端点**改路径**（旧路径退役）、**+3 错误码（50019~~50021）**、**AI 工具零新增（43 不变）**、**零新依赖**（MCP SDK 属下期）。配套结构见 ARCHITECTURE §31。

### 22.1 管理侧端点（+7，`/api/access/**`，登录态自服务，属主隔离）

| #   | 方法与路径                                | 说明                                                                                           | 错误码                         |
| --- | ----------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------ |
| 1   | `POST /api/access/credentials`            | 创建凭证 `{appCode, name, scope:{tables[], fields?}, expiresAt?}` → 见 §22.3.1                 | 50001、40001、50020、50021     |
| 2   | `GET /api/access/credentials`             | 我的凭证列表（含 appCode / 应用名、secretPrefix、status、expiresAt、lastUsedAt、当日用量汇总） | —                              |
| 3   | `GET /api/access/credentials/:id`         | 详情（含 scope 全量；**不含 secret**）                                                         | 50001                          |
| 4   | `PUT /api/access/credentials/:id`         | 改 `{name?, scope?, expiresAt?}`；scope 校验同创建                                             | 40001、50001、50021            |
| 5   | `POST /api/access/credentials/:id/revoke` | 吊销（不可逆，立即生效）                                                                       | 50001                          |
| 6   | `POST /api/access/credentials/:id/rotate` | 轮换 secret：响应一次性返回新 Key（keyId 不变，旧 secret 立即失效）                            | 50001、40001（已吊销不可轮换） |
| 7   | `GET /api/access/audits`                  | 审计检索：`?credentialId=&from=&to=&resultCode=&pageNo=&pageSize=`（pageSize ≤50）             | 40001                          |

- 写操作（1 / 4 / 5 / 6）挂 `@OperationLog('接入凭证', …)`；全部**无 `@RequirePermission`**（属主自服务，照 display 先例）。
- **凭证校验不缓存**（R131）：吊销 / 轮换**立即生效**，无失效传播问题。
- `secret` 语义（R130）：仅端点 1 与 6 的响应**一次性**返回完整 `apiKey`（含 `secretOnce: true`）；此后任何端点只回显 `keyId + secretPrefix`。

### 22.2 对外取数端点（+4，`/api/ext/v1/**`，凭证态）

认证：`Authorization: Bearer {keyId}.{secret}`。**HTTP 状态码语义真实化**：401（凭证）/ 429（配额）/ 200（成功与业务失败——40400 / 40001 仍走统一体，与平台其余开放面一致）。

| #   | 方法与路径                                                                              | 说明                                                        |
| --- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 8   | `GET /api/ext/v1/app/:appCode/schema`                                                   | 表结构（scope ∩ 暴露三开关投影；含枚举选项与 ref 目标表名） |
| 9   | `GET /api/ext/v1/app/:appCode/tables/:table/records?size=&after=&sort=&filter=&expand=` | 列表（**游标分页**，无 pageNo / offset）                    |
| 10  | `GET /api/ext/v1/app/:appCode/tables/:table/records/:rowId`                             | 详情                                                        |
| 11  | `GET /api/ext/v1/app/:appCode/files/:fileId/stream`                                     | 附件流（R26 MIME；`?download=1` → attachment + 原名）       |

校验链（R132）：凭证（401 / 50019）→ `appCode` 与凭证 `app_id` 匹配（否 40400）→ 应用未软删且 `is_public=1`（否 40400）→ 表 ∈ `scope ∩ 暴露`（否 40400；schema 对越权表不输出、不报错）→ 配额（429 / 42900）→ 参数（40001）。

> **附件流的 scope 判定（W11 / T151 收窄）**：端点 11 除「引用索引 + 表·字段暴露」外，**还须过凭证 scope 交集**——
> 引用集合中至少有一条 `(表, 字段)` 落在 `scope.tables` 与 `scope.fields[表]` 内才放行；全部越界时与「未引用」
> 同表现为 **40400**（防探测不裂缝）。多引用文件任一引用在 scope 内即放行（行可见即可读其附件）。
> `display` / 匿名分支无 scope 概念，口径不变（P14）。
>
> **行级过滤（P17 §24）**：端点 9 / 10 受 `scope.rowFilter` 收窄（与请求 `filter` 取交集；详情不满足 → 40400）；
> 端点 11（附件流）**不参与**行级判定（附件随记录可见性，见 §24.3）。

### 22.3 请求 / 响应要点

#### 22.3.1 创建凭证（端点 1）响应

```json
{
  "code": 0,
  "data": {
    "id": "12",
    "keyId": "ik_3f9ab2c7d1",
    "apiKey": "ik_3f9ab2c7d1.X7k...",
    "secretOnce": true,
    "secretPrefix": "X7k",
    "name": "ERP 对接",
    "appCode": "app(7)",
    "scope": { "tables": ["book"], "fields": {}, "ops": ["read"], "rowFilter": null },
    "expiresAt": null,
    "createdAt": "..."
  }
}
```

此后任何端点不返回完整 Key；列表 / 详情只给 `keyId + secretPrefix`。轮换（端点 6）响应同构（`apiKey` 为新值，附 `rotatedAt`）。

#### 22.3.2 对外响应 envelope（v1 冻结，D124/R136）

- schema：`{ "code":0, "data":{ "app":{name,description}, "tables":[{name,label,fields:[…]}] } }`
- 列表：`{ "code":0, "data":[ ...行... ], "paging":{ "nextCursor":"eyJ2Ij…"|null, "size":50 } }`（**无 total**）
- 详情：`{ "code":0, "data":{ ...行... } }`（内部 `{op,row}` 形状**不出域**）
- 行 = 公开投影白名单（用户逻辑字段名 + `rowId` / `createdAt` / `updatedAt`）；内部列不出域。

#### 22.3.3 游标与排序

- `size` ≤50（默认 20）；`after` = 上一页 `nextCursor`，缺省首页。
- 排序默认 `rowId ASC`；`sort` 至多 2 个白名单字段（`name:asc,name2:desc`），服务端强制追加 `rowId ASC` tiebreaker。
- cursor 非法 / 与本次 `sort` 不一致 / 长度不符 → 40001。cursor 内部形态为实现细节（当前 `base64url(JSON)`），调用方不得解析。
- **两条实测口径（实施补充，见 ARCHITECTURE §31.4）**：① 游标值对 `Date` 字段做 `ISO 字符串`规范化（否则时间字段翻页会返回空页）；② 「不重不漏」仅在**单调排序键**（如 `sort=createdAt:asc`）下成立，默认 `rowId` 为随机 UUID（非单调），此时只保证「不重」。

#### 22.3.4 配额响应头与超限

- 成功响应携带：`X-RateLimit-Remaining-Minute` / `X-RateLimit-Remaining-Day` / `X-RateLimit-Rows-Remaining-Day`。
- 超限：`HTTP 429` + `{ "code":42900, "message":"已超配额", "data":null }` + `Retry-After: <秒>`。

#### 22.3.5 审计检索（端点 7）响应

`{ list: [{ id, principal, appId, endpoint, tableName, paramsSummary, rows, durationMs, ip, resultCode, createdAt }], total, pageNo, pageSize }`；属主隔离（只见自己的凭证流水与匿名展示应用流水）。`principal` 形如 `cred:{id}` / `display:{id}`。

### 22.4 开放层取数路径变更（D123/R137）

| 项           | 旧（P14，退役）                                         | 新（本期）                                                          |
| ------------ | ------------------------------------------------------- | ------------------------------------------------------------------- |
| 数据端点     | `GET /api/open/:slug/api/app/:appCode/**`（**已退役**） | `GET /api/open/:slug/disp/:id/api/app/:appCode/**`                  |
| 校验链       | 站点下任一挂靠展示应用被授权即放行                      | **该 `displayId`** 挂靠该站点 ∧ `disp_grant(displayId, appId)` 命中 |
| 页面取数写法 | 站点页同源 `/api/open/<slug>/api/app/<appCode>/...`     | 展示应用页相对 `./api/app/<appCode>/...`（站点根页用绝对路径）      |

错误口径不变：资源类统一 40400；参数 40001；限流 42900（60 次/分/IP 独立桶，保留）。

**退役表现实测**：旧路径无控制器 → 请求落到站点静态通配 `:slug/*path` → 由「首段 `api`」双保险统一 **HTTP 200 + code 40400**（平台业务错误恒 HTTP 200；断言按业务码）。

### 22.5 错误码（+3，50xxx 段续）

| 码    | 常量                      | 含义                                | 场景                                      |
| ----- | ------------------------- | ----------------------------------- | ----------------------------------------- |
| 50019 | `CredentialInvalid`       | 凭证缺失 / 无效 / 已吊销 / 已过期   | 对外四端点，HTTP 401 + `WWW-Authenticate` |
| 50020 | `CredentialQuotaExceeded` | 凭证数达上限                        | 管理侧创建                                |
| 50021 | `CredentialScopeInvalid`  | scope 引用未暴露 / 不存在的表或字段 | 管理侧创建 / 编辑                         |

复用：40001 / 40400 / 42900 / 50001 / 50009。**50xxx 段用至 50021，下一可用 50022**；30xxx / 40xxx 本期零新增。

### 22.6 配置登记（新增 access 组，`src/config/access.config.ts`，env 前缀 `ACCESS_*`）

`access.maxCredentialsPerUser=20` / `access.quotaPerMinute=120` / `access.quotaPerDay=50000` / `access.rowsPerDay=100000` / `access.auditRetentionDays=90` / `access.auditFlushMs=5000`。

### 22.7 AI 工具与手册

- **工具零新增（43 不变）**；`create_display_app` / `authorize_data_app` 的文案与站点 README 三模板取数路径同步改为 `./api/app/<appCode>/...`（R124 修订）→ 属工具链变更，**`pnpm smoke:ai` 必跑**（实施结果：8/8 全绿；`check:ai` 19/19）。
- 手册（`PLATFORM-GUIDE.md`）「接入凭证」一行**先腾挪后净增**（合注上限 2000 字）。

### 22.8 验收实测（T138 回执摘要）

- **`pnpm smoke:ext`（本期新增可重跑资产 `scripts/smoke-ext-access.ts`）41/41 通过**（交付时 35/35；2026-10-01 按 P15 走查 C1~C3 补 6 项：keyId 唯一约束、scope 字段通配 50021、附件流端到端）：凭证生命周期 6 项、对外取数 9 项（含游标翻页不重 / 单调键不重不漏 / scope 收窄 / 越权 40400）、错误语义 8 项（401+WWW-Authenticate、非匹配 appCode、`is_public=0`、轮换与吊销即时性）、开放层粒度 3 项（展示应用级收窄 + 旧路径 40400）、审计 5 项（正例 / 负例 / 匿名层埋点 / 属主检索）、静态文件正例 4 项（目录按需创建 / 静态入口含页面标记 / 页面内同源取数 / 无文件应用 40400）。
- `check:ai` 19/19；`smoke:ai` 8/8（F/I/J/K/L/M/N/O）；api `tsc` / web `vue-tsc` / ESLint 零错。

### 22.9 编号登记

| 系列      | 本期使用                                                   | 说明                        |
| --------- | ---------------------------------------------------------- | --------------------------- |
| 决策      | D119~D128（+D129/D130 下期预登记）                         | PRD-P15 §2                  |
| 规则      | R130~R141                                                  | PRD-P15 §4                  |
| 任务      | T132~T138                                                  | 见 PROGRESS「P15 任务拆解」 |
| HTTP 端点 | +11（管理侧 7 + 对外 4）；开放层 4 端点改路径（旧 4 退役） | §22.1 / §22.2 / §22.4       |
| 错误码    | +3（50019~50021），下一可用 50022                          | §22.5                       |
| DB        | +2 表（acc_credential / acc_audit）                        | ARCHITECTURE §31.2          |
| AI 工具   | +0（43 不变；文案改动已跑 smoke:ai）                       | §22.7                       |
| 新依赖    | +0（MCP SDK 特批属下期）                                   | PRD-P15 D130                |

---

## 23. P15-C：MCP 适配器（协议适配层）

> 在 §22 的对外契约之上加**第二层协议适配**（REST 语义 → JSON-RPC 工具语义），让外部 Agent（Claude Desktop / Cursor 等）
> 以 MCP 客户端身份读取已授权数据应用。**零新表、零新数据通道、零新错误码、零新配置键**（D129~~D134 / R142~~R146）。
> 需求基线：`docs/P15C/`（PRD / ARCHITECTURE / API 三份增补）；本节为主文档收编，**§23.7 列出实施期实测校正**。

### 23.1 端点与传输

| 方法       | 路径           | 行为                                             |
| ---------- | -------------- | ------------------------------------------------ |
| POST       | `/api/ext/mcp` | Streamable HTTP（**无状态模式**），JSON-RPC 2.0  |
| GET/DELETE | `/api/ext/mcp` | **405** + `Allow: POST` + `code=40001`（无条件） |

请求头：

```http
Authorization: Bearer {keyId}.{secret}
Content-Type: application/json
Accept: application/json, text/event-stream
```

- **凭证即隐含应用**（D126 推论）：端点不带 `appCode`，由凭证行解析应用；凭证绑定应用须**未软删且 `is_public=1`**（否则 40400，与 §22.2 第 ③ 步同口径）。
- **无状态**（D131）：每请求独立 `McpServer` + `StreamableHTTPServerTransport`（不生成 `sessionId`、不存会话、不开启服务端推送），响应结束即销毁 → 无会话存储、Redis 零新增键、横向扩容无障碍。
- 响应体为 `application/json`（`enableJsonResponse`，非 SSE 流）；`GET`（SSE 流）/`DELETE`（会话终止）在无状态模式下本就不支持，**明确 405 优于静默 404**。
- **405 不经过凭证守卫**（守卫只挂 POST）：405 不触任何数据与凭证逻辑，且 R142 要求「一律 405」。
- **每个 JSON-RPC POST 计 1 次请求配额**（含 `initialize` / `tools/list`，防空握手刷接口）；行数配额仅在数据工具执行后记账。

### 23.2 JSON-RPC 方法

| 方法         | 说明                                                         |
| ------------ | ------------------------------------------------------------ |
| `initialize` | 握手；返回 `serverInfo`（`iplat-ext`）+ `capabilities.tools` |
| `tools/list` | 返回恰好三个工具（§23.3），无第四个                          |
| `tools/call` | 入参 `name` + `arguments`                                    |
| 其余 / 通知  | 标准协议错误（SDK 自理）；审计 event 记 `mcp.{method}`       |

### 23.3 工具定义（R143 冻结；名称带 `iplat_` 前缀，防客户端多服务器命名冲突）

**`iplat_get_schema`**：入参 `{}`（无参）。返回 `{ app, tables }`——与 §22.2 `GET .../schema` 的 `data` 段**逐字段一致**（同一 `publicSchema` + 同一 scope 投影）。不计行数。

**`iplat_query_records`**：分页读表，与 §22.2 列表端点同参同结果。

| 入参     | 类型     | 说明                                                    |
| -------- | -------- | ------------------------------------------------------- |
| `table`  | string   | 必填；须 ∈ `scope.tables`（越权 → 40400）               |
| `size`   | number   | 可选；1~50，缺省 20（R104）                             |
| `cursor` | string   | 可选；上一页 `paging.nextCursor` 原样回传               |
| `sort`   | string[] | 可选；≤2 项，形如 `"字段:asc"`（R104）                  |
| `filter` | string[] | 可选；≤3 项，形如 `"字段:eq:值"` / `"字段:contains:值"` |
| `expand` | string   | 可选；≤1 项                                             |

返回 `{ data: [...], paging: { nextCursor, size } }`；**`nextCursor` 与 REST 的 `after` 跨协议可混用**（同一游标编码器）。行数按返回行数事后记账。

**`iplat_get_record`**：入参 `table`（必填）+ `rowId`（必填）。返回 `{ data: {...} }`——与 §22.2 单条端点同源。行数记 1。

**输出双形态（R143）**：每个工具结果同时给 `structuredContent`（JSON 对象）与 `content[0].text`（同一对象的 JSON 字符串，兼容旧客户端）。

**工具描述**：面向外部 LLM，只陈述用途 + 关键约束（上限 / 必填项），不含内部实现、URL 与 secret。

### 23.4 错误映射（R144，**实测口径**）

**分层原则**：认证与配额在 **HTTP 层**（客户端可自动发现与重试），业务语义在**工具结果内**（Agent 读文本自纠）。

| 场景                                                                 | 层       | 表现                                                           |
| -------------------------------------------------------------------- | -------- | -------------------------------------------------------------- |
| 无 / 伪 / 已吊销 / 已过期凭证                                        | HTTP     | `401` + `WWW-Authenticate: Bearer realm="iplat-ext"` + `50019` |
| 请求 / 行数配额超限                                                  | HTTP     | `429` + `Retry-After` + `X-RateLimit-*` + `42900`              |
| 方法不允许（GET / DELETE）                                           | HTTP     | `405` + `Allow: POST` + `40001`                                |
| 表未暴露 / 越权行 / 应用不可见                                       | 工具结果 | `isError=true`，text 含 `40400`                                |
| **入参形状 / 边界违例**（size>50、类型错、缺必填）                   | 工具结果 | `isError=true`，text 含 **`-32602`**（SDK 前置 zod 校验）      |
| **入参语义违例**（filter/sort 格式、字段不存在、游标与 sort 不一致） | 工具结果 | `isError=true`，text 含 `40001`                                |
| 未知方法                                                             | JSON-RPC | 标准 `-32601`（SDK 自理）                                      |

> 注：`50021`（scope 越界）**不在 MCP 错误面**——它是凭证 scope 创建 / 编辑期的错误（管理侧，§22.4），
> 不在工具执行链上（详见 §23.7 ②）。

### 23.5 配额与审计口径（R145）

- **请求配额**：每个 JSON-RPC POST 计 1（`initialize` / `tools/list` / `tools/call` 均计），分钟窗 + 日窗，按**凭证**而非 IP。
- **行数配额**：`iplat_query_records` 按返回行数、`iplat_get_record` 记 1 行，响应后记账。
- **响应头**：成功与 `429` 均回带 `X-RateLimit-Remaining-Minute / -Day` / `X-RateLimit-Rows-Remaining-Day`。
- **审计 event**：`mcp.initialize` / `mcp.tools.list` / `mcp.tools.call`（其余方法 `mcp.{method}`）；
  `paramsSummary` = 工具名 + 入参摘要（≤512 字，**不含响应内容与 secret**）；401 由守卫留痕（`ownerId=0` 系统流水）。
- **查询入口**：`GET /api/access/audits`（§22.4，属主隔离；`credentialId` 精确过滤）。

### 23.6 客户端配置示例（D133 最小产品化）

> 示例以各客户端当期官方文档为准；`<keyId>.<secret>` 为创建凭证时**一次性展示**的完整 Key。

**Claude Desktop**（经 mcp-remote 代理）：

```json
{
  "mcpServers": {
    "iplat": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://<你的域名>/api/ext/mcp",
        "--header",
        "Authorization: Bearer <keyId>.<secret>"
      ]
    }
  }
}
```

**Cursor**（`.cursor/mcp.json`，原生支持远程 URL + 请求头）：

```json
{
  "mcpServers": {
    "iplat": {
      "url": "https://<你的域名>/api/ext/mcp",
      "headers": { "Authorization": "Bearer <keyId>.<secret>" }
    }
  }
}
```

**curl 冒烟**：

```bash
curl -X POST https://<你的域名>/api/ext/mcp \
  -H "Authorization: Bearer <keyId>.<secret>" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

### 23.7 实施期实测校正（相对需求基线 `docs/P15C/`）

实施与 `smoke:mcp`（36 项）实测出以下 6 处偏差，**以本节与代码为准**：

1. **`iplat_get_schema` 返回形状**：基线写 `{ appCode, tables }`，实现为 `{ app, tables }`——
   验收 #3 要求「与 REST `GET .../schema` 逐字段一致」，而 REST 的 `data` 段是 `{ app, tables }`（§22.2）。
   加 `appCode` 会破坏逐字段比对，故以验收标准为准（工具调用方本就知道自己在读哪个应用，凭证即隐含应用）。
2. **`50021` 不出现于工具结果**：基线 §23.4 列了「字段通配 `*` → `50021`」，但查询链没有任何路径接受通配符，
   且 `50021` 属凭证 `scope` 校验（管理侧）。工具层的入参违例实际分两层（见 §23.4 表）。
3. **SDK 前置校验的表现形态**：zod 边界/形状违例由 SDK 在进入工具前拒绝，**表现为工具结果 `isError=true` + 文本含
   `-32602`**（SDK 不抛 JSON-RPC `error` 帧）。这属 SDK 实现细节，R144 的「协议层错误」在实测口径下即此形态。
4. **新依赖为 `+2`（`@modelcontextprotocol/sdk` + `zod`）**：D130 只特批了 SDK，但 **SDK 的工具入参只接受 zod 形态**
   （`AnySchema = z3.ZodTypeAny | z4.$ZodType`，不支持 JSON Schema / Standard Schema），而 `zod` 在 SDK 中仅是
   `peerDependency`——pnpm 隔离下不显式声明则工具连 `inputSchema` 都无法声明（省略则客户端 LLM 不知参数结构，违反验收 #2）。
   故 `zod ^3.25` 与 SDK 同批引入（版本由 `pnpm-lock.yaml` 锁定）。**建议登记为 D135 或修订 D130 的依赖口径。**
5. **工具注册出口 `mcp/tool-registry.ts`（唯一类型切断点）**：SDK 的 `registerTool` 泛型会对入参做逐键 `ShapeOutput`
   展开并叠加 zod v3/v4 双版本兼容类型，实测在 TS 5.8 下**任何**调用都触发 `TS2589`（连 `z.array(z.string()).optional()`
   都炸；加大编译堆至 4 GB 后仍失败）。处置：该文件内以 `as unknown as` 收敛 `registerTool` 签名，**运行时行为零差异**
   （SDK 原方法、zod 校验照常、JSON Schema 照常下发），仅不再静态推导 handler 入参形状。SDK 修好类型后删该文件即可。
6. **`405` 不经过凭证守卫**：基线只说「GET/DELETE → 405」，实现上把守卫从类级下移到 POST——
   否则未认证的 GET 会先撞 401，405 永不可达（实测确认）。

### 23.8 编号登记

| 系列          | 本期使用                                      | 说明                          |
| ------------- | --------------------------------------------- | ----------------------------- |
| 决策          | D131（MCP 端点形态）；D129/D130 正式启用      | PRD-P15-C §2                  |
| 规则          | R142~R146                                     | PRD-P15-C §3                  |
| 任务          | T139~T143                                     | 见 PROGRESS「P15-C 任务拆解」 |
| HTTP 端点     | +1（`POST /api/ext/mcp`；GET/DELETE 405）     | §23.1                         |
| 对外 MCP 工具 | +3（`iplat_` 前缀冻结；加工具须先修订 R143）  | §23.3                         |
| 错误码        | +0（下一可用仍为 `50022`）                    | §23.4                         |
| 配置键        | +0                                            | —                             |
| DB            | +0                                            | ARCHITECTURE §32.2            |
| 内部 AI 工具  | +0（43 不变）                                 | §23.7                         |
| 新依赖        | **+2**（`@modelcontextprotocol/sdk` + `zod`） | §23.7 ④                       |
| 验收资产      | +1（`smoke:mcp`，36 项）                      | ARCHITECTURE §32.10           |

---

## 24. P17：凭证行级过滤 `scope.rowFilter`（授权第四纵深）

> 在 §22 的表 / 字段 / 操作三纵深之上启用**行级**收窄（槽位 P15 预留、本节启用）：凭证持有方只能读到
> 满足条件的行子集。**零新表（槽位既有，零迁移）、零新端点、零新错误码、零新依赖、内部 AI 工具 43 与
> 对外 MCP 工具 3 均不变**。需求基线：`docs/P17/`（PRD / ARCHITECTURE / API 三份增补）；本节为主文档收编。
>
> 关联补丁 **W11（T151）**：对外附件流纳入 scope 收窄（§22.11）。

### 24.1 scope JSON 结构（槽位启用，DDL 不变）

```json
{
  "tables": ["book"],
  "fields": { "book": ["title", "status", "cover"] },
  "ops": ["read"],
  "rowFilter": { "book": ["status:eq:published"] }
}
```

- `rowFilter`：`{ [表名]: ["字段:算子:值", …] }`，可缺省 / `null`（不过滤，现行行为）；**每表 ≤3 条**；表内多条件 **且** 关系。
- 语法与算子集：**与 §22.2 请求 `filter` 完全同源**（同一实现 `apps/api/src/common/utils/query-filter.util.ts`）；算子取 `eq` / `contains`（`contains` 仅文本 / 枚举字段）。
- 约束：表 ∈ `scope.tables`；字段须在暴露开关内，且 ∈ 该表 scope 字段口径（`fields` 未配该表 = 该表全部已暴露字段）——**禁止引用不可见字段**。

### 24.2 管理侧端点行为（端点号沿用 §22.4，零新增）

| 端点                                      | 变化                                                             |
| ----------------------------------------- | ---------------------------------------------------------------- |
| `POST /api/access/credentials`（创建）    | body `scope.rowFilter` 启用；非法 → **`50021`**，errmsg 指明条目 |
| `PUT /api/access/credentials/:id`（编辑） | 同上（编辑后**立即生效**，凭证校验不缓存）                       |
| `GET /api/access/credentials*`            | 响应 `scope.rowFilter` 原样返回                                  |

校验顺序：`tables` → `fields` → `ops` → **`rowFilter`**（逐条；表 → 字段口径 → 暴露 → 算子 → 值类型）。errmsg 形如
`scope.rowFilter.book 条目「status:like:x」：filter op 仅允许 eq/contains：status:like:x`。

### 24.3 对外取数行为变化（REST §22.2 与 MCP §23.3 同源）

- **records**：rowFilter 强制 AND 注入；与请求 `filter` 取交集；**条件冲突 → `code 0` 空页**（不报错）。
  ⚠️ **同字段冲突尤其注意**：请求 `filter` 与 rowFilter 落在同一字段时，两者是**并列 AND**（取交集 = 空页），
  **不是**后者覆盖前者（见 §24.7 ①，该口径由本期修复保证）。
- **detail**：行不满足 rowFilter → **`40400`**（与「行不存在」同表现，防探测不裂缝）。MCP `iplat_get_record` 同源同表现。
- **schema**：不变——过滤条件本身**不对外下发**（`projectSchema` 不输出 `rowFilter`）。
- **附件流**：rowFilter **不参与**附件可见性判定（附件随记录可见性：记录因 rowFilter 不可见时，其 fileId 本来就不会出现在该凭证的结果里）。
- 游标 / 排序 / 配额 / 审计口径：全部不变（rowFilter 是常量 WHERE 段，与 keyset 正交；行数配额按实际返回行数记账，收窄只少不多）。

### 24.4 运行期失效（R149）

rowFilter 引用的表 / 字段在签发后被下线或取消暴露 → 该表**整体判不可见（40400）**，
**不静默跳过失效条目**（跳过 = 结果集意外放大 = 安全回归）；恢复暴露即**自愈**，无需改凭证。

### 24.5 错误码（零新增）

| 码      | 场景                                                                          |
| ------- | ----------------------------------------------------------------------------- |
| `50021` | 管理侧 rowFilter 非法（表 / 字段 / 算子 / 值类型 / 超 3 条），errmsg 指明条目 |
| `40001` | 请求 `filter` / `sort` 等参数自身违例（既有口径）                             |
| `40400` | 行不满足 rowFilter / 运行期失效判拒 / 越权（既有口径）                        |

下一可用仍为 `50022`。

### 24.6 客户端视角（对接方须知）

- 无需任何改动：收窄对调用方**透明**（同端点在只读范围内返回更少的行）。
- 收窄不是错误：不满足条件的行表现为「不存在」（列表少行 / 详情 40400）。
- **不要试图用同字段 `filter` 覆盖**：与 rowFilter 是取交集，冲突即空页（§24.3）。

### 24.7 实施期实测校正（相对需求基线 `docs/P17/`）

1. **同列多条件的 SQL 下推必须并列 AND**（本期实测抓出的**真缺陷**，已在 `DataService.buildDbWhere` 修复）：
   原先同一 `r_cN` 列的多条条件用 `Object.assign` 组装，**后者覆盖前者**；rowFilter 引入后这意味
   凭证持有者可用同字段 `filter` **顶掉强制条件**、读到授权外的行（收窄变放宽）。修复后同列条件走 `AND` 数组，
   语义与内存过滤路径（`filters.every`）一致。**取证**：`smoke:ext` 「条件冲突 → 空页」用例（修复前返回 2 行，修复后空页）。
2. **W11 附件流收窄的实现方式**：基线写「`attachmentStream(appCode, fileId, principal)` 判定链加一步」，
   实现改为**调用方注入谓词**（`refFilter?: (table, field) => boolean`）——app 域不认识凭证概念（单向依赖），
   access 域提供 scope 交集判定；语义与基线一致（全部引用越界 → 40400）。
3. **`rowFilter` 为空对象 / 全空值** 归一为 `null`（不过滤），与「未配置」同义。
4. **新增依赖 `+0`**，但**新增公共实现文件** `common/utils/query-filter.util.ts`（R104 过滤语法单一实现，
   pub 域与 access 域共用；抽公共层是为满足 R147 的「同一解析器」且不违反铁律 6）。

### 24.8 编号登记（本期后）

| 系列      | 本期使用                                                         | 下一个可用 |
| --------- | ---------------------------------------------------------------- | ---------- |
| 决策      | D136 / D137 / D138                                               | D139       |
| 规则      | R147~R150                                                        | R151       |
| 任务      | T151（W11 补丁）/ T152~T154                                      | T155       |
| HTTP 端点 | +0                                                               | —          |
| 错误码    | +0（复用 `50021`）                                               | `50022`    |
| 配置键    | +0                                                               | —          |
| DB        | +0（scope JSON 槽位既有，零迁移）                                | —          |
| 新依赖    | +0                                                               | —          |
| 前端      | +1 文本域（凭证抽屉「只看部分数据」）                            | —          |
| 验收资产  | smoke:ext +16 项（W11 三条 + rowFilter 十三条）/ smoke:mcp +3 项 | —          |

---

## 25. P18：OAuth2 client_credentials（接入凭证第二形态）

> 为接入凭证加第二形态：用 `client_id` / `client_secret` 换**短时效 access token**，再以 `Bearer it_*`
> 调 §22（REST）/ §23（MCP）全部端点。**API Key 与 OAuth2 并存**，互不影响；资源端点契约不变，
> 唯一变化是 `Authorization` 头接受两种 Bearer 形态。需求基线：`docs/P18/`；实施补充见 §25.5。

### 25.1 新端点（+1）

#### `POST /api/ext/oauth/token`

请求（form-urlencoded 优先，JSON 宽容）：

```http
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&client_id=ik_3f9ab2c7d1&client_secret=X7k...
```

成功 `200`（RFC 6749 §5.1，**非平台 envelope**）：

```json
{ "access_token": "it_9f2...", "token_type": "Bearer", "expires_in": 3600 }
```

错误（RFC 6749 §5.2，**非平台 envelope**）：

| 场景                                     | HTTP | body                                                                           |
| ---------------------------------------- | ---- | ------------------------------------------------------------------------------ |
| client_id / secret 错、凭证已吊销 / 过期 | 401  | `{ "error": "invalid_client" }` + `WWW-Authenticate: Bearer realm="iplat-ext"` |
| `grant_type` 缺失                        | 400  | `{ "error": "invalid_request" }`                                               |
| `grant_type` 非 `client_credentials`     | 400  | `{ "error": "unsupported_grant_type" }`                                        |
| 签发计入请求配额超限                     | 429  | 平台口径（`42900` + `Retry-After` + `X-RateLimit-*`）                          |

- 每次签发计该凭证**请求配额 +1**（不计行数）；审计 event `ext.oauth.token`（正负例落表，摘要不含 secret）。
- `access.tokenTtlSeconds`（`ACCESS_TOKEN_TTL_SECONDS`，默认 3600）为本期唯一新增配置键。
- **api_key 型凭证同样可换令牌**（D141 迁移路径）；`oauth` 型凭证的 secret **不得直连资源端点**（须走本端点）。

### 25.2 资源端点双形态（R153/R154）

| Authorization 头                | 形态         | 校验                                                     |
| ------------------------------- | ------------ | -------------------------------------------------------- |
| `Bearer ik_xxxxxxxxxx.{secret}` | API Key      | 既有 sha256 比对（不缓存），`type` 须 `api_key`          |
| `Bearer it_...`                 | access token | Redis 查 `acc:token:{sha256}` → **实查凭证行**校验有效性 |

- 失败统一：`401` + `WWW-Authenticate: Bearer realm="iplat-ext", error="invalid_token"` + body `{ code: 50019 }`（§22 口径不变）。
- 吊销 / 轮换 secret / 凭证到期 → 该凭证**全部令牌即时失效**（不等 TTL）。
- **令牌使用期 scope 恒以凭证行为准**：签发后收窄 scope 或改 rowFilter，存量令牌立即按新授权生效（无需重新换发）。
- MCP 端点（§23）同守卫，故令牌同样可用于 `/api/ext/mcp`；手动配置仍推荐 API Key（令牌 1 小时过期）。

### 25.3 管理侧契约变化（端点号沿用 §22.4，零新增）

| 端点                              | 变化                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------- |
| `POST /api/access/credentials`    | body 增 `type?: "api_key" \| "oauth"`（缺省 `api_key`）；非法值 40001；响应同构 |
| `PUT /api/access/credentials/:id` | **类型不可变**（D141）：带 `type` → `40001`（显式报错，不静默忽略）             |
| `GET /api/access/credentials*`    | 响应增 `type` 字段                                                              |

### 25.4 客户端示例

```bash
# ① 换 token
curl -X POST https://<你的域名>/api/ext/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials&client_id=<keyId>&client_secret=<secret>"

# ② 用 token（REST 与 MCP 通用）
curl https://<你的域名>/api/ext/v1/app/<appCode>/tables/book/records \
  -H "Authorization: Bearer it_9f2..."
```

**分工口径**：程序化集成用 OAuth2（自动换发、短时效、标准协议库可直用）；手动配置（MCP 客户端、curl 调试）
仍推荐 API Key。

### 25.5 实施补充（相对需求基线 `docs/P18/`）

1. **`type` 不可变的错误面**：`UpdateCredentialDto` 显式声明 `type` 字段，服务层据此返回 40001——
   若 DTO 不声明，全局 `ValidationPipe` 的 `whitelist: true` 会**静默剥离**该字段，用户会以为改成功了。
2. **配额计入时机**：仅在客户端**通过校验后**计数（D142 推论）——否则凭猜测 keyId 即可刷空他人配额。
3. **审计负例归属**：`invalid_client` 无凭证上下文 → `ownerId=0` 系统流水（不进属主检索）；
   smoke 分两条断言核对（属主侧正例 + `ownerId=0` 直查负例）。
4. **令牌自然过期**：Redis TTL 到点即失效，无清理任务；索引中的孤儿摘要在下次签发时顺带清扫。

### 25.6 编号登记（本期后）

| 系列         | 本期使用                                                    | 下一个可用 |
| ------------ | ----------------------------------------------------------- | ---------- |
| 决策         | D139~D142                                                   | D143       |
| 规则         | R151~R155                                                   | R156       |
| 任务         | T155~T158                                                   | T159       |
| HTTP 端点    | +1（`POST /api/ext/oauth/token`）                           | —          |
| 对外工具     | +0（REST 4 端点 × 双形态；MCP 3 不变）                      | —          |
| 错误码       | +0（token 端点走 RFC 格式；资源端点复用 50019 / 42900）     | 50022      |
| 配置键       | +1（`access.tokenTtlSeconds` = `ACCESS_TOKEN_TTL_SECONDS`） | —          |
| DB           | +1 列（`acc_credential.type`，迁移）                        | —          |
| 新依赖       | +0                                                          | —          |
| 内部 AI 工具 | +0（43 不变）                                               | —          |
| 验收资产     | smoke:ext 57→76（+19）/ smoke:mcp 39→41（+2）               | —          |

---

## 26. P19：站点发布与版本管理（不可变快照 + 指针翻转）

> 站点内容从「云盘工作副本直挂公网」升级为**双轨**：站点发布过版本后，开放层服务**不可变快照**；
> 从未发布则维持 legacy 直挂。一次解决三件事：**权限平面解耦**（快照轨不消费 `is_public`）、
> **写入原子性**（快照 + 指针翻转）、**回滚与故障隔离**（云盘改动不再直达公网）。
> 需求基线：`docs/P19/`；**前置补丁 W12（公开判定链统一为阻断优先）见 ARCHITECTURE §35.6**——
> 它修订的是站点开放层 `/api/open/**` 的公开判定语义：**文件自身显式公开不再穿透父级显式阻断**，
> 与 `/api/pub/**` 链统一。本节 legacy 轨直接继承该语义。

### 26.1 端点（+6 管理态；开放层行为变更，无新端点）

| #   | 方法   | 路径                                          | 说明                                     |
| --- | ------ | --------------------------------------------- | ---------------------------------------- |
| 1   | POST   | `/api/site/manage/:id/publish`                | 发布快照并置为当前（**发布即上线**）     |
| 2   | GET    | `/api/site/manage/:id/releases`               | 版本列表（倒序，不分页）                 |
| 3   | POST   | `/api/site/manage/:id/releases/:rid/activate` | 切换当前版本（**回滚 = 切旧版**）        |
| 4   | POST   | `/api/site/manage/:id/releases/:rid/pin`      | 锁定 / 解锁 `{ pinned: boolean }`        |
| 5   | DELETE | `/api/site/manage/:id/releases/:rid`          | 删除版本（当前 / 锁定版拒绝）            |
| 6   | GET    | `/api/site/manage/:id/preview/*path`          | 预览轨：读**工作副本**出流（管理态专用） |
| —   | GET    | `/api/open/:slug/**`                          | **行为变更**：双轨解析（无新端点）       |

权限：1~6 需登录 + `site:site:manage`（未登录 401 / 无权限 403 / 非属主站点 40400）；开放层维持公开 + 限流 + 40400。

### 26.2 契约要点

**发布**（1）：`{ label?: string }`（≤100 字，超长 40001）→
`{ id, versionNo, label, fileCount, totalBytes, pinned, createdBy, createdAt, active: true }`；
失败：**40121**（同站并发发布）/ 40400 / 403。

**列表**（2）：版本对象数组（字段同上，`active` 标记当前版本）。

**切换**（3）：无请求体 → 返回被激活版本；`site.active_release_id` 同步翻转、缓存即时失效，下一次开放层请求即生效。
目标不存在 / 不属于该站点 → 40400。

**锁定**（4）/ **删除**（5）：锁定版豁免自动清理与手动删除；当前版本不可删（二者均 40001 并说明原因）。

**预览**（6）：读工作副本出流，安全件与开放层同款（MIME 白名单 + CSP 沙箱 + nosniff + ETag/304 + `no-cache`）；
**不消费 `is_public`**（属主对自己站点内任何文件均可预览）。

### 26.3 开放层行为变更（§22 的补充）

- `site.active_release_id` 非空 → **快照轨**：从 `site-releases/{siteId}/{releaseId}/` 出流，**不消费 `is_public` 三态**（R161 权限解耦）；
- 为空 → **legacy 轨**：直挂工作副本（公开判定遵循 **W12 阻断优先**语义，见 §22.2 注）；
- `:slug/disp/{id}/**` 展示应用托管链**不进快照**、维持实时语义（独立授权链）；
- 其余安全件、限流、ETag/304、`no-cache`、40400、回退链**全部不变**，调用方无感知。

### 26.4 错误码增量

| 码      | 含义                           | HTTP         |
| ------- | ------------------------------ | ------------ |
| `40121` | 发布进行中（同站并发抢锁失败） | 200 + 业务码 |

其余复用 40001 / 403 / 40400；下一可用仍为 `50022`。

### 26.5 配置增量

| 配置键             | 环境变量            | 默认 | 说明                                         |
| ------------------ | ------------------- | ---- | -------------------------------------------- |
| `site.releaseKeep` | `SITE_RELEASE_KEEP` | 20   | **未锁定**版本保留上限；当前版本与锁定版豁免 |

### 26.6 实施期实测校正

1. **发布 / 切换 / 删版必须同时失效 slug 缓存**：`site:resolve:{slug}`（TTL 300s）自 P19 起含 `activeReleaseId`——
   漏失效会让开放层继续按旧轨解析（`smoke:site` 实测踩到：发布后仍直挂工作副本；且首轮「发布后内容正确」
   是**假绿**，因工作副本恰好等于 v1）。
2. **快照轨不做 301 补斜杠**：回退链已含 `{path}/index.html`，快照目录不可变故无相对基址漂移问题（D148 取向）。
3. **`disp/` 显式走 legacy**：`serve()` 增 `track` 参数，展示应用两个路由传 `'legacy'`，避免其在快照轨下 404。
4. **版本行与快照目录同生共死**：发布失败删除刚建的行；删版 / 保留清理同时删目录；删站级联两者（`purgeForSite`）。

### 26.7 编号登记（本期后）

| 系列         | 本期使用                                                      | 下一个可用 |
| ------------ | ------------------------------------------------------------- | ---------- |
| 决策         | D143~D151                                                     | D152       |
| 规则         | R156~R161                                                     | R162       |
| 任务         | T159~T164（W12 补丁为清单外 T165）                            | T166       |
| HTTP 端点    | +6 管理态（开放层行为变更，零新端点）                         | —          |
| 错误码       | +1（`40121`）                                                 | `50022`    |
| 配置键       | +1（`site.releaseKeep`）                                      | —          |
| DB           | +1 表（`site_release`）+1 列（`site_site.active_release_id`） | —          |
| 新依赖       | +0                                                            | —          |
| 内部 AI 工具 | +0（43 不变；`write_site_files` 文案改草稿语义）              | —          |
| 验收资产     | +1（`smoke:site` 35 项）+ smoke:ext 76→77（销 P18-C1）        | —          |

---

## 27. P20：展示应用目录独立、版本检查点与局部发布

> 三件事一个主题：**展示应用的内容归属**。目录从站点树中独立（恒定位 `disp-staging/{属主}/{id}`），
> 挂靠退化为纯关系；属主可存「版本检查点」并恢复到工作区；站点发布支持「只替换某一个展示页」。
> 详见 ARCHITECTURE §36。**零新配置键、内部 AI 工具 +0**；错误码 +1（`50022`）。

### 27.1 挂靠语义变更（既有端点 `PUT /api/display/:id/affiliate`）

挂靠 / 换挂靠 / 取消挂靠**只改 `disp_display.site_id`，不再移动任何文件**——工作区路径恒定位，
换挂靠零文件操作（原「目录随挂靠搬迁」的实现连同其三个缺陷一并移除：`disp/disp/` 双层目录、
整树搬迁牵连同站其它应用、移动中断后开放层 404）。`folderId` 列表接口恒可解析（含未挂靠）。

### 27.2 版本检查点（新端点组，`/api/display/:id/releases*`，属主自服务）

| 端点                                          | 说明                                                                                               |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `GET /api/display/:id/releases`               | 版本列表（新 → 旧）                                                                                |
| `POST /api/display/:id/releases`              | 保存当前工作区为不可变检查点（`label` 可选 ≤100 字；还没有页面文件 → 40001；并发保存 → **50022**） |
| `POST /api/display/:id/releases/:rid/restore` | 恢复到工作区：现有内容先**软删进回收站**（可撤回），再写回该版本                                   |
| `PUT /api/display/:id/releases/:rid/pin`      | 锁定 / 解锁（锁定后豁免删除）                                                                      |
| `DELETE /api/display/:id/releases/:rid`       | 删除（已锁定 → **50022**）                                                                         |

检查点存于 `disp-releases/{displayId}/{releaseId}/`（平台自营区，不进云盘树），含 `manifest.json`。
**与站点发布刻意分治**：站点版本是「上线」（面向公网、不可变、指针翻转），检查点是「存档」
（面向属主、可反复写回）——不共用表、不互为前提。

### 27.3 局部发布（`POST /api/site/manage/:id/publish` 增可选参数）

```json
{ "label": "只发首页", "onlyDisplayId": "123" }
```

以站点**当前版本快照为蓝本**，只替换 `disp/{id}/` 子树后生成新版本——线上其它内容
（站点页面、别的展示页）原样不动，别的未发布改动**不会**被顺手带上线。蓝本 manifest 条目
直接沿用（不重算 sha256）。站点从未发布过 → **40001**（局部发布没有蓝本）。

### 27.4 编号登记（本期后）

| 系列      | 本期使用                                                      | 下一可用 |
| --------- | ------------------------------------------------------------- | -------- |
| 决策      | D152~D153                                                     | D154     |
| 规则      | R161~R162                                                     | R163     |
| 任务      | T165~T172                                                     | T173     |
| 错误码    | +1（`50022`）                                                 | `50023`  |
| DB        | +1 表（`disp_release`）                                       | —        |
| HTTP 端点 | +5（检查点组）                                                | —        |
| 验收资产  | smoke:site 35→**40**（第 12 段：目录独立/聚合/局部发布 7 项） | —        |
