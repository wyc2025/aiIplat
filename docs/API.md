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

| code  | 含义                                                   | 前端处理               |
| ----- | ------------------------------------------------------ | ---------------------- |
| 30001 | 文件/文件夹不存在或无权访问                            | 刷新当前目录列表       |
| 30002 | 同目录下已存在同名项                                   | 提示更换名称           |
| 30003 | 存储配额不足                                           | 提示用量与配额         |
| 30004 | 文件超出大小限制                                       | 提示上限值             |
| 30005 | 该类型不支持预览                                       | 提示"请下载查看"       |
| 30006 | 超出目录限制（深度>10 / 单目录>500 项 / 名称>64 字符） | 提示具体限制           |
| 30007 | 回收站记录不存在                                       | 刷新回收站列表         |
| 30008 | 分享链接无效（不存在/已停止/已过期/文件已删/未过审）   | 访客页提示失效         |
| 30009 | 文件夹暂不支持创建分享链接                             | 提示                   |
| 30010 | 文件未通过内容审核，禁止分享                           | 提示（开关开启后生效） |
| 30011 | 用户仍有云盘文件，禁止删除（R10 删用户预检）           | 提示                   |

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

三者均校验数据归属当前用户（30001）。

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

| 方法 | 路径                          | 说明                                                                                                                       |
| ---- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| POST | /api/cloud/share/create       | body 加 `password?: string`（4~8 位，留空 = 无密码）；`fileId` 可为**文件夹**（D48）；响应加 `hasPassword: boolean`        |
| GET  | /api/cloud/share/list         | item 加 `itemType: 'file'\|'folder'`、`hasPassword: boolean`（**不返回密码本体**）                                         |
| POST | /api/cloud/share/:id/password | 修改 / 移除提取码（body `{ password: string\|null }`，null 或空 = 移除）；响应 `{ id, hasPassword }`；变更后旧访问凭证失效 |

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

## 14. P7：站点内容池化（内容归用户 + 多站发表 + 路径美化）

> 决策 D73~~D78 / 规则 R75~~R78，见 `docs/P7/PRD-P7-STORY-DEMAND.md`。增补文档 `docs/P7/API-P7-增补.md` 已并入（保留为历史参考，冲突以本文为准）。
> **新增 HTTP 端点 2 个**（14.2）；**新增错误码 1 个**：40120（删除用户仍有站点）；AI 工具总数维持 28；前端依赖零新增。
> 数据模型变更见 ARCHITECTURE §22.2；迁移文件 `20260916100000_p7_content_pool`（执行前必须备份）。

### 14.1 内容端点改用户级（修改既有）

| 方法   | 路径                        | 变化                                                                                                                         |
| ------ | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| GET    | /api/site/article           | **不再接受 `siteId`**（用户级）。保留可选 `siteId` 作**筛选**（不传 = 内容池全部；传 = 只出已发表到该站的）。列表项带 `sites: [{id,name,slug,isTop}]` |
| GET    | /api/site/article/:id       | 详情带 `sites`（含每站 `isTop`）；不再有 `siteId` 字段                                                                        |
| POST   | /api/site/article           | body 去掉 `siteId`，新增 `siteIds?: number[]`（提供即替换发表集合；不传 = 仅入内容池，不发表到任何站）                         |
| PUT    | /api/site/article/:id       | 新增 `siteIds?: number[]`（提供即替换；**空数组 = 全站下架**，文章本体保留）                                                   |
| GET    | /api/site/column/list       | **不再接受 `siteId`**（用户级）；列表项带 `sites: [{id,name,slug,sort}]`（展示站点）                                           |
| POST   | /api/site/column            | body 去掉 `siteId`，新增 `siteIds?: number[]`（不传 = 该用户全部站点可见）                                                    |
| GET    | /api/site/tag/list          | **不再接受 `siteId`**（用户级）。标签**跟随文章**出现在站点，无需单独挂载                                                     |
| POST   | /api/site/tag               | body 去掉 `siteId`（`name` 用户级唯一，重名复用既有标签）                                                                     |
| GET    | /api/site/manage/list       | 站点项 `articleCount` 改为「已发表到本站的文章数」                                                                            |

> 兼容说明：前端三页面已同步（列表不再传 `siteId`，筛选走新增下拉；参见 ARCHITECTURE §22.8）。后端对仍传 `siteId` 的历史请求按「未知参数」处理（ValidationPipe 口径）。

### 14.2 发表 / 显隐关联端点（新增）

| 方法 | 路径                            | 权限                 | body                                        | 响应                                              |
| ---- | ------------------------------- | -------------------- | ------------------------------------------- | ------------------------------------------------- |
| PUT  | /api/site/article/:id/sites     | `site:article:update`| `{ sites: [{ siteId: number, isTop?: boolean }] }` | `{ ok: true, sites: [{id,name,slug,isTop}] }` |
| PUT  | /api/site/column/:id/sites      | `site:column:update` | `{ sites: [{ siteId: number, sort?: number }] }`   | `{ ok: true, sites: [{id,name,slug,sort}] }` |

