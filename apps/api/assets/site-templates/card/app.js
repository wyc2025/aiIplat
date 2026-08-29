/**
 * 名片站模板逻辑（原生 JS，无框架，可随意改写）。
 * 约定（与 README.txt 契约一致）：
 * ① 相对路径引用（./api/*、./style.css）——站点 URL 形态依赖相对基址；
 * ② 用户内容（标题/简介/文章标题）一律 textContent 注入，防 XSS。
 */
(function () {
  'use strict'

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

  /** 名片信息：站点标题/描述 */
  function loadSite() {
    return api('/site').then(function (site) {
      setText($('site-title'), site.title)
      setText($('site-description'), site.description || '')
      setText($('footer-title'), site.title)
      document.title = site.title
    })
  }

  /** 最近文章（取前 5 篇；发布后自动出现） */
  function loadPosts() {
    var ul = $('post-list')
    return api('/articles?pageNo=1&pageSize=5').then(function (page) {
      ul.innerHTML = ''
      if (!page.list || page.list.length === 0) {
        ul.innerHTML = '<li class="empty-tip">还没有文章——去后台发布第一篇吧</li>'
        return
      }
      page.list.forEach(function (article) {
        var li = document.createElement('li')
        var a = document.createElement('a')
        // 精简列表只做标题展示；如需文章详情页可自行扩展（契约见 README.txt 第 5 条）
        a.href = 'javascript:void(0)'
        setText(a, article.title)
        li.appendChild(a)
        var date = document.createElement('span')
        date.className = 'date'
        setText(date, formatDate(article.publishedAt))
        li.appendChild(date)
        ul.appendChild(li)
      })
    }).catch(function () {
      ul.innerHTML = '<li class="empty-tip">文章加载失败</li>'
    })
  }

  function boot() {
    loadSite()
    loadPosts()
    $('year').textContent = String(new Date().getFullYear())
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})()
