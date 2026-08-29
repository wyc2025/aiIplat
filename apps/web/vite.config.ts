import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

export default defineConfig({
  plugins: [vue(), tailwindcss(), Components({ resolvers: [ElementPlusResolver()] })],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // cors: true 反射请求 Origin。站点页面（/api/open/*，CSP sandbox 的 opaque origin）发出的
    // 请求 Origin 为 null，Vite 默认 cors（仅放行 localhost 系源）会把 preflight OPTIONS 拦成
    // 不带 ACAO 头的 204，导致从本 dev server 打开的访客站点提交评论报 CORS 错误（2026-08-29 修复）。
    // 仅 dev server 生效，不影响生产（生产经反向代理同域，无此问题）。
    cors: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
