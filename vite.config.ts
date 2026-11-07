/*
  Author: Runor Ewhro
  description: configures vite, local google auth parity routes, test setup,
               worker output, and chunk boundaries for the simulation app.
*/

import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { configDefaults, defineConfig } from 'vitest/config'
import { loadEnv, type Plugin as VitePlugin } from 'vite'
import type { Root } from 'postcss'
import react from '@vitejs/plugin-react'
import svgr from 'vite-plugin-svgr'
import responsivePolicy from './src/shared/responsive/policy.json'
import { changelogNoticePlugin } from './tools/content/buildChangelogNotice'
import {
  onExchangeCode,
  onRefreshToken,
  type GglAuthEnv,
  type GoogleAuthResult,
} from './src/infra/googleDrive/server/googleOAuthServer'

const crossOriginIsolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
  // `credentialless` keeps cross-origin isolation (SharedArrayBuffer) while
  // allowing cross-origin images/backgrounds (e.g. imgbb uploads) to load
  // without the host sending corp headers, which `require-corp` would block.
  'Cross-Origin-Embedder-Policy': 'credentialless',
}

function buildGoogleAuthEnv(mode: string): GglAuthEnv {
  // dev and preview use the server route handler and need unprefixed server
  // environment keys.
  const env = loadEnv(mode, process.cwd(), '')
  return {
    GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI: env.GOOGLE_REDIRECT_URI,
  }
}

function sendJson(res: ServerResponse, { body, status }: GoogleAuthResult): void {
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

function createGoogleAuthMiddleware(env: GglAuthEnv) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const requestUrl = req.url ?? ''
    const pathname = requestUrl.split('?')[0]
    if (pathname !== '/api/exchange-code' && pathname !== '/api/refresh-token') {
      next()
      return
    }

    try {
      // keep local /api auth behavior aligned with deployed handlers while
      // still letting vite serve every other request normally.
      const body = await readRequestBody(req)
      const handler = pathname === '/api/exchange-code'
        ? onExchangeCode
        : onRefreshToken

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

function googleAuthDevPlugin(env: GglAuthEnv): VitePlugin {
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

function responsivePolicyPostcssPlugin() {
  const substitutions: Record<string, string> = {
    __APP_LAYOUT_MIN_WIDTH_PX__: String(responsivePolicy.layoutMinWidthPx),
    __APP_DENSE_LAYOUT_MAX_PX__: String(responsivePolicy.breakpointsPx.denseLayoutMax),
    __APP_STACK_LAYOUT_MAX_PX__: String(responsivePolicy.breakpointsPx.stackLayoutMax),
    __APP_WIDE_RAIL_MIN_PX__: String(responsivePolicy.breakpointsPx.wideRailMin),
  }

  return {
    postcssPlugin: 'responsive-policy',
    Once(root: Root) {
      const replace = (source: string) => {
        let transformed = source
        for (const [placeholder, value] of Object.entries(substitutions)) {
          transformed = transformed.replaceAll(placeholder, value)
        }
        return transformed
      }

      root.walkDecls((declaration) => {
        declaration.value = replace(declaration.value)
      })
      root.walkAtRules((rule) => {
        rule.params = replace(rule.params)
      })

      const transformed = root.toString()
      if (transformed.includes('__APP_')) {
        throw new Error('Unknown responsive policy placeholder in compiled CSS')
      }
    },
  }
}

function lucideMotionTreeShakingPlugin(): VitePlugin {
  return {
    name: 'lucide-motion-tree-shaking',
    transform(source, id) {
      if (!id.replaceAll('\\', '/').endsWith('/node_modules/lucide-react-motion/dist/index.js')) return null
      // lucide-react-motion 0.5.1 retains unused signatures and components
      // through their displayName writes. keep those writes inside pure
      // constructors so used icons keep their names and animation definitions.
      const code = source
        .replaceAll('= compose(', '= /* @__PURE__ */ compose(')
        .replace(
          /function (\w+)\(props\) \{([\s\S]*?)\n\}\n\1\.displayName = ("[^"]+");/g,
          'var $1 = /* @__PURE__ */ Object.assign(function $1(props) {$2\n}, { displayName: $3 });',
        )
      return code === source ? null : { code, map: null }
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [changelogNoticePlugin(), lucideMotionTreeShakingPlugin(), react(), svgr(), googleAuthDevPlugin(buildGoogleAuthEnv(mode))],
  css: {
    postcss: {
      plugins: [responsivePolicyPostcssPlugin()],
    },
  },
  // brotli-wasm resolves its .wasm asset through import.meta.url, which dep
  // pre-bundling would break; excluding it lets vite serve the module as-is.
  optimizeDeps: {
    exclude: ['brotli-wasm'],
  },
  test: {
    setupFiles: ['vitest.setup.ts'],
    // calculation suites hydrate large registries; bound concurrent workers
    // so the full suite does not exhaust memory alongside lint and builds.
    maxWorkers: 4,
    // local-only archives are not part of the maintained test surface
    exclude: [...configDefaults.exclude, 'legacy/**', 'scripts/**', 'wip/**'],
  },
  worker: {
    format: 'es',
  },
  build: {
    rollupOptions: {
      // reader.html is the leaderboard's card reader page (services/leaderboard)
      input: {
        main: path.resolve(__dirname, 'index.html'),
        reader: path.resolve(__dirname, 'reader.html'),
      },
      output: {
        manualChunks(id) {
          if (id.endsWith('/src/shared/lib/displayAssets.generated.json')) {
            return 'display-assets'
          }
          if (id.includes('node_modules')) {
            if (id.includes('/lucide-react-motion/')) {
              return 'motion-icons-vendor'
            }
            if (['/motion/', '/framer-motion/', '/motion-dom/', '/motion-utils/'].some((name) => id.includes(name))) {
              return 'motion-vendor'
            }
            // stable vendor groups keep high-churn simulation code from
            // invalidating framework and icon chunks on every feature edit.
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
            return 'simulation-effects'
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
