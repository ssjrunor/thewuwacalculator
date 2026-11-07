/*
  Author: Runor Ewhro
  description: cloudflare worker entrypoint that serves static assets and
               handles the google oauth api endpoints used by drive sync.
               /api/lb/* is handed, untouched, to the leaderboard api worker
               over the LEADERBOARD service binding.
*/

import {
  onExchangeCode,
  onRefreshToken,
  type GglAuthEnv,
} from '../infra/googleDrive/server/googleOAuthServer'
import {
  onShareRequest,
  type ShareEnv,
  type ShareServerResult,
} from '../infra/shares/server/shareServer'

interface CldfEnv extends GglAuthEnv, ShareEnv {
  ASSETS: {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
  }
  /** the leaderboard api worker (services/leaderboard); absent where it is not bound. */
  LEADERBOARD?: {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
  }
}

const LEADERBOARD_PREFIX = '/api/lb/'

const CANONICAL_HOST = 'thewuwacalculator.com'

function makeJsonResponse({ body, status, headers }: ShareServerResult): Response {
  const contentType = headers?.['Content-Type'] ?? 'application/json'
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: {
      ...headers,
      'Content-Type': contentType,
    },
  })
}

function getCanonicalRedirect(request: Request): Response | null {
  const url = new URL(request.url)
  const host = url.hostname.toLowerCase()
  const isCanonicalHost = host === CANONICAL_HOST

  if (!isCanonicalHost) return null

  let changed = false
  if (url.protocol === 'http:') {
    url.protocol = 'https:'
    changed = true
  }

  return changed ? Response.redirect(url.toString(), 301) : null
}

async function onApiRqst(request: Request, env: CldfEnv): Promise<Response | null> {
  const url = new URL(request.url)
  const body = await request.text()

  // keep the worker routing tiny by only intercepting the oauth endpoints and
  // letting everything else fall back to the asset handler.
  if (url.pathname === '/api/exchange-code') {
    return makeJsonResponse(await onExchangeCode({ body, env, method: request.method }))
  }

  if (url.pathname === '/api/refresh-token') {
    return makeJsonResponse(await onRefreshToken({ body, env, method: request.method }))
  }

  if (url.pathname === '/api/shares' || url.pathname.startsWith('/api/shares/')) {
    const clientId = request.headers.get('CF-Connecting-IP')
      ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      ?? 'local'

    return makeJsonResponse(await onShareRequest({
      body,
      clientId,
      env,
      method: request.method,
      requestUrl: request.url,
    }))
  }

  return null
}

export default {
  async fetch(request: Request, env: CldfEnv): Promise<Response> {
    const canonicalRedirect = getCanonicalRedirect(request)
    if (canonicalRedirect) {
      return canonicalRedirect
    }

    // forwarded before anything reads the body.
    if (new URL(request.url).pathname.startsWith(LEADERBOARD_PREFIX)) {
      return env.LEADERBOARD
        ? env.LEADERBOARD.fetch(request)
        : Response.json({ error: { code: 'not_found', message: 'the leaderboard is not available here' } }, { status: 404 })
    }

    const apiResponse = await onApiRqst(request, env)
    if (apiResponse) {
      return apiResponse
    }

    return env.ASSETS.fetch(request)
  },
}
