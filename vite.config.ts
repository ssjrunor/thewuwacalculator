import path from 'node:path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const crossOriginIsolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

export default defineConfig({
  plugins: [react()],
  test: {
    setupFiles: ['vitest.setup.ts'],
  },
  worker: {
    format: 'es',
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (
              id.includes('/react/') ||
              id.includes('/react-dom/') ||
              id.includes('/react-router-dom/') ||
              id.includes('/zustand/')
            ) {
              return 'react-core'
            }

            if (id.includes('/react-icons/')) {
              return 'icons-vendor'
            }

            if (id.includes('/zod/')) {
              return 'schema-vendor'
            }

            if (
              id.includes('/@radix-ui/') ||
              id.includes('/lucide-react/') ||
              id.includes('/react-resizable-panels/')
            ) {
              return 'ui-vendor'
            }
          }

          if (
            id.includes('/src/data/gameData/') ||
            id.includes('/src/domain/gameData/')
          ) {
            return 'calculator-effects'
          }
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5174,
    headers: crossOriginIsolationHeaders,
    watch: {
      usePolling: true,
      interval: 100,
      ignored: ['**/.git/**', '**/node_modules/**', '**/dist/**', '**/.idea/**'],
    },
  },
  preview: {
    headers: crossOriginIsolationHeaders,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
})
