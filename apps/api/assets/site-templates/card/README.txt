iplat 个人网站模板 —— 名片站（card）
========================================

这是你的站点起点。全部文件（index.html / style.css / app.js / README.txt）都可以在云盘
「我的文件」中直接编辑、替换或删除；平台只负责托管文件与提供数据接口，页面如何展示完全由你决定。
本文件同时是站点开发契约（人类与 AI 助手同读）：AI 帮你改站点前，第一件事就是读本文件。

一、站点地址与目录语义（重要）
  · 站点入口：/api/open/{slug}/（尾斜杠）= 站点根目录的 index.html。
  · 文件路径即 URL：每个文件的公开地址就是它在站点目录里的相对路径，
    重命名/移动文件 = 改变 URL，站内引用要同步更新。
  · 目录语义：请求目录形态的地址（如 /api/open/{slug}/pages/）→ 服务端找该目录下的
    index.html；请求不带尾斜杠 → 301 自动补斜杠（修正相对引用基址）；
    目录存在但没有 index.html → 404（无目录列表）。
  · media/ 目录专放图片等二进制资源（经后台云盘页上传），公开 URL 形如 ./media/文件名。
  · 公开文件直链（绝对路径例外）：云盘中“设为公开”的文件可经 /api/pub/f/{token}/raw 引用
    （token 见后台该文件的公开链接；html/svg 强制下载，适合引用图片/音视频/PDF 资源）；
    名片头像：把图片上传到 media/avatar.png 即可自动显示（本模板已引用该文件名）。

二、开放数据 API 契约（v1，字段级；一律以 ./api/ 相对路径调用）
  统一响应：{ code, message, data }；code=0 成功，业务数据在 data。
  资源类失败（站点/文章/栏目/路径不存在、站点停用）统一 code=40400；
  参数校验失败 40001；请求过快 42900；评论间隔限制 40111。
  ID 均为字符串（bigint 精度安全）；时间为 ISO 字符串。

  1. GET ./api/site —— 站点信息
     data: { title, description }

  2. GET ./api/columns —— 栏目嵌套树（服务端已组树，直接递归渲染）
     data: [{ id, name, sort, children: [同结构，可多层] }]

  3. GET ./api/tags —— 标签列表
     data: [{ id, name }]

  4. GET ./api/articles —— 文章分页列表（仅已发布，按 publishedAt 倒序）
     参数（均可选）：columnId / tagId / keyword（标题模糊）/ pageNo（默认 1）/ pageSize（≤50）
     data: { list, total, pageNo, pageSize }
     list 项: { id, title, summary, coverUrl, columnId, columnName,
                tags: [{ id, name }], wordCount, viewCount, publishedAt }
     coverUrl: 封面图完整公开地址（./media/... 形态）；无封面为 null

  5. GET ./api/articles/{id} —— 文章详情
     data: 上述列表项全部字段 + contentMd（markdown 原文，渲染由站点代码负责）
     注意：每次成功调用会触发文章查看数 +1（同 IP 短窗口内去重）

  6. GET ./api/articles/{id}/comments —— 评论分页（仅已过审，按时间正序）
     参数：pageNo / pageSize
     data: { list: [{ id, nickname, content, createdAt, replyContent, replyAt }], total, pageNo, pageSize }
     replyContent/replyAt：作者回复（一级回复，每条至多一条；未回复为 null，判空后渲染）

  7. POST ./api/articles/{id}/comments —— 提交评论
     body: { nickname: 1~32 字, content: 1~500 字 }
     成功 data.message 固定为"已提交，审核后展示"（站点关闭审核开关时直接可见）。

三、三条纪律（违反即翻车）
  1. 相对路径：fetch 与资源引用一律 ./api/site、./style.css、./media/xxx 这类相对路径，
     禁止以 / 开头的绝对路径——站点挂在 /api/open/{slug}/ 子路径下，绝对路径会指向错误位置。
  2. 沙箱环境：站点页面运行在 CSP sandbox 内（安全隔离，读不到平台登录凭证，
     localStorage/cookie 不可用）；alert/confirm 可正常使用做交互反馈；
     数据接口跨源已由服务端放行（CORS/CORP），无需额外处理。
  3. 用户内容防 XSS：昵称、评论等一切用户输入内容展示时必须用 textContent 注入
     （或等价转义），禁止 innerHTML 直插；markdown 渲染库必须关闭 raw HTML（html:false）。

四、模板当前行为（名片站）
  · 名片卡：站点标题/描述作为姓名与一句话介绍（后台「站点设置」里改，无需动代码）；
  · 头像：云盘 media/ 上传 avatar.png 自动显示；
  · 社交链接：直接编辑 index.html 中 #social 区块的 <a>；
  · 最近更新：已发布文章前 5 篇标题列表。

五、改造建议
  · 改配色/布局：直接编辑 style.css；
  · 需要图片：在后台云盘页上传到 media/ 目录（AI 助手无法代写二进制文件）。
