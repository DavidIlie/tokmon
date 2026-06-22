import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

// Built into ../dist/web and served by the tokmon Node server (`tokmon serve`).
// `base: './'` keeps asset URLs relative so the SPA works when served from root.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  resolve: {
    alias: {
      // Single source of truth for the server↔client contract (type-only file).
      '@shared': fileURLToPath(new URL('../src/web/contract.ts', import.meta.url)),
    },
  },
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    // Dev: proxy API + WebSocket RPC to a running `tokmon serve`.
    proxy: {
      '/api': { target: 'http://127.0.0.1:4317', changeOrigin: true },
      '/ws': { target: 'ws://127.0.0.1:4317', ws: true, changeOrigin: true },
      '/healthz': { target: 'http://127.0.0.1:4317', changeOrigin: true },
    },
  },
})
