# iplat —— API-P4C 增补（公开端点 + 管理侧扩展 + 解压）

> 与 PRD-P4C-PUBLIC.md、ARCHITECTURE-P4C-增补.md 同读。T50 完成后并入 API.md 并删除本文件。
> **并入进度**：T46 增量（§8.1 错误码 / §8.2 管理侧 / §8.3 公开端点）已并入 **API.md §8**（以 API.md 为准，本文件保留全量契约含 T49 解压预定义）；T50 复核收敛后本文件退役。
> 通用约定不变：统一响应 `{code,message,data}`（code=0 成功）；bigint ID 字符串化；流式接口 @SkipTransform。

---

## 8. 云盘公开（cloud 域 · P4c）

### 8.1 管理侧接口（登录态，统一前缀 /api）

#### 设为公开（扩展现有接口）

`POST /api/cloud/file/{id}/public`　权限：`cloud:file:public`

- 扩展点：文件夹可传 `{ "allowListing": true }`（默认 true，仅文件夹有意义）；文件无 body
- 幂等：已公开的行重复调用 → 返回既有 token（不重新生成）
- 响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "publicToken": "v3xK9...",
    "viewUrl": "/view/f/v3xK9...",
    "allowListing": null
  }
}
```

> 文件夹时 `viewUrl` 为 `/view/d/{token}`，`allowListing` 回显实际值。

#### 取消公开

`DELETE /api/cloud/file/{id}/public`　权限：`cloud:file:public`

- 语义：is_public 归 0、public_token 置空（轮换 R27），旧链接立即 40400
- 响应：`{ "code": 0, "message": "ok", "data": null }`

#### file.list 响应扩展

既有 `GET /api/cloud/file/list` 行内新增字段：`publicToken`（string|null）、`allowListing`（0|1，仅文件夹有意义）。仅 isPublic=1 时 publicToken 有值。

### 8.2 在线解压

`POST /api/cloud/file/:id/unzip`　权限：`cloud:file:upload`　@OperationLog

- 无请求体；同步执行，前端 `timeout: 0`
- 响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "folderId": "1234567890",
    "folderName": "资料包",
    "fileCount": 42,
    "totalSize": 18345678
  }
}
```

- 错误码：30014（非 zip / 损坏）、30015（条目数或累计总大小超限）、30016（非法路径条目）、30003（配额不足）、30006（单目录 500 项 / 名称超 64 等既有码沿用）

### 8.3 公开访问端点（免登录，前缀 /api/pub）

统一纪律：@Public、独立限流桶（静态 120 / 数据 60 次/分/IP）、资源类错误统一 40400（token 无效 / 已取消 / 已删除 / 祖先阻断 / 路径不存在，不区分原因）、`Cache-Control: no-cache` + ETag（304 支持）。

#### 文件元信息

`GET /api/pub/f/{token}/info`

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "name": "演示.mp4",
    "size": 20971520,
    "mime": "video/mp4",
    "ext": "mp4",
    "updatedAt": "2026-09-09T12:00:00.000Z"
  }
}
```

#### 文件流（预览）

`GET /api/pub/f/{token}/raw`

- inline + MIME 白名单；text/html 与 image/svg+xml 强制 attachment；文本强制 `text/plain; charset=utf-8`
- 支持 Range（bytes=start-end / start- / -N），206 + Content-Range；非法 Range 回 200 全量；start 越界 416
- `Accept-Ranges: bytes`、`Content-Length`、helmet nosniff 全局兜底

#### 文件流（下载）

`GET /api/pub/f/{token}/download`

- `Content-Disposition: attachment; filename*=UTF-8''<原名>`（含 ASCII 兜底）

#### 文件夹列表（单层）

`GET /api/pub/d/{token}/list?path=`

- `path` 省略 = 根；逐段下行解析，任一段不存在/被阻断 → 40400
- `allow_listing=0` → **40117**
- 响应（非分页裸数组，照 §13.14 约定）：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "path": "subdir",
    "items": [
      { "name": "封面.png", "isDir": false, "size": 102400, "ext": "png", "updatedAt": "..." },
      { "name": "子目录", "isDir": true, "size": 0, "ext": "", "updatedAt": "..." }
    ]
  }
}
```

- 排序：文件夹在前，名称字典序（照 file.list 口径）

#### 文件夹内子项元信息 / 流

`GET /api/pub/d/{token}/info?path=`、`GET /api/pub/d/{token}/raw?path=`、`GET /api/pub/d/{token}/download?path=`

- path 指向**文件**；指向目录 → 40400（目录无 raw 语义）
- 其余口径与 f 三件套一致

### 8.4 错误码速查（本期新增）

| 码    | 含义                            | 触发位置                |
| ----- | ------------------------------- | ----------------------- |
| 30014 | 压缩包格式不支持或已损坏        | unzip                   |
| 30015 | 解压超限（条目数 / 累计总大小） | unzip                   |
| 30016 | 压缩包含非法路径条目            | unzip                   |
| 40117 | 该文件夹未开放列表浏览          | /api/pub/d/{token}/list |
