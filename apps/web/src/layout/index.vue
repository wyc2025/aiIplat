<template>
  <div class="v-layout">
    <Sidebar />
    <div class="v-main-wrap">
      <Navbar @open-settings="settingsVisible = true" />
      <TabsBar />
      <AppMain />
    </div>
    <Settings
      :visible="settingsVisible"
      @close="settingsVisible = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import AppMain from './components/AppMain.vue'
import Navbar from './components/Navbar.vue'
import Settings from './components/Settings.vue'
import Sidebar from './components/Sidebar.vue'
import TabsBar from './components/TabsBar.vue'

const settingsVisible = ref(false)
</script>

<style scoped>
.v-layout {
  display: flex;
  width: 100%;
  height: 100vh;
  min-width: 1280px;
}
.v-main-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
</style>
