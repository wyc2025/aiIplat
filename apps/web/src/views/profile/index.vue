<template>
  <div class="v-profile">
    <!-- 左侧个人卡片（PRD F11：头像、昵称、角色、最后登录） -->
    <div class="v-profile-side">
      <el-avatar
        :size="84"
        :src="userStore.userInfo?.avatar || undefined"
      >
        {{ userStore.nickname.charAt(0) }}
      </el-avatar>
      <h3 class="v-profile-nickname">
        {{ userStore.nickname }}
      </h3>
      <div class="v-profile-username">
        {{ userStore.userInfo?.username }}
      </div>
      <div class="v-profile-roles">
        <el-tag
          v-for="code in userStore.roles"
          :key="code"
          size="small"
        >
          {{ code }}
        </el-tag>
      </div>
      <div class="v-profile-meta">
        <div>最后登录：{{ formatTime(userStore.userInfo?.lastLoginAt) }}</div>
        <div>登录 IP：{{ userStore.userInfo?.lastLoginIp ?? '-' }}</div>
      </div>
    </div>

    <!-- 右侧 Tabs：基本信息 / 修改密码 -->
    <div class="v-profile-main">
      <el-tabs>
        <el-tab-pane label="基本信息">
          <el-form
            ref="baseFormRef"
            :model="baseForm"
            :rules="baseRules"
            label-width="80px"
            class="v-profile-form"
          >
            <el-form-item
              label="昵称"
              prop="nickname"
            >
              <el-input
                v-model="baseForm.nickname"
                maxlength="50"
                placeholder="请输入昵称"
              />
            </el-form-item>
            <el-form-item
              label="邮箱"
              prop="email"
            >
              <el-input
                v-model="baseForm.email"
                placeholder="请输入邮箱"
              />
            </el-form-item>
            <el-form-item
              label="手机号"
              prop="phone"
            >
              <el-input
                v-model="baseForm.phone"
                maxlength="11"
                placeholder="请输入手机号"
              />
            </el-form-item>
            <el-form-item
              label="性别"
              prop="gender"
            >
              <el-select
                v-model="baseForm.gender"
                placeholder="请选择性别"
                style="width: 200px"
              >
                <el-option
                  v-for="d in sys_user_gender"
                  :key="d.value"
                  :label="d.label"
                  :value="Number(d.value)"
                />
              </el-select>
            </el-form-item>
            <el-form-item>
              <el-button
                type="primary"
                :loading="baseSaving"
                @click="handleSaveBase"
              >
                保 存
              </el-button>
            </el-form-item>
          </el-form>
        </el-tab-pane>

        <el-tab-pane label="修改密码">
          <el-form
            ref="pwdFormRef"
            :model="pwdForm"
            :rules="pwdRules"
            label-width="80px"
            class="v-profile-form"
          >
            <el-form-item
              label="旧密码"
              prop="oldPassword"
            >
              <el-input
                v-model="pwdForm.oldPassword"
                type="password"
                show-password
                placeholder="请输入旧密码"
              />
            </el-form-item>
            <el-form-item
              label="新密码"
              prop="newPassword"
            >
              <el-input
                v-model="pwdForm.newPassword"
                type="password"
                show-password
                placeholder="8~32 位，须含字母和数字"
              />
            </el-form-item>
            <el-form-item
              label="确认密码"
              prop="confirmPassword"
            >
              <el-input
                v-model="pwdForm.confirmPassword"
                type="password"
                show-password
                placeholder="请再次输入新密码"
              />
            </el-form-item>
            <el-form-item>
              <el-button
                type="primary"
                :loading="pwdSaving"
                @click="handleChangePassword"
              >
                保存并重新登录
              </el-button>
            </el-form-item>
          </el-form>
        </el-tab-pane>
      </el-tabs>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
// ElMessage 为 JS 调用（非模板组件），需显式引入样式
import 'element-plus/es/components/message/style/css'
import dayjs from 'dayjs'
import type { FormInstance, FormRules } from 'element-plus'
import type { Ref } from 'vue'
import { changePassword, updateProfile } from '@/api/system/profile'
import { useDict, type DictItem } from '@/hooks/useDict'
import { usePermissionStore } from '@/stores/permission'
import { useTabsStore } from '@/stores/tabs'
import { useUserStore } from '@/stores/user'
import { isEmail, isPassword, isPhone } from '@/utils/validate'

const router = useRouter()
const userStore = useUserStore()
const permissionStore = usePermissionStore()
const tabsStore = useTabsStore()
// useDict 返回动态键，TS 无法推导，按文档用法做类型收窄
const { sys_user_gender } = useDict('sys_user_gender') as unknown as {
  sys_user_gender: Ref<DictItem[]>
}

