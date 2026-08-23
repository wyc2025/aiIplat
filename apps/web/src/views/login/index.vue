<template>
  <div class="v-login">
    <el-card class="v-login-card">
      <div class="v-login-header">
        <el-icon
          class="v-login-logo"
          :size="36"
          color="#409EFF"
        >
          <Platform />
        </el-icon>
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
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { FormInstance, FormRules } from 'element-plus'
import { Lock, Platform, User } from '@element-plus/icons-vue'
import { login } from '@/api/system/auth'
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
</style>
