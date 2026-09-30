import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { ensurePermissionLoaded } from './guard'

/**
 * 静态路由：不需要权限即可访问（登录页、404）。
 * 业务页面全部由 userinfo 返回的菜单树动态注册（见 dynamic.ts）。
 */
export const staticRoutes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/login/index.vue'),
    meta: { title: '登录', hidden: true },
  },
  {
    // 布局容器：dashboard 作为静态落地页（所有登录用户可见，不依赖权限注册），
    // 保证 redirect 到 /dashboard 必然命中，不会落到 catch-all 404；
    // 其余业务页（system/* 等）由 beforeEnter 拉取 userinfo 后动态注册。
    path: '/',
    name: 'layout',
    component: () => import('@/layout/index.vue'),
    redirect: '/dashboard',
    beforeEnter: ensurePermissionLoaded,
    children: [
      {
        path: 'dashboard',
        name: 'dashboard',
        component: () => import('@/views/dashboard/index.vue'),
        meta: { title: '首页工作台', icon: 'Odometer' },
      },
      {
        // 个人中心是登录用户的基本功能（PRD F11，顶栏下拉固定入口），
        // 与 dashboard 同理静态注册，不依赖后端菜单分配，否则未分配该菜单的角色无法访问
        path: 'profile',
        name: 'profile',
        component: () => import('@/views/profile/index.vue'),
        meta: { title: '个人中心', hidden: true },
      },
      {
        // P11 应用平台：结构编辑器 / 功能页编辑器（非菜单页，从应用中心卡片进入）
        path: 'app-center/schema',
        name: 'app-center-schema',
        component: () => import('@/views/app/schema/index.vue'),
        meta: { title: '结构编辑', hidden: true },
      },
      {
        path: 'app-center/pages',
        name: 'app-center-pages',
        component: () => import('@/views/app/page-editor/index.vue'),
        meta: { title: '功能页编辑', hidden: true },
      },
      {
        // P11 功能页通配路由（API-P11 §2）：单组件按参数拉 schema 渲染，无需按页注册路由
        path: 'app-center/app/:appCode/p/:pageCode',
        name: 'app-center-function-page',
        component: () => import('@/views/app/function-page/index.vue'),
        meta: { title: '功能页', hidden: true },
      },
    ],
  },
  {
    path: '/404',
    name: 'not-found',
    component: () => import('@/views/error/404.vue'),
    meta: { title: '404', hidden: true },
  },
  {
    // 云盘分享访客页：独立根路由（免登录、无布局侧边栏），凭 token 访问；
    // P4d 起：文件分享渲染 FileView、文件夹分享渲染 FolderView（含下钻与整包下载）
    path: '/share/:token',
    name: 'share-visitor',
    component: () => import('@/views/cloud/share-visitor/index.vue'),
    meta: { title: '文件分享', hidden: true },
  },
  {
    // 文件夹分享内子文件预览（P4d D48；路径前缀同 /share/*，守卫按前缀放行）
    path: '/share/:token/file',
    name: 'share-visitor-file',
    component: () => import('@/views/cloud/share-visitor/index.vue'),
    meta: { title: '文件查看', hidden: true },
  },
  {
    // 云盘公开落地页（P4c D33）：独立根路由（免登录、无布局、极简无品牌），凭 token 访问
    path: '/view/f/:token',
    name: 'public-file-view',
    component: () => import('@/views/cloud/public-view/FileView.vue'),
    meta: { title: '文件查看', hidden: true },
  },
  {
    path: '/view/d/:token',
    name: 'public-folder-view',
    component: () => import('@/views/cloud/public-view/FolderView.vue'),
    meta: { title: '文件夹浏览', hidden: true },
  },
  {
    // 文件夹内子文件落地页：数据源走 d 类端点 info?path= / raw?path= / download?path=
    path: '/view/d/:token/file',
    name: 'public-subfile-view',
    component: () => import('@/views/cloud/public-view/FileView.vue'),
    meta: { title: '文件查看', hidden: true },
  },
  // P14 D115/T127：`/pub/app/:pubCode` 与 `/pub/app/:pubCode/p/:pageCode`（匿名公开展示页）
  // 已随匿名公开面退役移除；展示改由「展示应用 + 站点静态页」承担（开放层 `/api/open/:slug/disp/:id/`）。
  {
    // 兜底：匹配所有未注册路径。直接渲染 404 组件而非 redirect——
    // redirect 会在全局守卫之前把导航劫持到 /404，导致整页刷新直达深层路径
    // （动态路由尚未注册）时守卫拿不到原始 path 而永远 404；
    // 改为渲染组件后，守卫可先注册动态路由再 replace 重走，命中已注册路由。
    // 注意：不给此路由命名，避免守卫用 {...to} 重放时 name 优先劫持导航。
    path: '/:pathMatch(.*)*',
    component: () => import('@/views/error/404.vue'),
    meta: { title: '404', hidden: true },
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes: staticRoutes,
})

export default router
