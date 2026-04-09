export interface GoogleAuthEnv {
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  GOOGLE_REDIRECT_URI?: string
}

export interface GoogleAuthHandlerResult {
  body: unknown
  status: number
}

interface GoogleAuthRequestInput {
  body?: Record<string, unknown> | string | null
  env: GoogleAuthEnv
  method?: string
}

interface GoogleCodeExchangeInput {
  code: string
  redirectUri?: string
}

function jsonResult(body: unknown, status = 200): GoogleAuthHandlerResult {
  return { body, status }
}

export function parseGoogleAuthRequestBody(
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

function getGoogleRedirectUri(env: GoogleAuthEnv, redirectUri?: string): string {
  return redirectUri || env.GOOGLE_REDIRECT_URI || ''
}

export function validateGoogleServerCredentials(env: GoogleAuthEnv): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)
}

export async function exchangeGoogleCode(
  env: GoogleAuthEnv,
  { code, redirectUri }: GoogleCodeExchangeInput,
): Promise<GoogleAuthHandlerResult> {
  const tokenPayload = new URLSearchParams({
    code,
    client_id: env.GOOGLE_CLIENT_ID || '',
    client_secret: env.GOOGLE_CLIENT_SECRET || '',
    redirect_uri: getGoogleRedirectUri(env, redirectUri),
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

export async function refreshGoogleToken(
  env: GoogleAuthEnv,
  refreshToken: string,
): Promise<GoogleAuthHandlerResult> {
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

export async function handleExchangeCodeRequest({
  body: rawBody,
  env,
  method,
}: GoogleAuthRequestInput): Promise<GoogleAuthHandlerResult> {
  if (method !== 'POST') {
    return jsonResult({ error: 'Method not allowed' }, 405)
  }

  const body = parseGoogleAuthRequestBody(rawBody)
  const code = typeof body.code === 'string' ? body.code : ''
  const redirectUri = typeof body.redirectUri === 'string' ? body.redirectUri : ''
  if (!code) {
    return jsonResult({ error: 'Missing authorization code' }, 400)
  }

  if (!validateGoogleServerCredentials(env)) {
    return jsonResult({ error: 'Google OAuth server credentials are not configured' }, 500)
  }

  try {
    return await exchangeGoogleCode(env, { code, redirectUri })
  } catch (error) {
    console.error('google auth code exchange failed', error)
    return jsonResult({ error: 'Token exchange failed' }, 500)
  }
}

export async function handleRefreshTokenRequest({
  body: rawBody,
  env,
  method,
}: GoogleAuthRequestInput): Promise<GoogleAuthHandlerResult> {
  if (method !== 'POST') {
    return jsonResult({ error: 'Method not allowed' }, 405)
  }

  const body = parseGoogleAuthRequestBody(rawBody)
  const refreshTokenValue = typeof body.refresh_token === 'string' ? body.refresh_token : ''
  if (!refreshTokenValue) {
    return jsonResult({ error: 'Missing refresh token' }, 400)
  }

  if (!validateGoogleServerCredentials(env)) {
    return jsonResult({ error: 'Google OAuth server credentials are not configured' }, 500)
  }

  try {
    return await refreshGoogleToken(env, refreshTokenValue)
  } catch (error) {
    console.error('google token refresh failed', error)
    return jsonResult({ error: 'Token refresh failed' }, 500)
  }
}
