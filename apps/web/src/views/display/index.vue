<script setup lang="ts">
/**
 * 展示应用（历史入口壳）——已并入「我的应用 ▸ 展示应用」Tab。
 *
 * 保留本文件的两个原因：
 * 1. 前端动态路由按 seed 菜单的 `component` 字符串解析组件（`app/center/index` / `display/index`）。
 *    旧环境的 `sys_menu` 里「展示应用」（`/app-center/display`）记录在**重跑 seed 清理前仍然存在**，
 *    若此文件缺失，该菜单会解析不到组件；
 * 2. 老书签 / 老链接直接访问 `/app-center/display` 时不白屏。
 *
 * 菜单下线由 seed 的幂等清理完成（`apps/api/prisma/seed.ts`）；本壳与 Tab 共用同一组件，无双份维护。
 */
import DisplayCards from '../app/center/components/DisplayCards.vue'
</script>

<template>
  <div class="v-display-legacy">
    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="「展示应用」已并入「我的应用 ▸ 展示应用」，请从该入口管理；本页仅为兼容旧链接保留。"
      class="v-display-legacy__tip"
    />
    <DisplayCards />
  </div>
</template>

<style scoped>
.v-display-legacy__tip {
  margin-bottom: 12px;
}
</style>
