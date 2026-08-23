import { createApp } from 'vue'
import { createPinia } from 'pinia'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import App from './App.vue'
import { setupPermissionDirective } from '@/directives/permission'
import router from '@/router'
import { setupRouterGuard } from '@/router/guard'
import '@/styles/tailwind.css'
import '@/styles/index.scss'

const app = createApp(App)

const pinia = createPinia()
app.use(pinia)

setupRouterGuard(router)
app.use(router)
setupPermissionDirective(app)

// 全局注册 Element Plus 图标：菜单 icon 字段（如 Odometer）以组件名动态渲染
for (const [name, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(name, component)
}

app.mount('#app')
