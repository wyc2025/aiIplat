# iplat —— 接口契约（API.md）

> 本文档是前后端接口的唯一事实来源。与代码冲突时以本文档为准并修正代码。
> 通用约定（统一响应、错误码、分页、bigint→string、时间格式）见 ARCHITECTURE.md 4.3 节，此处不再重复。
> 当前覆盖：P2a（ai 域 + system 域在线用户增量）。system 域既有接口以代码与 Swagger 为准。

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
