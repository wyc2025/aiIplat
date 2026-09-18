<template>
  <div class="v-login">
    <el-card class="v-login-card">
      <div class="v-login-header">
        <div class="v-login-logo">
          <AppLogo :size="44" />
        </div>
        <h1 class="v-login-title">
          iplat
        </h1>
        <p class="v-login-subtitle">
          个人平台 · 后台管理
        </p>
      </div>
      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        size="large"
        @keyup.enter="handleLogin"
      >
        <el-form-item prop="username">
          <el-input
            v-model="form.username"
            placeholder="账号"
            :prefix-icon="User"
          />
        </el-form-item>
        <el-form-item prop="password">
          <el-input
            v-model="form.password"
            type="password"
            placeholder="密码"
            :prefix-icon="Lock"
            show-password
          />
        </el-form-item>
        <el-button
          type="primary"
          class="v-login-btn"
          :loading="loading"
          @click="handleLogin"
        >
          {{ loading ? '登录中…' : '登 录' }}
        </el-button>
      </el-form>
      <div class="v-login-demo">
        <el-divider>演示账号</el-divider>
        <div
          class="v-login-demo-item"
          @click="fillDemo('admin', 'Admin@123')"
        >
          <div class="v-login-demo-text">
            <span class="v-login-demo-role">超级管理员</span>
            <span class="v-login-demo-cred">admin / Admin@123</span>
          </div>
          <el-button
            link
            type="primary"
            @click.stop="fillDemo('admin', 'Admin@123')"
          >
            一键填充
          </el-button>
        </div>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { FormInstance, FormRules } from 'element-plus'
import { Lock, User } from '@element-plus/icons-vue'
import { login } from '@/api/system/auth'
import AppLogo from '@/components/AppLogo/index.vue'
import { setTokens } from '@/utils/token'

const router = useRouter()
const route = useRoute()

const formRef = ref<FormInstance>()
const loading = ref(false)
const form = reactive({ username: '', password: '' })

const rules: FormRules = {
  username: [{ required: true, message: '请输入账号', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
}

function fillDemo(username: string, password: string) {
  form.username = username
  form.password = password
}

async function handleLogin() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  loading.value = true
  try {
    // 失败/锁定提示由 request 拦截器统一 ElMessage 弹出（message 含剩余锁定秒数）
    const { accessToken, refreshToken } = await login(form)
    setTokens(accessToken, refreshToken)
    const redirect = (route.query.redirect as string) || '/'
    router.push(redirect)
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.v-login {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}
.v-login-card {
  width: 380px;
  border-radius: 8px;
}
.v-login-header {
  text-align: center;
  margin-bottom: 28px;
}
.v-login-logo {
  display: flex;
  justify-content: center;
}
.v-login-title {
  margin: 8px 0 4px;
  font-size: 26px;
  color: #303133;
}
.v-login-subtitle {
  margin: 0;
  font-size: 13px;
  color: #909399;
}
.v-login-btn {
  width: 100%;
  margin-top: 4px;
}
.v-login-demo {
  margin-top: 20px;
}
.v-login-demo :deep(.el-divider__text) {
  font-size: 12px;
  color: #a8abb2;
}
.v-login-demo-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border: 1px dashed #b3d8ff;
  border-radius: 6px;
  background: #ecf5ff;
  cursor: pointer;
  transition: border-color 0.2s;
}
.v-login-demo-item:hover {
  border-color: #409eff;
}
.v-login-demo-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.v-login-demo-role {
  font-size: 12px;
  color: #909399;
}
.v-login-demo-cred {
  font-size: 13px;
  font-family: Consolas, Monaco, monospace;
  color: #303133;
}
</style>
