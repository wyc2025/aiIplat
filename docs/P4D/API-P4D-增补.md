# iplat —— API-P4D 增补（移动 / 打包下载 / 分享升级）

> **[已并入]** 本增补已于 T58（2026-09-12）作为 **§9** 并入 `docs/API.md`（含 `path` 可选参数与 `?sid=` 等价通道等实现补充）。
> 本文件保留为历史细节参考，**与 API.md 冲突时以 API.md 与代码为准**。
> 通用约定不变：统一响应 `{code,message,data}`（code=0 成功）；bigint ID 字符串化；流式接口 @SkipTransform。

---

## 9. P4d 增补：云盘操作增强 + 分享升级

### 9.1 错误码新增（30xxx 段，续接 30016 之后）

| code  | 含义                                                    | 前端处理     |
| ----- | ------------------------------------------------------- | ------------ |
| 30017 | 该分享需要提取码（未验证或凭证过期）                    | 跳密码门禁页 |
| 30018 | 提取码错误（含连续 5 次锁 10 分钟，message 带剩余秒数） | 门禁页提示   |
| 30019 | 非法移动目标（移入自身子树 / 站点根 / 回收站）          | 提示         |

### 9.2 移动（登录态，`cloud:file:upload` + @OperationLog）

`POST /api/cloud/file/:id/move`

请求：

```json
{ "targetParentId": "1234567890", "confirmPublic": false }
```

响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": { "id": "...", "finalName": "文档(1).md", "targetPublic": true }
}
```

- `targetPublic: true` 且未带 `confirmPublic` → 不执行移动，仅返回标记（前端弹 R39 警告）；带 `confirmPublic: true` 重发才执行
- 批量移动 = 前端队列逐条调用（D42）；批量遇公开目标整批一次确认
- 失败码：30001（无权限/不存在）、30019（非法目标）、30006（目标目录 500 项上限）

### 9.3 打包下载（登录态，`cloud:file:list`，@SkipTransform 流式）

`POST /api/cloud/file/pack-download`

请求：`{ "ids": ["id1", "id2", ...] }`（1~100 项，文件/文件夹混合）

- 响应：`application/zip` 流式（零落盘）；`Content-Disposition: attachment; filename*=UTF-8''iplat-pack-yyyyMMdd-HHmm.zip`
- zip 内保持目录结构，条目名 UTF-8 flag
- 回收站项 / 超 CLOUD_MAX_FILE_SIZE 条目跳过，响应头 `X-Pack-Skipped: n` 计数
- 前端：多选工具栏「打包下载」触发，浏览器原生下载（无超时问题）

### 9.4 file.list 响应扩展（T52）

`GET /api/cloud/file/list` 行内新增 `inSite: boolean`（R46：是否位于站点子树，后端上溯判定）。

### 9.5 分享升级

#### 管理侧（登录态，既有接口扩展）

| 方法 | 路径                          | 扩展点                                                                           |
| ---- | ----------------------------- | -------------------------------------------------------------------------------- |
| POST | /api/cloud/share              | body 加 `password?: string`（4~8 位，空=无密码）；fileId 可指向**文件夹**（D48） |
| GET  | /api/cloud/share/list         | item 加 `itemType: file\|folder`、`hasPassword: boolean`（**不返回密码本体**）   |
| POST | /api/cloud/share/:id/password | 修改/移除提取码（body `{ password: string\|null }`）                             |

#### 访客侧（@Public，独立限流 30 次/分/IP 沿用）

| 方法 | 路径                               | 说明                                                                                                                     |
| ---- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| POST | /api/cloud/share/:token/verify     | body `{ password }` → 签发 sid（响应 `{ sid, expiresIn }`）；无密码分享直通返回 sid；错误 30018（限流锁定照 10102 口径） |
| GET  | /api/cloud/share/:token            | info 扩展：`needPassword`、`itemType`、`name/size/mime/ext/expireAt/visitCount`；needPassword 且 sid 无效 → **30017**    |
| GET  | /api/cloud/share/:token/raw        | 新增。文件流 inline + Range（MIME 口径 R44 同 R26：html/svg 强制 attachment）                                            |
| GET  | /api/cloud/share/:token/list?path= | 新增。文件夹分享单层列表（动态子树 R43，is_public=2 项过滤）；响应同 pub d/list 形态                                     |
| GET  | /api/cloud/share/:token/download   | 既有。文件 attachment                                                                                                    |
| GET  | /api/cloud/share/:token/pack       | 新增。文件夹整包 zip（流式，访客视角含三态过滤）                                                                         |

- sid 携带方式：请求头 `X-Share-Sid`；Redis `share:pass:{token}:{sid}`，TTL = min(2h, 分享剩余有效期)
- 失效口径沿用：过期/停止/源删除 → 30008；限流 → 42900

### 9.6 公开语义分流（D49/R45，无新接口）

- 前端按 file.list 的 `inSite` 切换按钮组；旧 `POST /cloud/file/set-public` 接口保留（站点机制依赖），仅站点子树内调用（语义 = 设为私有/取消私有）
