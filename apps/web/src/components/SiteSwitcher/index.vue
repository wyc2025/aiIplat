<template>
  <!-- P4E D54：仅多站时展示，单站用户全程无感 -->
  <div
    v-if="siteStore.multi"
    class="v-site-switcher"
  >
    <span class="v-ss-label">当前站点</span>
    <el-select
      :model-value="siteStore.currentSiteId"
      size="small"
      style="width: 260px"
      @change="onChange"
    >
      <el-option
        v-for="s in siteStore.sites"
        :key="s.id"
        :label="`${s.title}（${s.slug}）`"
        :value="s.id"
      />
    </el-select>
    <el-button
      link
      type="primary"
      size="small"
      @click="goManage"
    >
      站点管理
    </el-button>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useSiteStore } from '@/stores/site'

/**
 * 站点切换器（P4E T63）：置于 5 个站点页顶部，切换「当前站点」。
 * 站点数据由 useSiteStore 统一持有；页面通过 watch(currentSiteId) 重新拉取本页数据。
 */
const siteStore = useSiteStore()
const router = useRouter()

function onChange(id: string | number) {
  siteStore.setCurrent(String(id))
}

function goManage() {
  router.push('/site/site')
}
</script>

<style scoped>
.v-site-switcher {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.v-ss-label {
  font-size: 13px;
  color: #606266;
}
.v-ss-manage {
  font-size: 13px;
}
</style>
