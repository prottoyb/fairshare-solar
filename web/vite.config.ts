import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// Vue DevTools adds a floating button to every page, which would show in the demo
// video, so it is opt-in: set VUE_DEVTOOLS=1 when starting the dev server.
const withDevTools = process.env.VUE_DEVTOOLS === '1'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), ...(withDevTools ? [vueDevTools()] : [])],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    // Same-origin in dev: the app calls relative /api URLs and io() with no URL.
    proxy: {
      '/api': 'http://localhost:3000',
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
})
