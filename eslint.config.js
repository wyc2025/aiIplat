import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dist-ssr/**',
      '**/uploads/**',
      '**/coverage/**',
      'apps/api/prisma/migrations/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        // 允许解构剔除写法（const { password: _, ...rest } = obj）与 _ 前缀的刻意未用变量
        { ignoreRestSiblings: true, argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // 页面/布局/组件按目录组织（index.vue / 404.vue），组件名允许单词
    files: [
      'apps/web/src/views/**/*.vue',
      'apps/web/src/layout/**/*.vue',
      'apps/web/src/components/**/*.vue',
    ],
    rules: {
      'vue/multi-word-component-names': 'off',
    },
  },
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
    rules: {
      // .vue 的 TS script 块由 vue-tsc 负责未定义检查，
      // 与 tseslint recommended 对 .ts 的处理保持一致（否则 window/DOM 类型误报）
      'no-undef': 'off',
    },
  },
)