- **替换式**：每次调用以传入集合为最终结果；空数组 = 文章从全部站点下架 / 栏目在所有站点不展示（本体保留在内容池）。
- **置顶按站独立**：`isTop` 只影响该站内的排序，不影响其他站点。
- 站点 id 不存在或不属于当前用户 → **40119**（文章/栏目不存在或非属主 → **40400**）。
- 发表/下架后清理该站的开放层缓存（`site:data:{siteId}:*`）。

### 14.3 建站与删站（修改既有）

| 方法   | 路径                    | 变化                                                                                                                                            |
| ------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | /api/site/manage        | body 新增 `publishArticleIds?: 'all' | number[]`（缺省 = `'all'`：把内容池里已发布文章发表到新站；`[]` = 先建空站）。**新 `site_site.spa_fallback`** 由模板 `template.json#spaFallback` 读入 |
| DELETE | /api/site/manage/:id    | 级联修订：物理删该站评论 + 删该站展示关联；**文章/栏目/标签本体保留**。响应改为 `{ unpublishedArticles, deletedComments, recycledRoot }`（原 `deletedArticles` 已废弃） |

### 14.4 删除用户预检（修改既有）

- `system` 域删用户前若该用户仍有站点 → **40120**（message 提示先删除其站点）。内容池化的文章/栏目/标签随用户走，站点才是必须显式清理的资源。

### 14.5 开放层（`/api/open/{slug}/**`，D76/R76）

| 方法 | 路径                                   | 口径                                                                                          |
| ---- | -------------------------------------- | --------------------------------------------------------------------------------------------- |
| GET  | /api/open/{slug}/api/articles          | 只出 `site_article_publish` 中本站 + `status=1` 的文章；排序 **`is_top desc, published_at desc`** |
| GET  | /api/open/{slug}/api/columns           | 只出 `site_column_display` 中本站的栏目；`articleCount` 只计**已发表到本站**的文章             |
| GET  | /api/open/{slug}/api/tags              | 跟随文章：只出现在本站已有文章引用到的标签（无标签文章 → 空数组，属正常）                     |

### 14.6 静态资源回退链（`/api/open/{slug}/**`，D77/R78）

- **无扩展名路径**才回退：`真实文件 → 补 .html → 目录 index.html → 站点 spa_fallback`（全部未命中 → **40400**）。
- **带扩展名路径严格 404**：如 `/not-exist.png` → 40400（不回退，避免静态资源缺失被 index 吞掉）。
- `spa_fallback` 为 NULL（存量站点）→ 不启用回退，行为与 P7 前完全一致；回退命中**不写 `site:path` 负缓存**（新发表文章必须立即可见）。

### 14.7 AI 工具契约变化（R77，工具总数 28 不变）

| 工具                   | parameters 变化                                                     | 语义变化                                                                                              |
| ---------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| create_site_article    | 加 `siteIds?: number[]`                                             | status=0 可免选站（仅入内容池）；status=1 必须能确定发表站点（slug 或 siteIds），否则回喂站点清单 40101 |
| update_site_article    | 加 `siteIds?: number[]`                                             | siteIds 提供即整体替换（空数组 = 全站下架）；slug 由必选降为可选（传了才校验「已发表到该站」）        |
| publish_site_article   | slug 降为可选                                                       | 上架且零发表站时，确认卡与返回值带警示行（「上架后任何站点都看不到它」）                              |
| list_site_articles     | 站点降为筛选                                                        | 列表为用户内容池口径，返回项带 `sites`                                                                |
| read_site_article      | slug 降为可选                                                       | 校验由「属于该站」改为「已发表到该站」（未发表 → 40400 并提示）                                       |
| ensure_site_column / ensure_site_tags | 去站点参数                                               | 栏目/标签用户级                                                                                       |
| delete_site            | 无                                                                  | 确认卡改口径：「下架 N 篇 + 删评论 M 条」，返回 `{ unpublishedArticles, deletedComments, ... }`        |

### 14.8 编号登记

| 系列      | 本期使用    | 说明                                                                                   |
| --------- | ----------- | -------------------------------------------------------------------------------------- |
| 决策      | D73~~D78    | 见 `docs/P7/PRD-P7-STORY-DEMAND.md`                                                     |
| 需求      | R75~~R78    | 同上                                                                                   |
| 任务      | T83~~T87    | 见 PROGRESS「P7 任务拆解」                                                              |
| 错误码    | +1          | **40120**（删除用户仍有站点）；复用 40001/40101/40105/40119/40400                       |
| HTTP 端点 | +2          | `PUT /api/site/article/:id/sites`、`PUT /api/site/column/:id/sites`                      |
| AI 工具   | 28（不变）  | 7 个 CMS 工具签名调整；`pnpm check:ai` 16/16                                            |
