<template>
  <!--
    平台图标（内联 SVG，与 public/favicon.svg 同源同几何）。
    内联而非 <img> 的原因：侧边栏收窄、登录页大尺寸都需要无损缩放，
    且内联可随主题微调，无需额外网络请求。
  -->
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 512 512"
    class="v-app-logo"
    role="img"
    aria-label="iplat"
  >
    <defs>
      <linearGradient
        id="vAppLogoGradient"
        x1="0"
        y1="0"
        x2="1"
        y2="1"
      >
        <stop
          offset="0"
          stop-color="#2563EB"
        />
        <stop
          offset="1"
          stop-color="#06B6D4"
        />
      </linearGradient>
    </defs>
    <rect
      width="512"
      height="512"
      rx="112"
      fill="url(#vAppLogoGradient)"
    />
    <circle
      cx="256"
      cy="166"
      r="44"
      fill="#ffffff"
    />
    <rect
      x="222"
      y="234"
      width="68"
      height="176"
      rx="34"
      fill="#ffffff"
    />
    <path
      d="M152 404c34-22 68-33 104-33s70 11 104 33"
      fill="none"
      stroke="#ffffff"
      stroke-width="16"
      stroke-linecap="round"
    />
  </svg>
</template>

<script setup lang="ts">
/** 平台图标：size 为渲染边长（px） */
withDefaults(defineProps<{ size?: number }>(), { size: 28 })
</script>

<style scoped>
.v-app-logo {
  display: block;
  flex-shrink: 0;
}
</style>
