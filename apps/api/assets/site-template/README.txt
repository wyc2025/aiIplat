iplat 个人网站默认模板
========================

这是你的站点起点，全部文件（index.html / style.css / app.js / README.txt）都可以在云盘
「我的文件」中直接编辑、替换或删除。平台只负责托管文件与提供数据接口，页面如何展示完全由你决定。

一、三条注意事项（重要）
  1. 一律使用相对路径引用（如 ./style.css、./app.js、fetch('./api/articles')），
     不要写以 / 开头的绝对路径。
  2. 文件路径即 URL：站点内每个文件的访问地址就是它在站点目录里的路径，
     重命名/移动文件 = 改变 URL，站内引用要同步更新。
  3. 封面与正文配图请上传到 media/ 目录（站点设置页有媒体目录入口），
     上传后文件的公开 URL 形如 ./media/文件名。

二、开放数据 API 清单（v1，只读 + 评论提交）
  GET  ./api/site                        站点信息 { title, description }
  GET  ./api/columns                     栏目嵌套树 [{ id, name, sort, children }]
  GET  ./api/tags                        标签列表 [{ id, name }]
  GET  ./api/articles                    文章分页。参数：pageNo/pageSize(≤50)/columnId/tagId/keyword
  GET  ./api/articles/{id}               文章详情（含 contentMd 原文；同时触发查看数 +1）
  GET  ./api/articles/{id}/comments      评论分页（仅已过审，按时间正序）
  POST ./api/articles/{id}/comments      提交评论 { nickname(1~32), content(1~500) }

  统一响应：{ code, message, data }，code=0 成功；失败（如文章不存在）code=40400。

三、模板当前行为
  · 首页：站点标题/描述 + 栏目导航 + 文章卡片列表（分页）；
  · 文章详情：hash 路由 #/article/{id}，markdown-it 渲染（html:false 禁 raw HTML）+ 评论区；
  · 评论提交后提示"已提交，审核后展示"，审核通过才可见（可在站点设置关闭审核）。

四、改造建议
  · 改样式：直接编辑 style.css；
  · 改布局/加页面：编辑 index.html + app.js，新页面用相对路径互链；
  · markdown 渲染当前用 CDN markdown-it，可替换为你喜欢的库（注意 html:false 或自行转义）；
  · 用户输入内容（昵称/评论等）展示时务必用 textContent 或等价转义，防 XSS。
