<template>
  <!-- eslint-disable vue/no-v-html -- markdown-it 配置 html:false，渲染输出安全 -->
  <div
    class="v-markdown"
    v-html="rendered"
  />
  <!-- eslint-enable vue/no-v-html -->
</template>

<script setup lang="ts">
import { computed } from 'vue'
import MarkdownIt from 'markdown-it'

const props = defineProps<{ content: string }>()

/**
 * markdown-it 渲染封装（见 ARCHITECTURE §9）。
 * 禁 raw HTML（html:false，防 XSS）；允许换行转 <br>。
 */
const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
})

const rendered = computed(() => md.render(props.content || ''))
</script>

<style scoped>
.v-markdown {
  line-height: 1.7;
  font-size: 14px;
  word-break: break-word;
}
.v-markdown :deep(p) {
  margin: 0 0 8px;
}
.v-markdown :deep(p:last-child) {
  margin-bottom: 0;
}
.v-markdown :deep(pre) {
  background: #f5f7fa;
  border-radius: 6px;
  padding: 12px;
  overflow-x: auto;
  margin: 8px 0;
}
.v-markdown :deep(code) {
  background: #f5f7fa;
  border-radius: 3px;
  padding: 2px 5px;
  font-family: Consolas, Monaco, monospace;
  font-size: 13px;
}
.v-markdown :deep(pre code) {
  background: transparent;
  padding: 0;
}
.v-markdown :deep(ul),
.v-markdown :deep(ol) {
  padding-left: 20px;
  margin: 6px 0;
}
.v-markdown :deep(blockquote) {
  border-left: 3px solid #dcdfe6;
  padding-left: 12px;
  margin: 8px 0;
  color: #909399;
}
.v-markdown :deep(h1),
.v-markdown :deep(h2),
.v-markdown :deep(h3),
.v-markdown :deep(h4) {
  margin: 12px 0 8px;
  line-height: 1.4;
}
.v-markdown :deep(table) {
  border-collapse: collapse;
  margin: 8px 0;
}
.v-markdown :deep(th),
.v-markdown :deep(td) {
  border: 1px solid #e4e7ed;
  padding: 6px 12px;
}
</style>
