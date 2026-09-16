/**
 * 默认模板逻辑（原生 JS，无框架，可随意改写）。
 * 约定：
 * ① 相对路径引用（./api/*、./style.css）——站点 URL 形态依赖相对基址；
 * ② 用户内容（标题/摘要/评论/昵称）一律 textContent 注入，防 XSS；
 * ③ markdown 用 CDN markdown-it 渲染，html:false 禁 raw HTML。
 */
(function () {
  'use strict'

  var md = window.markdownit({ html: false, linkify: true, breaks: true })

  /** 开放数据 API 统一封装（相对路径，契约见 README.txt） */
  function api(path, options) {
    return fetch('./api' + path, options)
      .then(function (res) { return res.json() })
      .then(function (body) {
        if (body.code !== 0) throw new Error(body.message || '请求失败')
        return body.data
      })
  }

  function $(id) { return document.getElementById(id) }

  /** textContent 安全注入 */
  function setText(el, text) { el.textContent = text == null ? '' : String(text) }

  function formatDate(iso) {
    if (!iso) return ''
    return String(iso).replace('T', ' ').slice(0, 16)
  }

  // ================= 站点信息与栏目导航 =================
  function loadSiteInfo() {
    return api('/site').then(function (site) {
      setText($('site-title'), site.title)
      setText($('site-description'), site.description || '')
      document.title = site.title
    })
  }

  function loadColumns() {
    var nav = $('column-nav')
    return api('/columns').then(function (columns) {
      nav.innerHTML = ''
      var all = document.createElement('a')
      all.href = '#/'
      all.textContent = '全部'
      all.className = 'active'
      nav.appendChild(all)
      walkColumns(columns, nav)
    }).catch(function () { nav.innerHTML = '' })
  }

  /** 栏目树递归渲染（≤3 级） */
  function walkColumns(columns, nav) {
    ;(columns || []).forEach(function (col) {
      var a = document.createElement('a')
      a.href = '#/?columnId=' + col.id
      setText(a, col.name)
      a.dataset.columnId = col.id
      nav.appendChild(a)
      if (col.children && col.children.length > 0) walkColumns(col.children, nav)
    })
  }

  // ================= 文章列表（分页） =================
  var listState = { pageNo: 1, pageSize: 10, total: 0, columnId: null }

  function currentColumnId() {
    var m = location.hash.match(/columnId=(\d+)/)
    return m ? Number(m[1]) : null
  }

  function loadArticles() {
    listState.columnId = currentColumnId()
    var list = $('article-list')
    list.innerHTML = '<p class="loading-tip">加载中…</p>'
    var query = '?pageNo=' + listState.pageNo + '&pageSize=' + listState.pageSize
    if (listState.columnId) query += '&columnId=' + listState.columnId
    return api('/articles' + query).then(function (page) {
      listState.total = page.total
      list.innerHTML = ''
      if (!page.list || page.list.length === 0) {
        list.innerHTML = '<p class="empty-tip">还没有文章</p>'
      } else {
        page.list.forEach(function (article) { list.appendChild(renderCard(article)) })
      }
      renderPager()
    }).catch(function () {
      list.innerHTML = '<p class="empty-tip">文章加载失败</p>'
    })
  }

  function renderCard(article) {
    var card = document.createElement('div')
    card.className = 'article-card'
    if (article.coverUrl) {
      var img = document.createElement('img')
      img.className = 'cover'
      img.src = article.coverUrl
      img.alt = ''
      card.appendChild(img)
    }
    var body = document.createElement('div')
    var title = document.createElement('h3')
    var link = document.createElement('a')
    link.href = '#/article/' + article.id
    setText(link, article.title)
    title.appendChild(link)
    body.appendChild(title)
    var summary = document.createElement('p')
    summary.className = 'summary'
    setText(summary, article.summary || '')
    body.appendChild(summary)
    var meta = document.createElement('p')
    meta.className = 'meta'
    setText(meta, formatDate(article.publishedAt) + ' · ' + (article.wordCount || 0) + ' 字 · ' + (article.viewCount || 0) + ' 次查看')
    body.appendChild(meta)
    card.appendChild(body)
    return card
  }

  function renderPager() {
    var totalPages = Math.max(1, Math.ceil(listState.total / listState.pageSize))
    $('page-info').textContent = listState.pageNo + ' / ' + totalPages
    $('prev-btn').disabled = listState.pageNo <= 1
    $('next-btn').disabled = listState.pageNo >= totalPages
  }

  // ================= 文章详情 + 评论 =================
  var commentState = { articleId: null, pageNo: 1, pageSize: 10, total: 0 }

  function loadArticle(id) {
    showPage('article')
    $('article-content').innerHTML = '<p class="loading-tip">加载中…</p>'
    return api('/articles/' + id).then(function (article) {
      setText($('article-title'), article.title)
      var tags = (article.tags || []).map(function (t) { return t.name }).join('、')
      setText($('article-meta'), formatDate(article.publishedAt) + ' · ' + (article.wordCount || 0) + ' 字 · ' + (article.viewCount || 0) + ' 次查看' + (tags ? ' · ' + tags : ''))
      $('article-content').innerHTML = md.render(article.contentMd || '')
      commentState.articleId = id
      commentState.pageNo = 1
      return loadComments()
    }).catch(function () {
      setText($('article-title'), '文章不存在')
      $('article-content').innerHTML = ''
    })
  }

  function loadComments() {
    var ul = $('comment-list')
    ul.innerHTML = '<li class="loading-tip">加载中…</li>'
    var query = '?pageNo=' + commentState.pageNo + '&pageSize=' + commentState.pageSize
    return api('/articles/' + commentState.articleId + '/comments' + query).then(function (page) {
      commentState.total = page.total
      ul.innerHTML = ''
      if (!page.list || page.list.length === 0) {
        ul.innerHTML = '<li class="empty-tip">暂无评论</li>'
      } else {
        page.list.forEach(function (comment) {
          var li = document.createElement('li')
          var nick = document.createElement('span')
          nick.className = 'nickname'
          setText(nick, comment.nickname)
          li.appendChild(nick)
          var content = document.createElement('p')
          content.className = 'content'
          setText(content, comment.content) // textContent 转义，防 XSS
          li.appendChild(content)
          // P6：作者回复（replyContent 非空才渲染；一级回复，无点赞/再回复）
          if (comment.replyContent) {
            var reply = document.createElement('div')
            reply.className = 'reply'
            var replyLabel = document.createElement('span')
            replyLabel.className = 'reply-label'
            setText(replyLabel, '作者回复')
            reply.appendChild(replyLabel)
            var replyText = document.createElement('p')
            replyText.className = 'reply-content'
            setText(replyText, comment.replyContent) // textContent 转义，防 XSS
            reply.appendChild(replyText)
            li.appendChild(reply)
          }
          var time = document.createElement('p')
          time.className = 'time'
          setText(time, formatDate(comment.createdAt))
          li.appendChild(time)
          ul.appendChild(li)
        })
      }
      var totalPages = Math.max(1, Math.ceil(commentState.total / commentState.pageSize))
      $('c-page-info').textContent = commentState.pageNo + ' / ' + totalPages
      $('c-prev-btn').disabled = commentState.pageNo <= 1
      $('c-next-btn').disabled = commentState.pageNo >= totalPages
    }).catch(function () {
      ul.innerHTML = '<li class="empty-tip">评论加载失败</li>'
    })
  }

  function submitComment(event) {
    event.preventDefault()
    var nickname = $('comment-nickname').value.trim()
    var content = $('comment-content').value.trim()
    if (!nickname || !content) return
    api('/articles/' + commentState.articleId + '/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: nickname, content: content }),
    }).then(function () {
      $('comment-nickname').value = ''
      $('comment-content').value = ''
      alert('已提交，审核后展示')
    }).catch(function (error) {
      alert(error.message || '提交失败')
    })
  }

  // ================= 路由与初始化 =================
  function showPage(name) {
    $('page-home').hidden = name !== 'home'
    $('page-article').hidden = name !== 'article'
  }

  function route() {
    var articleMatch = location.hash.match(/#\/article\/(\d+)/)
    if (articleMatch) {
      loadArticle(articleMatch[1])
      return
    }
    showPage('home')
    var columnChanged = listState.columnId !== currentColumnId()
    if (columnChanged) {
      listState.pageNo = 1
      // 高亮导航
      var links = $('column-nav').querySelectorAll('a')
      links.forEach(function (a) {
        a.className = a.dataset.columnId && Number(a.dataset.columnId) === currentColumnId() ? 'active' : ''
      })
    }
    loadArticles()
  }

  function boot() {
    loadSiteInfo()
    loadColumns()
    window.addEventListener('hashchange', route)
    $('prev-btn').addEventListener('click', function () { listState.pageNo--; loadArticles() })
    $('next-btn').addEventListener('click', function () { listState.pageNo++; loadArticles() })
    $('c-prev-btn').addEventListener('click', function () { commentState.pageNo--; loadComments() })
    $('c-next-btn').addEventListener('click', function () { commentState.pageNo++; loadComments() })
    $('comment-form').addEventListener('submit', submitComment)
    route()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})()
