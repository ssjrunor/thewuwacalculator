import {
  handleRefreshTokenRequest,
  type GoogleAuthEnv,
  type GoogleAuthHandlerResult,
} from '../../src/infra/googleDrive/server/googleOAuthServer'

interface PagesFunctionContext {
  request: Request
  env: GoogleAuthEnv
}

function createJsonResponse({ body, status }: GoogleAuthHandlerResult): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  })
}

export async function onRequest({ request, env }: PagesFunctionContext): Promise<Response> {
  if (request.method !== 'POST') {
    return createJsonResponse({ body: { error: 'Method not allowed' }, status: 405 })
  }

  const body = await request.text()
  return createJsonResponse(await handleRefreshTokenRequest({ body, env, method: request.method }))
}
