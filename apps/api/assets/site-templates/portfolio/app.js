/**
 * 作品集模板逻辑（原生 JS，无框架，可随意改写）。
 * 约定（与 README.txt 契约一致）：
 * ① 相对路径引用（./api/*、./style.css）——站点 URL 形态依赖相对基址；
 * ② 用户内容（标题/摘要/正文）一律 textContent 或 markdown-it(html:false) 注入，防 XSS；
 * ③ alert/confirm 可用（沙箱 allow-modals）。
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
    return String(iso).replace('T', ' ').slice(0, 10)
  }

  /** 首屏与关于区：站点信息 */
  function loadSite() {
    return api('/site').then(function (site) {
      setText($('site-title'), site.title)
      setText($('hero-title'), site.title)
      setText($('hero-description'), site.description || '这里展示我的作品与项目。')
      setText($('about-text'), site.description || '')
      setText($('footer-title'), site.title)
      document.title = site.title
    })
  }

  /** 作品网格：已发布文章即作品（取前 12 篇） */
  function loadWorks() {
    var grid = $('work-grid')
    return api('/articles?pageNo=1&pageSize=12').then(function (page) {
      grid.innerHTML = ''
      if (!page.list || page.list.length === 0) {
        grid.innerHTML = '<p class="empty-tip">还没有作品——去后台发布第一篇文章吧（封面会显示为作品图）</p>'
        return
      }
      page.list.forEach(function (article) { grid.appendChild(renderCard(article)) })
      setText($('work-more'), '共 ' + page.total + ' 个作品')
      $('work-more').hidden = false
      setText($('about-stats'), '已发布 ' + page.total + ' 个作品')
    }).catch(function () {
      grid.innerHTML = '<p class="empty-tip">作品加载失败</p>'
    })
  }

  function renderCard(article) {
    var card = document.createElement('div')
    card.className = 'work-card'
    card.addEventListener('click', function () { openWork(article.id) })
    if (article.coverUrl) {
      var img = document.createElement('img')
      img.className = 'cover'
      img.src = article.coverUrl
      img.alt = ''
      card.appendChild(img)
    }
    var body = document.createElement('div')
    body.className = 'work-body'
    var title = document.createElement('h3')
    setText(title, article.title)
    body.appendChild(title)
    var summary = document.createElement('p')
    summary.className = 'summary'
    setText(summary, article.summary || '（暂无简介）')
    body.appendChild(summary)
    var meta = document.createElement('p')
    meta.className = 'meta'
    setText(meta, formatDate(article.publishedAt) + (article.columnName ? ' · ' + article.columnName : ''))
    body.appendChild(meta)
    card.appendChild(body)
    return card
  }

  /** 作品详情弹层：正文 markdown 渲染（html:false 防 XSS） */
  function openWork(id) {
    $('work-modal').hidden = false
    $('work-content').innerHTML = '<p class="loading-tip">加载中…</p>'
    api('/articles/' + id).then(function (article) {
      setText($('work-title'), article.title)
      setText($('work-meta'), formatDate(article.publishedAt) + ' · ' + (article.wordCount || 0) + ' 字 · ' + (article.viewCount || 0) + ' 次查看')
      $('work-content').innerHTML = md.render(article.contentMd || '')
    }).catch(function () {
      setText($('work-title'), '加载失败')
      $('work-content').innerHTML = ''
    })
  }

  function closeModal() { $('work-modal').hidden = true }

  function boot() {
    loadSite()
    loadWorks()
    $('year').textContent = String(new Date().getFullYear())
    // 弹层关闭：点遮罩或 ×
    $('work-modal').addEventListener('click', function (e) {
      if (e.target && e.target.dataset && e.target.dataset.close) closeModal()
    })
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeModal()
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})()