// ========== 基本信息 ==========
const baseFormRef = ref<FormInstance>()
const baseSaving = ref(false)
const baseForm = reactive({
  nickname: userStore.userInfo?.nickname ?? '',
  email: userStore.userInfo?.email ?? '',
  phone: userStore.userInfo?.phone ?? '',
  gender: userStore.userInfo?.gender ?? 0,
})

const baseRules: FormRules = {
  nickname: [
    { required: true, message: '昵称不能为空', trigger: 'blur' },
    { min: 1, max: 50, message: '昵称需 1~50 位', trigger: 'blur' },
  ],
  email: [
    {
      validator: (_rule, value: string, callback) =>
        !value || isEmail(value) ? callback() : callback(new Error('邮箱格式不正确')),
      trigger: 'blur',
    },
  ],
  phone: [
    {
      validator: (_rule, value: string, callback) =>
        !value || isPhone(value) ? callback() : callback(new Error('手机号格式不正确')),
      trigger: 'blur',
    },
  ],
}

async function handleSaveBase() {
  const valid = await baseFormRef.value?.validate().catch(() => false)
  if (!valid) return
  baseSaving.value = true
  try {
    await updateProfile({
      nickname: baseForm.nickname,
      email: baseForm.email || undefined,
      phone: baseForm.phone || undefined,
      gender: baseForm.gender,
    })
    // 同步 user store（昵称变化影响顶栏 / 侧栏展示）
    if (userStore.userInfo) {
      userStore.userInfo = {
        ...userStore.userInfo,
        nickname: baseForm.nickname,
        email: baseForm.email || null,
        phone: baseForm.phone || null,
        gender: baseForm.gender,
      }
    }
    ElMessage.success('保存成功')
  } catch {
    // 错误提示已由 request 拦截器统一弹出
  } finally {
    baseSaving.value = false
  }
}

// ========== 修改密码 ==========
const pwdFormRef = ref<FormInstance>()
const pwdSaving = ref(false)
const pwdForm = reactive({
  oldPassword: '',
  newPassword: '',
  confirmPassword: '',
})

const pwdRules: FormRules = {
  oldPassword: [{ required: true, message: '旧密码不能为空', trigger: 'blur' }],
  newPassword: [
    { required: true, message: '新密码不能为空', trigger: 'blur' },
    {
      validator: (_rule, value: string, callback) =>
        isPassword(value) ? callback() : callback(new Error('密码需 8~32 位，且同时包含字母和数字')),
      trigger: 'blur',
    },
  ],
  confirmPassword: [
    { required: true, message: '请再次输入新密码', trigger: 'blur' },
    {
      validator: (_rule, value: string, callback) =>
        value === pwdForm.newPassword ? callback() : callback(new Error('两次输入的密码不一致')),
      trigger: 'blur',
    },
  ],
}

async function handleChangePassword() {
  const valid = await pwdFormRef.value?.validate().catch(() => false)
  if (!valid) return
  pwdSaving.value = true
  try {
    await changePassword({ oldPassword: pwdForm.oldPassword, newPassword: pwdForm.newPassword })
    ElMessage.success('密码已修改，请重新登录')
    // 后端已使全部会话失效（旧 token 不可用）：本地清理并回登录页
    userStore.reset()
    permissionStore.reset()
    tabsStore.reset()
    router.push('/login')
  } catch {
    // 错误提示已由 request 拦截器统一弹出（如旧密码错误 10203）
  } finally {
    pwdSaving.value = false
  }
}

function formatTime(time?: string | null): string {
  return time ? dayjs(time).format('YYYY-MM-DD HH:mm:ss') : '-'
}
</script>

<style scoped>
.v-profile {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}
.v-profile-side {
  width: 280px;
  flex-shrink: 0;
  background: #fff;
  border-radius: 6px;
  padding: 24px 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.v-profile-nickname {
  margin: 8px 0 0;
  font-size: 18px;
  color: #303133;
}
.v-profile-username {
  font-size: 13px;
  color: #909399;
}
.v-profile-roles {
  display: flex;
  gap: 8px;
}
.v-profile-meta {
  margin-top: 12px;
  width: 100%;
  border-top: 1px solid #f0f0f0;
  padding-top: 12px;
  font-size: 13px;
  color: #606266;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.v-profile-main {
  flex: 1;
  min-width: 0;
  background: #fff;
  border-radius: 6px;
  padding: 16px 20px;
}
.v-profile-form {
  max-width: 480px;
  padding-top: 8px;
}
</style>
