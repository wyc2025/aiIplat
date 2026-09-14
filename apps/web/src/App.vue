<script setup lang="ts">
// 根组件：路由此处出口 + Element Plus 全局中文语言包
//
// 中文化（P4F T69/D60）：Element Plus 组件由 unplugin-vue-components 按需自动引入，
// 没有 `app.use(ElementPlus, { locale })` 这一步；函数式弹窗（ElMessageBox / ElMessage）
// 读的是全局配置，故在最外层用 ElConfigProvider 注入 zh-cn —— 修后所有确认框按钮为「确定/取消」。
import zhCn from 'element-plus/es/locale/lang/zh-cn'
</script>

<template>
  <el-config-provider :locale="zhCn">
    <router-view />
  </el-config-provider>
</template>
