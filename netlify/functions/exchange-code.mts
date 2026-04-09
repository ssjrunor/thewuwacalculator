function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  })
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    return await request.json()
  } catch {
    return {}
  }
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const { code, redirectUri } = await readJsonBody(request)
  if (typeof code !== 'string' || code.length === 0) {
    return jsonResponse({ error: 'Missing authorization code' }, 400)
  }

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return jsonResponse({ error: 'Google OAuth server credentials are not configured' }, 500)
  }

  try {
    const tokenPayload = new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: typeof redirectUri === 'string' ? redirectUri : (process.env.GOOGLE_REDIRECT_URI || ''),
      grant_type: 'authorization_code',
    })

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: tokenPayload.toString(),
    })

    const tokens = await tokenResponse.json()
    if (!tokenResponse.ok) {
      return jsonResponse({
        error: 'Failed to exchange Google authorization code',
        details: tokens,
      }, 400)
    }

    const userResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
      },
    })
    const user = await userResponse.json()

    return jsonResponse({ ...tokens, user })
  } catch (error) {
    console.error('google auth code exchange failed', error)
    return jsonResponse({ error: 'Token exchange failed' }, 500)
  }
}
