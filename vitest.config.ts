import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import path from 'node:path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    // L1 纯逻辑测试默认 node 环境，L2 组件测试通过文件级
    // pragma `// @vitest-environment happy-dom` 切换
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // 组件测试可能涉及异步渲染（nextTick 等）
    globals: true,
    // 5 秒超时，layout 计算可能较慢
    testTimeout: 5000,
  },
})
