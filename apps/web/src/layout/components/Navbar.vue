<template>
  <div class="v-navbar">
    <div class="v-navbar-left">
      <el-icon
        class="v-fold-btn"
        @click="settingsStore.toggleSidebar()"
      >
        <Fold v-if="!settingsStore.sidebarCollapsed" />
        <Expand v-else />
      </el-icon>
      <el-breadcrumb
        v-if="settingsStore.showBreadcrumb"
        separator="/"
      >
        <el-breadcrumb-item
          v-for="item in breadcrumbs"
          :key="item.path"
        >
          {{ item.title }}
        </el-breadcrumb-item>
      </el-breadcrumb>
    </div>
    <div class="v-navbar-right">
      <el-icon
        class="v-setting-btn"
        title="布局设置"
        @click="emit('open-settings')"
      >
        <Setting />
      </el-icon>
      <el-dropdown @command="handleCommand">
        <span class="v-user">
          <el-avatar
            :size="28"
            :src="userStore.avatar || undefined"
          >
            {{ userStore.nickname.charAt(0) }}
          </el-avatar>
          <span class="v-user-name">{{ userStore.nickname }}</span>
          <el-icon><ArrowDown /></el-icon>
        </span>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="profile">
              个人中心
            </el-dropdown-item>
            <el-dropdown-item
              command="logout"
              divided
            >
              退出登录
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
// ElMessageBox 为 JS 调用（非模板组件），需显式引入样式（含遮罩层 overlay）
import 'element-plus/es/components/message-box/style/css'
import 'element-plus/es/components/overlay/style/css'
import { ArrowDown, Expand, Fold, Setting } from '@element-plus/icons-vue'
import { logout } from '@/api/system/auth'
import { usePermissionStore } from '@/stores/permission'
import { useSettingsStore } from '@/stores/settings'
import { useTabsStore } from '@/stores/tabs'
import { useUserStore } from '@/stores/user'

const emit = defineEmits<{ (e: 'open-settings'): void }>()

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const settingsStore = useSettingsStore()
const permissionStore = usePermissionStore()
const tabsStore = useTabsStore()

/** 面包屑：取当前路由匹配链的 title（跳过布局容器） */
const breadcrumbs = computed(() =>
  route.matched
    .filter((r) => r.meta?.title && r.name !== 'layout')
    .map((r) => ({ path: r.path, title: r.meta.title as string })),
)

async function handleCommand(command: string) {
  if (command === 'profile') {
    router.push('/profile')
    return
  }
  if (command === 'logout') {
    // confirm 点取消会 reject，需捕获避免未处理的 Promise 异常
    const confirmed = await ElMessageBox.confirm('确认退出登录吗？', '提示', {
      type: 'warning',
      confirmButtonText: '退出',
      cancelButtonText: '取消',
    })
      .then(() => true)
      .catch(() => false)
    if (!confirmed) return
    try {
      await logout()
    } catch {
      // 登出接口失败不阻塞本地清理
    }
    userStore.reset()
    permissionStore.reset()
    tabsStore.reset()
    router.push('/login')
  }
}
</script>

<style scoped>
.v-navbar {
  height: 50px;
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  box-shadow: 0 1px 4px rgb(0 21 41 / 8%);
}
.v-navbar-left {
  display: flex;
  align-items: center;
  gap: 12px;
}
.v-fold-btn,
.v-setting-btn {
  font-size: 18px;
  cursor: pointer;
  color: #5a5e66;
}
.v-navbar-right {
  display: flex;
  align-items: center;
  gap: 16px;
}
.v-user {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  color: #303133;
}
.v-user-name {
  font-size: 14px;
}
</style>
