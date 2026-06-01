/*
  Author: Runor Ewhro
  Description: Implements the server-side google oauth code exchange and token
               refresh handlers used by the Cloudflare worker api routes.
*/

export interface GglAuthEnv {
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  GOOGLE_REDIRECT_URI?: string
}

export interface GoogleAuthResult {
  body: unknown
  status: number
}

interface GglAuthRqstN {
  body?: Record<string, unknown> | string | null
  env: GglAuthEnv
  method?: string
}

interface GglCodeXchnN {
  code: string
  redirectUri?: string
}

function jsonResult(body: unknown, status = 200): GoogleAuthResult {
  return { body, status }
}

export function prsGglAuthRq(
  rawBody?: Record<string, unknown> | string | null,
): Record<string, unknown> {
  if (!rawBody) {
    return {}
  }

  if (typeof rawBody === 'string') {
    try {
      return JSON.parse(rawBody) as Record<string, unknown>
    } catch {
      return {}
    }
  }

  return rawBody
}

function getGglRdrcUr(env: GglAuthEnv, redirectUri?: string): string {
  return redirectUri || env.GOOGLE_REDIRECT_URI || ''
}

export function vldtGglSrvrC(env: GglAuthEnv): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)
}

export async function xchnGglCode(
  env: GglAuthEnv,
  { code, redirectUri }: GglCodeXchnN,
): Promise<GoogleAuthResult> {
  const tokenPayload = new URLSearchParams({
    code,
    client_id: env.GOOGLE_CLIENT_ID || '',
    client_secret: env.GOOGLE_CLIENT_SECRET || '',
    redirect_uri: getGglRdrcUr(env, redirectUri),
    grant_type: 'authorization_code',
  })

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: tokenPayload.toString(),
  })

  const tokens = await tokenResponse.json() as Record<string, unknown>
  if (!tokenResponse.ok) {
    return jsonResult(
      {
        error: 'Failed to exchange Google authorization code',
        details: tokens,
      },
      400,
    )
  }

  const userResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: {
      Authorization: `Bearer ${String(tokens.access_token ?? '')}`,
    },
  })
  const user = await userResponse.json()

  return jsonResult({ ...tokens, user })
}

export async function rfrsGglTkn(
  env: GglAuthEnv,
  refreshToken: string,
): Promise<GoogleAuthResult> {
  const tokenPayload = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID || '',
    client_secret: env.GOOGLE_CLIENT_SECRET || '',
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  })

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: tokenPayload.toString(),
  })

  const tokens = await tokenResponse.json() as Record<string, unknown>
  if (!tokenResponse.ok) {
    return jsonResult(
      {
        error: 'Failed to refresh Google access token',
        details: tokens,
      },
      400,
    )
  }

  return jsonResult(tokens)
}

export async function onExchangeCode({
  body: rawBody,
  env,
  method,
}: GglAuthRqstN): Promise<GoogleAuthResult> {
  if (method !== 'POST') {
    return jsonResult({ error: 'Method not allowed' }, 405)
  }

  const body = prsGglAuthRq(rawBody)
  const code = typeof body.code === 'string' ? body.code : ''
  const redirectUri = typeof body.redirectUri === 'string' ? body.redirectUri : ''
  if (!code) {
    return jsonResult({ error: 'Missing authorization code' }, 400)
  }

  if (!vldtGglSrvrC(env)) {
    return jsonResult({ error: 'Google OAuth server credentials are not configured' }, 500)
  }

  try {
    return await xchnGglCode(env, { code, redirectUri })
  } catch (error) {
    console.error('google auth code exchange failed', error)
    return jsonResult({ error: 'Token exchange failed' }, 500)
  }
}

export async function onRefreshToken({
  body: rawBody,
  env,
  method,
}: GglAuthRqstN): Promise<GoogleAuthResult> {
  if (method !== 'POST') {
    return jsonResult({ error: 'Method not allowed' }, 405)
  }

  const body = prsGglAuthRq(rawBody)
  const rfrsTknVl = typeof body.refresh_token === 'string' ? body.refresh_token : ''
  if (!rfrsTknVl) {
    return jsonResult({ error: 'Missing refresh token' }, 400)
  }

  if (!vldtGglSrvrC(env)) {
    return jsonResult({ error: 'Google OAuth server credentials are not configured' }, 500)
  }

  try {
    return await rfrsGglTkn(env, rfrsTknVl)
  } catch (error) {
    console.error('google token refresh failed', error)
    return jsonResult({ error: 'Token refresh failed' }, 500)
  }
}
