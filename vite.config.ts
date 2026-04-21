import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig } from 'vitest/config'
import { loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import {
  handleExchangeCodeRequest,
  handleRefreshTokenRequest,
  type GoogleAuthEnv,
  type GoogleAuthHandlerResult,
} from './src/infra/googleDrive/server/googleOAuthServer'

const crossOriginIsolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

function buildGoogleAuthEnv(mode: string): GoogleAuthEnv {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI: env.GOOGLE_REDIRECT_URI,
  }
}

function sendJson(res: ServerResponse, { body, status }: GoogleAuthHandlerResult): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
  return await new Promise((resolve, reject) => {
    let body = ''

    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      resolve(body)
    })
    req.on('error', reject)
  })
}

function createGoogleAuthMiddleware(env: GoogleAuthEnv) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const requestUrl = req.url ?? ''
    const pathname = requestUrl.split('?')[0]
    if (pathname !== '/api/exchange-code' && pathname !== '/api/refresh-token') {
      next()
      return
    }

    try {
      const body = await readRequestBody(req)
      const handler = pathname === '/api/exchange-code'
        ? handleExchangeCodeRequest
        : handleRefreshTokenRequest

      sendJson(
        res,
        await handler({
          body,
          env,
          method: req.method,
        }),
      )
    } catch (error) {
      console.error('failed to handle local google auth request', error)
      sendJson(res, {
        body: { error: 'Token exchange failed' },
        status: 500,
      })
    }
  }
}

function googleAuthDevPlugin(env: GoogleAuthEnv): Plugin {
  return {
    name: 'google-auth-dev-api',
    configureServer(server) {
      server.middlewares.use(createGoogleAuthMiddleware(env))
    },
    configurePreviewServer(server) {
      server.middlewares.use(createGoogleAuthMiddleware(env))
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), googleAuthDevPlugin(buildGoogleAuthEnv(mode))],
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
}))
