import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('.', import.meta.url))

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  // Relative URLs let the same build run at a static host's root or subdirectory.
  base: loadEnv(mode, projectRoot, 'VITE_').VITE_BASE_PATH || './',
  plugins: [vue(), VitePWA({
    // PwaStatus.vue registers updates after the application is ready.
    injectRegister: false,
    registerType: 'prompt',
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
    alias: { '@': path.join(projectRoot, 'src') },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
}))
