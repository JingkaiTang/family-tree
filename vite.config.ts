import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'

// Tauri expects a fixed port, fail if that port is not available
const host = process.env.TAURI_DEV_HOST

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  // Relative URLs let the same build run at a static host's root or subdirectory.
  base: loadEnv(mode, process.cwd(), 'VITE_').VITE_BASE_PATH || './',
  plugins: [vue(), VitePWA({
    // Registration is guarded by runtime detection in PwaStatus.vue.
    injectRegister: false,
    registerType: 'prompt',
    disable: Boolean(process.env.TAURI_ENV_PLATFORM),
    includeAssets: ['icons/*.png'],
    manifest: {
      id: './',
      name: '家族树',
      short_name: '家族树',
      description: '在自己的本地目录中管理家谱与照片',
      lang: 'zh-CN',
      start_url: './',
      scope: './',
      display: 'standalone',
      theme_color: '#0284c7',
      background_color: '#f8fafc',
      icons: [
        { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      ],
    },
    workbox: {
      // Only built application assets are cached. Projects and photos stay in
      // the selected directory and never enter this service worker's caches.
      globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
      runtimeCaching: [],
      navigateFallback: 'index.html',
      cleanupOutdatedCaches: true,
      // Keep every open window on its current version while it may be editing.
      skipWaiting: false,
      clientsClaim: false,
    },
  })],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 5174,
        }
      : undefined,
    watch: {
      // 3. tell vite to ignore watching `src-tauri`
      ignored: ['**/src-tauri/**'],
    },
  },
}))
