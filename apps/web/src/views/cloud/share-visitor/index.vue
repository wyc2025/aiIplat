<template>
  <div class="v-share-visitor">
    <!-- 密码门禁（P4d D47：有提取码且未持有效凭证 → 输码页） -->
    <el-card
      v-if="state === 'gate'"
      class="v-sv-card"
    >
      <div class="v-sv-gate">
        <el-icon :size="44">
          <Lock />
        </el-icon>
        <h3 class="v-sv-name">
          该分享需要提取码
        </h3>
        <p class="v-sv-meta">
          请输入分享者提供的提取码
        </p>
        <el-input
          v-model="password"
          placeholder="请输入提取码"
          maxlength="8"
          show-password
          class="v-sv-input"
          @keyup.enter="submitPassword"
        />
        <p
          v-if="gateError"
          class="v-sv-error"
        >
          {{ gateError }}
        </p>
        <el-button
          type="primary"
          size="large"
          :loading="verifying"
          @click="submitPassword"
        >
          确定
        </el-button>
      </div>
    </el-card>

    <!-- 失效态 -->
    <el-card
      v-else-if="state === 'failed'"
      class="v-sv-card"
    >
      <el-result
        icon="warning"
        title="链接无效或已失效"
        sub-title="请向分享者确认链接"
      />
    </el-card>

    <!-- 加载态 -->
    <el-card
      v-else-if="state === 'loading'"
      class="v-sv-card"
    >
      <div
        v-loading="true"
        class="v-sv-loading"
      />
    </el-card>

    <!-- 文件分享：复用公开落地页 FileView（D46 体验不分） -->
    <FileView
      v-else-if="state === 'file'"
      :source="source"
      :path="subPath"
      @need-password="onNeedPassword"
    />

    <!-- 文件夹分享：复用公开文件夹页 FolderView（列表 + 下钻 + 整包下载） -->
    <FolderView
      v-else
      :source="source"
      @need-password="onNeedPassword"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Lock } from '@element-plus/icons-vue'
import { shareInfo, verifySharePassword, ShareApiError } from '@/api/cloud/share-public'
import FileView from '../public-view/FileView.vue'
import FolderView from '../public-view/FolderView.vue'
import { createPublicSource } from '../public-view/usePublicSource'
import type { CloudSharePublic } from '@/types/api'

/** 需提取码（P4d 30017） */
const CODE_NEED_PASSWORD = 30017

const route = useRoute()
const token = computed(() => route.params.token as string)
/** 子文件预览路由（/share/:token/file?path=） */
const isSubFile = computed(() => route.name === 'share-visitor-file')
const subPath = computed(() => (route.query.path as string) ?? '')

type State = 'loading' | 'gate' | 'file' | 'folder' | 'failed'
const state = ref<State>('loading')
const info = ref<CloudSharePublic | null>(null)

/** 短期访问凭证（会话级，刷新页面仍在；关闭标签页失效） */
const sidKey = computed(() => `share-sid:${token.value}`)
const sid = ref('')

const password = ref('')
const gateError = ref('')
const verifying = ref(false)

/** 数据源适配层（D46：pub/share 共用渲染组件） */
const source = computed(() =>
  createPublicSource({
    kind: 'share',
    token: token.value,
    sid: sid.value || undefined,
    title: info.value?.fileName ?? '分享内容',
  }),
)

async function bootstrap(): Promise<void> {
  state.value = 'loading'
  try {
    // 子文件页：直接交给 FileView 取子项信息（其自身会按 30017 回退门禁）
    const res = await shareInfo(token.value, sid.value || undefined)
    info.value = res
    if (isSubFile.value) {
      state.value = 'file'
      return
    }
    state.value = res.itemType === 'folder' ? 'folder' : 'file'
  } catch (e) {
    state.value = e instanceof ShareApiError && e.code === CODE_NEED_PASSWORD ? 'gate' : 'failed'
  }
}

/** 提取码提交：成功签发短期凭证 → 重新进入内容页 */
async function submitPassword(): Promise<void> {
  if (!password.value) {
    gateError.value = '请输入提取码'
    return
  }
  verifying.value = true
  gateError.value = ''
  try {
    const res = await verifySharePassword(token.value, password.value)
    sid.value = res.sid
    sessionStorage.setItem(sidKey.value, res.sid)
    password.value = ''
    await bootstrap()
  } catch (e) {
    gateError.value = e instanceof ShareApiError ? e.message : '提取码校验失败，请重试'
  } finally {
    verifying.value = false
  }
}

/** 凭证过期/未通过（30017）：清凭证回门禁页 */
function onNeedPassword(): void {
  sid.value = ''
  sessionStorage.removeItem(sidKey.value)
  gateError.value = '提取码验证已过期，请重新输入'
  state.value = 'gate'
}

onMounted(() => {
  sid.value = sessionStorage.getItem(sidKey.value) ?? ''
  bootstrap()
})

// 两条路由复用同一组件实例（/share/:token 与 /share/:token/file），
// 命中切换时 onMounted 不会重跑 → 必须监听路由名重新决策渲染分支
// （只监听 route.name：文件夹内下钻仅改 query，交给 FolderView 自行加载，避免整页闪回加载态）
watch(
  () => route.name,
  () => bootstrap(),
)
</script>

<style scoped>
.v-share-visitor {
  min-height: 100vh;
  background: #f0f2f5;
}
.v-sv-card {
  width: 420px;
  max-width: calc(100% - 48px);
  margin: 0 auto;
  position: relative;
  top: 120px;
}
.v-sv-gate {
  text-align: center;
  padding: 16px 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.v-sv-name {
  margin: 8px 0 0;
}
.v-sv-meta {
  color: #909399;
  font-size: 13px;
  margin: 0 0 8px;
}
.v-sv-input {
  width: 220px;
}
.v-sv-error {
  color: var(--el-color-danger);
  font-size: 12px;
  margin: 0;
}
.v-sv-loading {
  height: 160px;
}
</style>
