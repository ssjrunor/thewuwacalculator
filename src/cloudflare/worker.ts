import {
  handleExchangeCodeRequest,
  handleRefreshTokenRequest,
  type GoogleAuthEnv,
  type GoogleAuthHandlerResult,
} from '@/infra/googleDrive/server/googleOAuthServer'

interface CloudflareEnv extends GoogleAuthEnv {
  ASSETS: {
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
  }
}

function createJsonResponse({ body, status }: GoogleAuthHandlerResult): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  })
}

async function handleApiRequest(request: Request, env: CloudflareEnv): Promise<Response | null> {
  const url = new URL(request.url)
  const body = await request.text()

  if (url.pathname === '/api/exchange-code') {
    return createJsonResponse(await handleExchangeCodeRequest({ body, env, method: request.method }))
  }

  if (url.pathname === '/api/refresh-token') {
    return createJsonResponse(await handleRefreshTokenRequest({ body, env, method: request.method }))
  }

  return null
}

export default {
  async fetch(request: Request, env: CloudflareEnv): Promise<Response> {
    const apiResponse = await handleApiRequest(request, env)
    if (apiResponse) {
      return apiResponse
    }

    return env.ASSETS.fetch(request)
  },
}
