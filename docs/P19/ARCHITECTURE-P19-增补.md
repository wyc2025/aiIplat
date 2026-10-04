# ARCHITECTURE 增补 — P19 站点发布与版本管理

> 版本：2026-10-02 **v2**（采纳外部代码级分析复核修订）· 状态：已拍板生效
> 续主文档编号：**D143~~D151 / R156~~R161 / T159~T164**，错误码 **+40121**。
> 上游依据：评估-文件公开与站点托管.md（含 §8 复核增补）；PRD-P19-站点发布与版本管理.md；前置补丁 W12。
> v2 变更：新增 D150/D151、R161、T164；D144/D145/D148 吸收复核结论（权限解耦、manifest 结构、请求热路径不动）。

---

## 1. 决策

**D143 发布模型**：云盘站点目录 = 工作区（预览轨）；「发布」= 生成不可变快照到平台自营存储区 + 翻转 `site.active_release_id` 指针。快照一经生效永不修改（R156），内容修正只能发布新版本。立项形态=完整版（管理页 + 切换 + 预览保留）；服务出口 Phase1 仍经 Nest（D148）。

**D144 开放层双轨解析**：`GET /api/open/:slug/{*path}` 解析顺序——

1. 站点存在且 `active_release_id` 非空 → **快照轨**：根目录 = 该版本快照目录，**不消费 `is_public`**（快照即显式发布，权限平面与云盘解耦，R161）；
2. 站点存在但从未发布（`active_release_id` 为空）→ **legacy 轨**：维持直挂工作副本（向后兼容；公开判定遵循 **W12 修复后**的阻断优先语义；管理页对这类站点提示「草稿直出，建议发布」）；
3. 站点不存在 → 40400（维持防探测语义）。

- `:slug/disp/{id}/**` 展示应用托管链**不进快照**，维持现状实时语义（独立授权链，避免双版本语义纠缠，D150）。

**D145 快照原子性与 manifest**：

- 存储布局：`site-releases/{siteId}/{releaseId}/`（StorageService 下平台自营区，**不经云盘文件树暴露**）。
- 发布四步有序：① 全量子树复制到 `site-releases/{siteId}/.tmp-{releaseId}/`；② 生成 `manifest.json` 随目录落盘——结构 `{ 相对路径 → { fileId, contentHash(sha256), size, mime } }`；③ rename `.tmp-` → 正式目录；**④ 最后一步** UPDATE 指针。任一步失败 → 清理 .tmp，不留半成品（R157）。
- rename 需同文件系统；StorageService 抽象内保证 releases 区与工作区同卷。
- manifest 角色：发布侧清点/审计 + 未来物理去重与长缓存的输入；**不进请求热路径**（D148）。

**D146 数据模型**：

- 新表 `site_release`：`id` / `site_id` / `version_no`（站内递增序号，发布时 max+1）/ `label`（可空备注）/ `file_count` / `total_bytes` / `pinned`（bool，默认 false）/ `created_by` / `created_at`。manifest 不落库（清单可大），只落盘。
- `site` 表 +列 `active_release_id`（可空，默认 null）。迁移=加列+新表，无回填，安全。
- 级联：站点删除 → 其 releases 全部行 + 目录树清理；版本删除 → 行 + 目录清理。

**D147 保留策略**：每次发布完成后检查——未锁定版本数超 `SITE_RELEASE_KEEP`（默认 20）时，自动清理最旧未锁定版；**当前版本与锁定版豁免**（R158）。版本存储计入站点/用户配额。

**D148 Phase1 服务路径**：快照轨仍由既有开放层控制器出流，**只换根目录，解析方式不变**——继续走文件系统解析与既有回退链（真实文件 → .html → 目录 301 → spaFallback → 40400），不重写成 manifest 解析（理由：快照目录不可变（R156）已保证一致性，重写回退链是纯风险无收益）。安全件全量复用：MIME 白名单 + CSP 沙箱 + nosniff + CORS/CORP + 限流 + ETag/304 + 统一 40400。no-cache 维持不动（D28 不受 P19 影响；缓存解放挂 Phase2）。`site:path` Redis 缓存 key 加轨维度（releaseId / legacy），发布/切换/版本删除时精确失效（R159）。

**D149 预览轨**：管理态 `GET /api/site/manage/:id/preview/{*path}`（登录 + 站点权限，鉴权与站点 CRUD 同款）读工作副本出流，安全件与开放层同款。开放层**不设**预览入口（避免双公开面）。编辑器/AI 迭代体验不变：写工作副本 → 预览即见。

**D150 快照范围与去重（v2 新增）**：快照 = 站点根子树**全量**，含 `media/` 上传媒体（否则发布后图片丢失）；`disp/` 展示应用托管链**不随**快照（独立演进）。manifest 记 contentHash(sha256) 为未来去重/长缓存铺路；**物理去重（同哈希只存一份）挂 Phase2**——refcount GC 复杂度不值当前规模，全量复制在个人站点体量下可忽略。

**D151 AI 工具文案同步（v2 新增，v1 漏项认领）**：发布语义上线后 `write_site_files` 不再「写即上线」。必须同步：① 工具描述与结果文案改为草稿语义（「已保存到工作区，发布后访客可见」），**禁止**出现「已更新网站/已上线」类表述（否则 AI 向用户谎报上线状态）；② 改动必跑 `pnpm check:ai` + `pnpm smoke:ai`（T95 制度）；③ 文案改动先算手册余量（合注 ≤2000 字，余量 ~7 字，只腾挪不超帽）。

