<template>
  <div class="error-page">
    <h1>404</h1>
    <p>页面不存在</p>
    <el-button
      type="primary"
      @click="$router.push('/')"
    >
      返回首页
    </el-button>
  </div>
</template>

<script setup lang="ts">
</script>

<style scoped>
.error-page {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  gap: 12px;
}
</style>
