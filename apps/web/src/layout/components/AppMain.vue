<template>
  <main class="v-app-main">
    <router-view v-slot="{ Component }">
      <transition
        name="fade-transform"
        mode="out-in"
      >
        <component :is="Component" />
      </transition>
    </router-view>
  </main>
</template>

<script setup lang="ts">
</script>

<style scoped>
.v-app-main {
  flex: 1;
  padding: 16px;
  background: #f0f2f5;
  overflow-y: auto;
  min-width: 0;
}
.fade-transform-enter-active,
.fade-transform-leave-active {
  transition: all 0.3s;
}
.fade-transform-enter-from {
  opacity: 0;
  transform: translateX(-10px);
}
.fade-transform-leave-to {
  opacity: 0;
  transform: translateX(10px);
}
</style>
