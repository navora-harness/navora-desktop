import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'
import path from 'node:path'

export default defineConfig({
  plugins: [vue(), vuetify({ autoImport: true })],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, 'shared'),
    },
  },
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
    // Electron 会锁定 portable 下 Cookies 等文件；勿让 Vite 监听
    watch: {
      ignored: ['**/portable/**', '**/dist-electron/**', '**/release/**'],
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
