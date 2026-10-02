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
        :label="s.title"
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
import { ElMessage } from 'element-plus'
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

/**
 * 跳「站点列表」页。该页由后端菜单动态注册（component=site/site/index），
 * 若菜单数据里没有这条记录（典型场景：线上库未同步 seed），路由不存在，
 * 直接 push 会落到 catch-all 404。这里提前拦截，给出可操作提示。
 */
function goManage() {
  if (!router.hasRoute('site-site')) {
    ElMessage.warning('暂时打不开「站点列表」页，请联系管理员处理后再重新登录')
    return
  }
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
