/*
  Author: Runor Ewhro
  Description: Cloudflare worker entrypoint that serves static assets and
               handles the google oauth api endpoints used by drive sync.
*/

import {
  onExchangeCode,
  onRefreshToken,
  type GglAuthEnv,
  type GoogleAuthResult,
} from '../infra/googleDrive/server/googleOAuthServer'

interface CldfEnv extends GglAuthEnv {
  ASSETS: {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
  }
}

const CANONICAL_HOST = 'thewuwacalculator.com'

function makeJsonResponse({ body, status }: GoogleAuthResult): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
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

  return null
}

export default {
  async fetch(request: Request, env: CldfEnv): Promise<Response> {
    const canonicalRedirect = getCanonicalRedirect(request)
    if (canonicalRedirect) {
      return canonicalRedirect
    }

    const apiResponse = await onApiRqst(request, env)
    if (apiResponse) {
      return apiResponse
    }

    return env.ASSETS.fetch(request)
  },
}
