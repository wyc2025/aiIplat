iplat 个人网站默认模板
========================

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

四、模板当前行为
  · 首页：站点标题/描述 + 栏目导航 + 文章卡片列表（分页，/?columnId={id} 切栏目）；
  · 文章详情：history 路由 /article/{id}（服务端对无扩展名路径回退到 index.html，
    回退入口由 template.json#spaFallback 声明，建站时写入站点配置）；
    markdown-it 渲染（html:false）+ 评论区；
  · 站点前缀：app.js 从 location.pathname 反推 /api/open/{slug}/ 作为 BASE，
    index.html 内同一逻辑写入 <base>，保证回退场景下相对资源与接口路径正确。

五、改造建议
  · 改样式：直接编辑 style.css；
  · 改布局/加页面：编辑 index.html + app.js，新页面用相对路径互链（目录语义见第一节）；
  · markdown 渲染当前用 CDN markdown-it，可替换为任意库（注意 html:false 或自行转义）；
  · 需要图片：在后台云盘页上传到 media/ 目录（AI 助手无法代写二进制文件）。

六、数据应用取数（展示应用页面读数据，可选）
  如果后台「应用中心」的数据应用要给你的展示应用页面提供数据，需要先「授权」——数据应用授权
  给某个展示应用、且该展示应用挂靠本站点后，**该展示应用的页面**可经同源相对路径读取该应用
  已暴露的数据（只读、无需登录）。

  路径形态（D123 收窄：取数按「展示应用」判定，不再按站点判定）：
    · 你的页面文件位于本站点目录的 disp/{展示应用id}/ 下，取数写**相对路径**即可：
        ./api/app/{appCode}/...
      （浏览器实际请求 /api/open/{站点slug}/disp/{展示应用id}/api/app/{appCode}/...）
    · 若要在**站点根目录页面**里取数，必须写绝对路径
      /api/open/{站点slug}/disp/{展示应用id}/api/app/{appCode}/...
      ——根页面用相对路径会落到 /api/open/{slug}/api/app/...（旧路径形态，已退役 → 404）。

  前置条件（缺一即 40400，与「不存在」不可区分）：
    ① 展示应用已挂靠本站点：应用中心 → 展示应用 → 挂靠本站；
    ② 数据应用已授权给**该展示应用**：应用中心 → 展示应用 → 授权（或对话中让 AI 授权）；
    ③ 数据应用已开启「可被授权读取」：应用中心 → 我的应用 → 发布；
    ④ 表与字段已暴露：应用中心 → 结构 → 表/字段的「公开」开关。

  接口清单（响应体仍是 { code, message, data }；下例以展示应用页内的相对路径书写）：
    1. GET ./api/app/{appCode}/schema                              暴露的表结构
       data: { app: { name, description }, tables: [{ name, label, fields: [{ name, label, type }] }] }
    2. GET ./api/app/{appCode}/tables/{table}/records              只读列表
       参数（均可选）：page（默认 1）/ size（≤50，默认 20）
         sort=字段:asc|desc          最多 2 组（重复传参）
         filter=字段:eq|contains:值   最多 3 组（重复传参；contains 仅文本/枚举）
         expand=引用字段[:字段1,字段2] 最多 1 组，展开 1 层
       data: { list, total, pageNo, pageSize }
       list 项：仅「已暴露字段」+ rowId / createdAt / updatedAt；展开结果在 expanded 字段里
    3. GET ./api/app/{appCode}/tables/{table}/records/{rowId}      只读单行（行不存在 → 40400）
    4. GET ./api/app/{appCode}/files/{fileId}/stream               附件图片/文件流（?download=1 触发下载）

  fetch 示例（展示应用页内直接用；appCode 见应用中心或对话中的 list_data_apps）：
    const res = await fetch(`./api/app/${APP_CODE}/tables/books?size=10&sort=score:desc`)
    const { code, data } = await res.json()
    if (code === 0 && data.list) { /* data.list / data.total / data.pageNo / data.pageSize */ }
    图片字段取值后拼 <img src="./api/app/{appCode}/files/{fileId}/stream">

  错误口径：40400（未挂靠/未授权/未发布/未暴露/不存在，统一防探测）；40001（参数越界）；
           42900（限流 60 次/分/IP）。
  边界：只读——写入永不进取数面，数据录入请走后台「应用中心」的功能页。