## 2. 规则

- **R156 快照不可变**：`site-releases/` 下已生效目录对一切写路径封闭；唯一写入方 = 发布管道（.tmp+rename），唯一删除方 = 版本删除/站点删除/保留策略清理。
- **R157 原子性与互斥**：拷备→manifest→rename→UPDATE 指针，四步有序；任一步失败清理 .tmp。同站并发发布以 Redis 锁互斥（key `site:publish:{siteId}`，带 TTL 防死锁），抢锁失败 → 40121「发布进行中」。
- **R158 版本豁免**：当前版本与锁定版本不可被自动或手动删除；activate 目标版本必须存在且属于该站点，否则 40400。
- **R159 缓存失效**：发布 / activate / 版本删除 → 失效该站点 `site:path` 全部轨键；工作副本写盘 → 仅失效 legacy/预览轨（既有 writeFiles 失效逻辑保留并收窄）。
- **R160 同源安全维持**：快照轨沿用 CSP 沙箱 + MIME 白名单 + nosniff 全套（同源用户 HTML 的债不因发布消失；独立沙箱域挂账未来）。`site-releases` 区不接受任何 URL 直达，仅经控制器解析，.tmp 目录对解析不可见。
- **R161 快照轨权限语义（v2 新增）**：快照轨只认 release 指针与快照目录，**不消费 `is_public` 三态**——`is_public` 回归纯云盘分享语义（W12 后两信任域彻底分治）。legacy 轨公开判定遵循 W12 阻断优先。

## 3. 开放层解析伪码

```
site = findBySlug(slug)                       // miss → 40400
if path 命中 :slug/disp/{id}/** → 展示应用托管链（现状，不进快照）
root = site.activeReleaseId
       ? releasesRoot/site.id/release.id      // 快照轨：不查 is_public（R161）
                                                //（release 行缺失=数据异常 → 40400 + 告警日志）
       : workingCopyRoot(site)                // legacy 轨：W12 阻断优先判定
serve(root, path)                             // 既有：路径穿越防御→回退链→MIME白名单→CSP→ETag→流式
```

## 4. 任务拆分

| 编号 | 任务                             | 要点                                                                                                                                                 |
| ---- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| T159 | Prisma 迁移 + 模型               | site_release 表 + site.active_release_id；级联删除                                                                                                   |
| T160 | 发布服务                         | 全量子树复制（含 media/，排除 disp 链）+ manifest（含 contentHash）+ rename + 指针翻转 + Redis 互斥锁 + 保留策略清理；site 域内实现，跨域只经 Facade |
| T161 | 版本管理端点 + 管理页            | list / activate / pin / delete + 「发布与版本」面板（发布按钮、radio 勾选当前版本、锁定、删除、legacy 提示条）；**前端验收含 vite build**            |
| T162 | 开放层双轨 + 预览端点 + 缓存失效 | D144/D148/D149/R159/R160/R161；legacy 轨继承 W12 语义；disp 链不触碰                                                                                 |
| T163 | 冒烟与收尾                       | `smoke:site` 覆盖 PRD 验收 1~11；回归 smoke:ext / smoke:mcp；**顺带关闭 P18-C1（TTL 自然过期用例条目化）与 P18-S1（删 PROGRESS 文末过期 zod 行）**   |
| T164 | AI 工具文案同步（v2 新增）       | write_site_files 描述+结果文案改草稿语义；`pnpm check:ai` + `pnpm smoke:ai`；手册合注 ≤2000 字核对                                                   |

## 5. 错误码

| 码    | 场景                                         | 说明                                   |
| ----- | -------------------------------------------- | -------------------------------------- |
| 40121 | 并发发布抢锁失败                             | 「发布进行中，请稍后」；本阶段唯一新增 |
| 40400 | 版本不存在/不属于该站点、路径穿越、.tmp 探测 | 复用，维持防探测语义                   |
| 40001 | 管理态参数校验（如 label 超长）              | 复用                                   |
| 403   | 无站点权限调管理端点                         | 复用管理态惯例                         |

## 6. 挂账（进主挂账清单）

- P19-Phase2：快照 nginx/对象存储直出 + 长缓存（immutable）策略 + **快照物理去重**（contentHash 已入 manifest，Phase2 只做存储层）——与 StorageService MinIO/OSS 切换同行。
- 独立沙箱域服务用户站点（github.io 式，彻底解决同源债）。
- 版本 diff / 对比视图；公网草稿预览环境（deploy preview 式）。
- 文件公开小加固（评估报告 G2/G3/G5 + §8 N4：password_enc 可逆留存评估删除、public_token 访问计数、token 生成器熵文档化、/api/pub 元数据 Redis 缓存、非白名单 no-store 收紧理由复查）——随迭代捎走。
- 运维卫生项（用户随时可做，不占研发期）：nginx 开 gzip/br 压缩。

---

_本增补只定义架构与规则；端点契约见 API-P19-增补.md；验收见 PRD-P19；前置安全修复见 补丁-W12-公开判定链统一.md。_
